import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticate } from "../auth.js";

const router = express.Router();

// -------------------------
// 🔧 Constants
// -------------------------
const MAX_ACTIVE_RESERVATIONS = 3; // Max books a student can borrow
const RESERVATION_EXPIRY_HOURS = 2; // Must pick up within 2 hours

// -------------------------
// 🧠 Helpers
// -------------------------
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

async function startSessionWithTxn() {
  const session = await mongoose.startSession();
  let txnStarted = false;
  try {
    session.startTransaction();
    txnStarted = true;
  } catch {
    console.warn("⚠ Transactions unavailable — proceeding without transaction.");
  }
  return { session, txnStarted };
}

/* ---------------------------------------
   🕒 Expire Old Reservations (Utility)
--------------------------------------- */
export async function expireOldReservations(io) {
  const now = new Date();
  const expired = await Reservation.find({
    status: "reserved",
    expiresAt: { $lt: now },
  });

  for (const resv of expired) {
    await Book.findByIdAndUpdate(resv.bookId, {
      $inc: { availableCount: 1, reservedCount: -1 },
      status: "Available",
    });

    await Student.findByIdAndUpdate(resv.studentId, {
      $inc: { activeReservations: -1 },
    });

    resv.status = "expired";
    await resv.save();

    io.to(resv.studentId.toString()).emit("reservationUpdated", resv.toObject());
    io.to("admins").emit("adminReservationUpdated", resv.toObject());
  }
}

/* ---------------------------------------
   📘 GET /api/reservation
   Fetch current user's reservations
--------------------------------------- */
router.get("/", authenticate, async (req, res) => {
  try {
    const reservations = await Reservation.find({ studentId: req.user._id });
    res.json({ success: true, reservations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});

/* ---------------------------------------
   🟢 POST /api/reservation/:bookId
   Reserve a book (only for verified users)
--------------------------------------- */
router.post("/:bookId", authenticate, async (req, res) => {
  const student = req.user;
  const { bookId } = req.params;
  const io = req.app.get("io");

  if (!isValidObjectId(bookId))
    return res.status(400).json({ success: false, error: "Invalid book ID" });

  try {
    await expireOldReservations(io);

    const { session, txnStarted } = await startSessionWithTxn();
    const studentDoc = await Student.findById(student._id).session(session);
    if (!studentDoc) throw new Error("Student not found");

    // Must be verified first
    if (studentDoc.status !== "Active") {
      throw new Error("Your account must be verified before reserving books.");
    }

    // Limit active approved books
    const activeApproved = await Reservation.countDocuments({
      studentId: studentDoc._id,
      status: "approved",
    });
    if (activeApproved >= MAX_ACTIVE_RESERVATIONS)
      throw new Error(`You can only have ${MAX_ACTIVE_RESERVATIONS} borrowed books.`);

    // Try reserving book
    const book = await Book.findOneAndUpdate(
      { _id: bookId, availableCount: { $gt: 0 } },
      { $inc: { availableCount: -1, reservedCount: 1 }, status: "Reserved" },
      { new: true, session }
    );
    if (!book) throw new Error("No available copies.");

    const expiresAt = new Date(Date.now() + RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000);

    const [reservation] = await Reservation.create(
      [
        {
          bookId,
          studentId: studentDoc._id,
          reservedAt: new Date(),
          expiresAt,
          status: "reserved",
        },
      ],
      { session }
    );

    if (txnStarted) await session.commitTransaction();
    session.endSession();

    io.to(studentDoc._id.toString()).emit("reservationUpdated", reservation.toObject());
    io.to("admins").emit("adminReservationUpdated", reservation.toObject());

    res.status(201).json({
      success: true,
      message: "Book reserved successfully.",
      reservation,
    });
  } catch (err) {
    console.error("❌ Reservation failed:", err);
    res.status(400).json({ success: false, error: err.message || "Reservation failed" });
  }
});

/* ---------------------------------------
   📜 GET /api/reservation/my
   Get user's reservations with book details
--------------------------------------- */
router.get("/my", authenticate, async (req, res) => {
  try {
    const reservations = await Reservation.find({ studentId: req.user._id })
      .populate("bookId");
    res.json({ success: true, reservations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch your reservations" });
  }
});

/* ---------------------------------------
   ❌ DELETE /api/reservation/:id
   Cancel reservation
--------------------------------------- */
router.delete("/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const io = req.app.get("io");

  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ success: false, error: "Invalid reservation ID" });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await Reservation.findById(id).session(session);
    if (!reservation)
      return res.status(404).json({ success: false, error: "Reservation not found" });

    if (reservation.studentId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not authorized" });

    if (reservation.status !== "reserved")
      return res.status(400).json({
        success: false,
        error: `Cannot cancel a reservation that is ${reservation.status}.`,
      });

    await Book.findByIdAndUpdate(
      reservation.bookId,
      { $inc: { availableCount: 1, reservedCount: -1 } },
      { session }
    );

    await Student.findByIdAndUpdate(
      reservation.studentId,
      { $inc: { activeReservations: -1 } },
      { session }
    );

    reservation.status = "cancelled";
    await reservation.save({ session });

    await session.commitTransaction();
    session.endSession();

    io.to(reservation.studentId.toString()).emit("reservationUpdated", reservation.toObject());
    io.to("admins").emit("adminReservationUpdated", reservation.toObject());

    res.json({ success: true, message: "Reservation cancelled." });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to cancel reservation." });
  }
});

/* ---------------------------------------
   ✏ PATCH /api/reservation/:id/status
   Update status (approve / decline / returned / lost)
--------------------------------------- */
router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const io = req.app.get("io");

  try {
    const reservation = await Reservation.findById(id)
      .populate("studentId", "studentId firstName lastName activeReservations")
      .populate("bookId");

    if (!reservation)
      return res.status(404).json({ success: false, message: "Reservation not found" });

    reservation.status = status;

    switch (status) {
      case "approved":
        await Book.findByIdAndUpdate(reservation.bookId._id, {
          $inc: { reservedCount: -1, borrowedCount: 1 },
          status: "Borrowed",
        });
        reservation.dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        break;

      case "declined":
      case "cancelled":
      case "expired":
        await Book.findByIdAndUpdate(reservation.bookId._id, {
          $inc: { availableCount: 1, reservedCount: -1 },
          status: "Available",
        });
        reservation.dueDate = null;
        break;

      case "returned":
        await Book.findByIdAndUpdate(reservation.bookId._id, {
          $inc: { availableCount: 1, borrowedCount: -1 },
          status: "Available",
        });
        reservation.status = "completed";
        reservation.dueDate = null;
        break;

      case "lost":
        await Book.findByIdAndUpdate(reservation.bookId._id, {
          $inc: { borrowedCount: -1, lostCount: 1 },
          status: "Lost",
        });
        break;
    }

    await reservation.save();

    const formattedReservation = {
      _id: reservation._id,
      student: reservation.studentId,
      book: reservation.bookId,
      reservedAt: reservation.reservedAt,
      dueDate: reservation.dueDate,
      status: reservation.status,
    };

    io.to(reservation.studentId._id.toString()).emit("reservationUpdated", formattedReservation);
    io.to("admins").emit("adminReservationUpdated", formattedReservation);

    res.json({ success: true, reservation: formattedReservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

/* ---------------------------------------
   🧾 GET /api/reservation/admin/all
   Admin: view all reservations
--------------------------------------- */
router.get("/admin/all", async (req, res) => {
  try {
    const reservations = await Reservation.find()
      .populate("studentId", "studentId firstName lastName")
      .populate("bookId", "title");

    const formatted = reservations.map((r) => ({
      _id: r._id,
      student: r.studentId
        ? {
            _id: r.studentId._id,
            studentId: r.studentId.studentId,
            firstName: r.studentId.firstName,
            lastName: r.studentId.lastName,
          }
        : { _id: null, studentId: "-", firstName: "Deleted", lastName: "" },
      book: r.bookId
        ? { _id: r.bookId._id, title: r.bookId.title }
        : { _id: null, title: "Deleted" },
      reservedAt: r.reservedAt,
      dueDate: r.dueDate,
      status: r.status,
    }));

    res.json({ success: true, reservations: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch reservations" });
  }
});

export default router;
