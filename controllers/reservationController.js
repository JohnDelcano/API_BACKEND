import Reservation from "../models/Reservation.js";
import Book from "../models/Book.js";

// ================================
//  CREATE RESERVATION
// ================================
export const createReservation = async (req, res) => {
  try {
    const studentId = req.user.id; // comes from auth middleware
    const { id: bookId } = req.params;

    // Set expiry time for 2 hours
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

    // Prevent duplicate reservations
    const existing = await Reservation.findOne({
      studentId,
      bookId,
      status: { $in: ["reserved", "approved", "borrowed"] },
    });

    if (existing)
      return res
        .status(400)
        .json({ error: "You already have an active reservation for this book." });

    const reservation = await Reservation.create({
      studentId,
      bookId,
      status: "reserved",
      expiresAt,
    });

    await Book.findByIdAndUpdate(bookId, {
      $inc: { availableCount: -1, reservedCount: 1 },
      status: "Reserved",
    });

    // ✅ Emit Socket.IO event for real-time update
    req.io.emit("reservationUpdated", reservation);

    res.status(201).json({ reservation });
  } catch (err) {
    console.error("❌ Create reservation error:", err);
    res.status(500).json({ error: "Failed to create reservation." });
  }
};

// ================================
//  APPROVE RESERVATION (Admin)
// ================================
export const approveReservation = async (req, res) => {
  try {
    const { id } = req.params; // reservation ID
    const reservation = await Reservation.findById(id).populate("bookId");
    if (!reservation)
      return res.status(404).json({ error: "Reservation not found." });

    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
    reservation.status = "approved";
    reservation.dueDate = dueDate;
    await reservation.save();

    // ✅ Notify frontend via socket
    req.io.emit("reservationApproved", reservation);

    res.json({ message: "Reservation approved", reservation });
  } catch (err) {
    console.error("❌ Approve reservation error:", err);
    res.status(500).json({ error: "Failed to approve reservation." });
  }
};

// ================================
//  CANCEL RESERVATION (User)
// ================================
export const cancelReservation = async (req, res) => {
  try {
    const { id } = req.params; // reservation ID
    const studentId = req.user.id;

    const reservation = await Reservation.findOne({
      _id: id,
      studentId,
      status: { $in: ["reserved", "approved"] },
    });

    if (!reservation)
      return res.status(404).json({ error: "Reservation not found or cannot be cancelled." });

    reservation.status = "cancelled";
    await reservation.save();

    await Book.findByIdAndUpdate(reservation.bookId, {
      $inc: { availableCount: 1, reservedCount: -1 },
      status: "Available",
    });

    // ✅ Emit socket event
    req.io.emit("reservationUpdated", reservation);

    res.json({ message: "Reservation cancelled successfully.", reservation });
  } catch (err) {
    console.error("❌ Cancel reservation error:", err);
    res.status(500).json({ error: "Failed to cancel reservation." });
  }
};

// ================================
//  GET USER RESERVATIONS
// ================================
export const getMyReservations = async (req, res) => {
  try {
    const studentId = req.user.id;
    const reservations = await Reservation.find({ studentId })
      .populate("bookId")
      .sort({ updatedAt: -1 });

    res.json({ reservations });
  } catch (err) {
    console.error("❌ Fetch reservations error:", err);
    res.status(500).json({ error: "Failed to fetch reservations." });
  }
};

// ================================
//  AUTO-EXPIRE RESERVED BOOKS
// ================================
import cron from "node-cron";

cron.schedule("*/10 * * * *", async () => {
  const now = new Date();
  const expired = await Reservation.find({
    status: "reserved",
    expiresAt: { $lt: now },
  });

  for (const r of expired) {
    r.status = "expired";
    await r.save();

    await Book.findByIdAndUpdate(r.bookId, {
      $inc: { availableCount: 1, reservedCount: -1 },
      status: "Available",
    });
  }

  if (expired.length > 0)
    console.log(`🕒 Auto-cancelled ${expired.length} expired reservations`);
});
