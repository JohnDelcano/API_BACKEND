import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticate } from "../auth.js";

const router = express.Router();

// Constants
const MAX_ACTIVE_RESERVATIONS = 3; // Increased to 3
const RESERVATION_EXPIRY_HOURS = 1; // 1 hour for pickup

// Validate ObjectId
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
   Expire old reservations
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
    }, { new: true });
    resv.status = "expired";
    await resv.save();

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

    const { session, txnStarted } = await startSessionWithTxn();

    try {
      const studentDoc = await Student.findById(student._id).session(session);
      if (!studentDoc) throw new Error("Student not found");

      if ((studentDoc.activeReservations || 0) >= MAX_ACTIVE_RESERVATIONS)
        throw new Error(`You can only reserve up to ${MAX_ACTIVE_RESERVATIONS} books`);

      const book = await Book.findOneAndUpdate(
        { _id: bookId, availableCount: { $gt: 0 } },
        { $inc: { availableCount: -1, reservedCount: 1 } },
        { new: true, session }
      );

      if (!book) throw new Error("No available copies");

      const expiresAt = new Date(Date.now() + RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000);

      const [reservation] = await Reservation.create(
        [{
          bookId,
          studentId: studentDoc._id,
          reservedAt: new Date(),
          expiresAt,
          status: "reserved",
        }],
        { session }
      );

      studentDoc.activeReservations = (studentDoc.activeReservations || 0) + 1;
      await studentDoc.save({ session });

      if (txnStarted) await session.commitTransaction();

      io.emit("reservationUpdated", { ...reservation.toObject(), student: studentDoc });

      res.status(201).json({
        success: true,
        message: "Book reserved successfully",
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

  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ success: false, error: "Invalid reservation id" });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await Reservation.findById(id).session(session);
    if (!reservation) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, error: "Reservation not found" });
    }

    if (reservation.studentId.toString() !== req.user._id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (reservation.status !== "reserved") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        error: `Cannot cancel a reservation that is ${reservation.status}`,
      });
    }

    // Update book counts
    await Book.findByIdAndUpdate(
      reservation.bookId,
      { $inc: { availableCount: 1, reservedCount: -1 } },
      { session }
    );

    // Update student active reservations
    await Student.findByIdAndUpdate(
      reservation.studentId,
      { $inc: { activeReservations: -1 } },
      { session }
    );

    reservation.status = "cancelled";
    await reservation.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Broadcast cancellation
    io.emit("reservationUpdated", { ...reservation.toObject() });

    res.json({ success: true, message: "Reservation cancelled" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to cancel reservation" });
  }
});


/* -----------------------------
   PATCH /:id/status (approve/decline)
----------------------------- */
router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const io = req.app.get("io");

  try {
    const reservation = await Reservation.findById(id).populate("studentId");
    if (!reservation) return res.status(404).json({ success: false, message: "Reservation not found" });

    reservation.status = status;

    if (status === "approved") {
      reservation.dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      reservation.studentId.activeReservations = Math.max(reservation.studentId.activeReservations, 0);
      await reservation.studentId.save();
    }

    await reservation.save();

    io.emit("reservationUpdated", reservation);

    res.json({ success: true, reservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

/* -----------------------------
   GET /my (get my reservations)
----------------------------- */
router.get("/my", authenticate, async (req, res) => {
  try {
    const reservations = await Reservation.find({ studentId: req.user._id }).populate("bookId");
    res.json({ success: true, reservations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch reservations" });
  }
});

export default router;
