// api/reservation.js
import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticate } from "../auth.js";

const router = express.Router();

// Limits and cooldown constants
const MAX_ACTIVE_RESERVATIONS = 1;
const COOLDOWN_MINUTES = 10;
const RESERVATION_EXPIRY_HOURS = 1;

// Compute cooldown timestamp
const computeCooldown = () => new Date(Date.now() + COOLDOWN_MINUTES * 60 * 1000);

// Mongo ObjectId validation
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Start transaction safely
async function startSessionWithTxn() {
  try {
    const session = await mongoose.startSession();
    let txnStarted = false;
    try {
      session.startTransaction();
      txnStarted = true;
    } catch {
      console.warn("Transactions unavailable — proceeding without transaction.");
    }
    return { session, txnStarted };
  } catch (err) {
    console.error("Failed to start Mongo session:", err);
    return { session: null, txnStarted: false };
  }
}

/* ---------------------------------------------------------
   🔄 Auto-expire reservations (middleware)
--------------------------------------------------------- */
async function expireOldReservations() {
  const now = new Date();

  // Find reservations past expiry but still marked "reserved"
  const expired = await Reservation.find({
    status: "reserved",
    expiresAt: { $lt: now },
  });

  for (const resv of expired) {
    await Book.findByIdAndUpdate(resv.bookId, {
      $inc: { availableCount: 1, reservedCount: -1 },
    });
    await Student.findByIdAndUpdate(resv.studentId, {
      $inc: { activeReservations: -1 },
      $set: { cooldownUntil: computeCooldown() }, // start 10-min cooldown
    });

    resv.status = "expired";
    await resv.save();
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

  try {
    // Expire any old reservations first
    await expireOldReservations();

    // Check for active cooldown
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
    session.endSession();

    res.status(201).json({
      success: true,
      message: "Book reserved successfully.",
      reservation,
    });
  } catch (err) {
    console.error("Reserve error:", err);
    res.status(400).json({
      success: false,
      error: err.message || "Reservation failed",
    });
  }
});

/* ---------------------------------------------------------
   🟡 GET /api/reservation/my
   Get user’s reservations
--------------------------------------------------------- */
router.get("/my", authenticate, async (req, res) => {
  try {
    await expireOldReservations();

    const reservations = await Reservation.find({ studentId: req.user._id })
      .populate("bookId")
      .sort({ reservedAt: -1 });

    const cooldownRemaining =
      req.user.cooldownUntil && req.user.cooldownUntil > new Date()
        ? Math.ceil((req.user.cooldownUntil - new Date()) / 1000)
        : 0;

    res.json({
      success: true,
      reservations,
      cooldown: {
        active: cooldownRemaining > 0,
        remainingSeconds: cooldownRemaining,
        until: req.user.cooldownUntil,
      },
    });
  } catch (err) {
    console.error(err);
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
