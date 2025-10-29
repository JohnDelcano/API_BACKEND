import Reservation from "../models/Reservation.js";
import Book from "../models/Book.js";

// ================================
//  CREATE RESERVATION
// ================================
// POST /api/reservation
const createReservation = async (req, res) => {
  try {
    const { bookId, expiresAt } = req.body;
    const studentId = req.user.id;

    // ✅ STEP 1: Check for active reservation
    const existingReservation = await Reservation.findOne({
      bookId,
      studentId,
      status: { $in: ["reserved", "approved", "borrowed"] }, // Only block active ones
    });

    if (existingReservation) {
      return res.status(400).json({
        success: false,
        message: "You already have an active reservation for this book.",
      });
    }

    // ✅ STEP 2: Check book availability
    const book = await Book.findById(bookId);
    if (!book || book.availableCount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Book is not available for reservation.",
      });
    }

    // ✅ STEP 3: Create new reservation
    const reservation = new Reservation({
      bookId,
      studentId,
      expiresAt,
      status: "reserved",
    });

    await reservation.save();

    // ✅ STEP 4: Update book counts
    book.availableCount -= 1;
    book.reservedCount += 1;
    await book.save();

    return res.status(201).json({
      success: true,
      reservation,
    });
  } catch (err) {
    console.error("Reservation creation failed:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
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
