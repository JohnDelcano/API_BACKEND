// api/reservation.js
import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";

// Handle mixed exports
Book = Book && Book.default ? Book.default : Book;
Student = Student && Student.default ? Student.default : Student;
Reservation = Reservation && Reservation.default ? Reservation.default : Reservation;

const MAX_ACTIVE_RESERVATIONS = 1;
const COOLDOWN_MINUTES = [1, 5, 30]; // cooldown backoff

function computeCooldown(attempt) {
  const mins = COOLDOWN_MINUTES[Math.min(attempt - 1, COOLDOWN_MINUTES.length - 1)];
  return new Date(Date.now() + mins * 60 * 1000);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Utility for safe transactions
async function startSessionWithTxn() {
  try {
    const session = await mongoose.startSession();
    let txnStarted = false;
    try {
      session.startTransaction();
      txnStarted = true;
    } catch (err) {
      console.warn("Transactions unavailable — proceeding without transaction.");
    }
    return { session, txnStarted };
  } catch (err) {
    console.error("Failed to start Mongo session:", err);
    return { session: null, txnStarted: false };
  }
}

/* ---------------------------------------------------------
   🟢 POST /api/reservation/:bookId
   Reserve a book
--------------------------------------------------------- */
router.post("/:bookId", authenticate, async (req, res) => {
  const student = req.user;
  const { bookId } = req.params;

  if (!isValidObjectId(bookId)) {
    return res.status(400).json({ success: false, error: "Invalid bookId" });
  }

  if (student.cooldownUntil && student.cooldownUntil > new Date()) {
    const diffMs = student.cooldownUntil - new Date();
    return res.status(403).json({
      success: false,
      error: "Cooldown active",
      cooldownUntil: student.cooldownUntil,
      remainingSeconds: Math.ceil(diffMs / 1000),
    });
  }

  const { session, txnStarted } = await startSessionWithTxn();
  try {
    const studentDoc = await Student.findById(student._id).session(session);
    if (!studentDoc)
      throw new Error("Student not found");

    if ((studentDoc.activeReservations || 0) >= MAX_ACTIVE_RESERVATIONS)
      throw new Error("You already have an active reservation");

    const book = await Book.findOneAndUpdate(
      { _id: bookId, availableCount: { $gt: 0 } },
      { $inc: { availableCount: -1, reservedCount: 1 } },
      { new: true, session }
    );

    if (!book)
      throw new Error("No available copies");

    const reservationDoc = {
      bookId,
      studentId: studentDoc._id,
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "reserved",
    };

    const [reservation] = await Reservation.create([reservationDoc], { session });

    studentDoc.activeReservations = (studentDoc.activeReservations || 0) + 1;
    await studentDoc.save({ session });

    if (txnStarted) await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success: true, reservation });
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    if (session) session.endSession();
    console.error("Reserve error:", err);
    res.status(400).json({ success: false, error: err.message || "Reservation failed" });
  }
});

/* ---------------------------------------------------------
   🟡 GET /api/reservation/my
   Get user’s reservations
--------------------------------------------------------- */
router.get("/my", authenticate, async (req, res) => {
  try {
    const reservations = await Reservation.find({ studentId: req.user._id })
      .populate("bookId")
      .sort({ reservedAt: -1 });
    res.json({ success: true, reservations });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});

/* ---------------------------------------------------------
   🔴 DELETE /api/reservation/:id
   Cancel reservation
--------------------------------------------------------- */
router.delete("/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id))
    return res.status(400).json({ success: false, error: "Invalid reservation id" });

  const { session, txnStarted } = await startSessionWithTxn();
  try {
    const reservation = await Reservation.findById(id).session(session);
    if (!reservation) throw new Error("Reservation not found");

    if (reservation.studentId.toString() !== req.user._id.toString())
      throw new Error("Not authorized");

    if (reservation.status !== "reserved")
      throw new Error("Reservation already expired or cancelled");

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

    if (txnStarted) await session.commitTransaction();
    session.endSession();

    res.json({ success: true, message: "Reservation cancelled" });
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    if (session) session.endSession();
    res.status(400).json({ success: false, error: err.message || "Failed to cancel reservation" });
  }
});

export default router;
