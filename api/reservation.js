import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticate } from "../auth.js";

const router = express.Router();

// Constants
const MAX_ACTIVE_RESERVATIONS = 1;
const COOLDOWN_MINUTES = 10;
const RESERVATION_EXPIRY_HOURS = 1;

// Compute cooldown timestamp
const computeCooldown = () => new Date(Date.now() + COOLDOWN_MINUTES * 60 * 1000);

// ObjectId validation
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Start session with optional transaction
async function startSessionWithTxn() {
  const session = await mongoose.startSession();
  let txnStarted = false;
  try {
    session.startTransaction();
    txnStarted = true;
  } catch {
    console.warn("Transactions unavailable — proceeding without transaction.");
  }
  return { session, txnStarted };
}

/* -----------------------------
   Expire old reservations and broadcast updates
----------------------------- */
async function expireOldReservations(io) {
  const now = new Date();
  const expired = await Reservation.find({
    status: "reserved",
    expiresAt: { $lt: now },
  });

  for (const resv of expired) {
    await Book.findByIdAndUpdate(resv.bookId, {
      $inc: { availableCount: 1, reservedCount: -1 },
    });
    const studentDoc = await Student.findByIdAndUpdate(resv.studentId, {
      $inc: { activeReservations: -1 },
      $set: { cooldownUntil: computeCooldown() },
    }, { new: true });
    resv.status = "expired";
    await resv.save();

    // Broadcast expiration
    io.emit("reservationUpdated", {
      ...resv.toObject(),
      student: studentDoc,
    });
  }
}

/* -----------------------------
   POST /reserve/:bookId
----------------------------- */
router.post("/:bookId", authenticate, async (req, res) => {
  const student = req.user;
  const { bookId } = req.params;
  const io = req.app.get("io");

  if (!isValidObjectId(bookId))
    return res.status(400).json({ success: false, error: "Invalid bookId" });

  try {
    await expireOldReservations(io);

    // Check cooldown
    if (student.cooldownUntil && student.cooldownUntil > new Date()) {
      const remainingMs = student.cooldownUntil - new Date();
      return res.status(403).json({
        success: false,
        error: "Cooldown active. Please wait before reserving again.",
        cooldownUntil: student.cooldownUntil,
        remainingSeconds: Math.ceil(remainingMs / 1000),
      });
    }

    const { session, txnStarted } = await startSessionWithTxn();

    try {
      const studentDoc = await Student.findById(student._id).session(session);
      if (!studentDoc) throw new Error("Student not found");

      if ((studentDoc.activeReservations || 0) >= MAX_ACTIVE_RESERVATIONS)
        throw new Error("You already have an active reservation");

      const book = await Book.findOneAndUpdate(
        { _id: bookId, availableCount: { $gt: 0 } },
        { $inc: { availableCount: -1, reservedCount: 1 } },
        { new: true, session }
      );

      if (!book) throw new Error("No available copies");

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

      studentDoc.activeReservations = (studentDoc.activeReservations || 0) + 1;
      await studentDoc.save({ session });

      if (txnStarted) await session.commitTransaction();

      // Broadcast new reservation
      io.emit("reservationUpdated", { ...reservation.toObject(), student: studentDoc });

      res.status(201).json({
        success: true,
        message: "Book reserved successfully.",
        reservation,
        student: studentDoc,
      });
    } finally {
      session.endSession();
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || "Reservation failed" });
  }
});

/* -----------------------------
   DELETE /:id (cancel reservation)
----------------------------- */
router.delete("/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const io = req.app.get("io");

  if (!isValidObjectId(id))
    return res.status(400).json({ success: false, error: "Invalid reservation id" });

  const { session, txnStarted } = await startSessionWithTxn();

  try {
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

      const studentDoc = await Student.findByIdAndUpdate(
        reservation.studentId,
        { $inc: { activeReservations: -1 } },
        { new: true, session }
      );

      reservation.status = "cancelled";
      await reservation.save({ session });

      if (txnStarted) await session.commitTransaction();

      // Broadcast cancellation
      io.emit("reservationUpdated", { ...reservation.toObject(), student: studentDoc });

      res.json({
        success: true,
        message: "Reservation cancelled",
        student: studentDoc,
      });
    } finally {
      session.endSession();
    }
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    res.status(400).json({ success: false, error: err.message || "Failed to cancel reservation" });
  }
});

/* -----------------------------
   PATCH /:id/status (approve/decline)
----------------------------- */
router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // "approved" | "declined"
  const io = req.app.get("io");

  try {
    const reservation = await Reservation.findById(id).populate("student");
    if (!reservation) return res.status(404).json({ success: false, message: "Reservation not found" });

    reservation.status = status;

    if (status === "approved") {
      reservation.dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      reservation.student.activeReservations = Math.max(reservation.student.activeReservations, 0);
      await reservation.student.save();
    }

    await reservation.save();

    // Broadcast status update
    io.emit("reservationUpdated", reservation);

    res.json({ success: true, reservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

export default router;
