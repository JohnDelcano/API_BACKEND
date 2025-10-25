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
   Middleware: expire old reservations
----------------------------- */
async function expireOldReservations() {
  const now = new Date();
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
      $set: { cooldownUntil: computeCooldown() },
    });
    resv.status = "expired";
    await resv.save();
  }
}

/* -----------------------------
   POST /reserve/:bookId
   Reserve a book
----------------------------- */
router.post("/:bookId", authenticate, async (req, res) => {
  const student = req.user;
  const { bookId } = req.params;

  if (!isValidObjectId(bookId))
    return res.status(400).json({ success: false, error: "Invalid bookId" });

  try {
    await expireOldReservations();

    // Check cooldown first
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

      res.status(201).json({
        success: true,
        message: "Book reserved successfully.",
        reservation,
        student: studentDoc, // return updated student info
      });
    } finally {
      session.endSession();
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || "Reservation failed" });
  }
});

/* -----------------------------
   GET /my
   Fetch user reservations
----------------------------- */
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
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});

/* -----------------------------
   DELETE /:id
   Cancel reservation
----------------------------- */
router.delete("/:id", authenticate, async (req, res) => {
  const { id } = req.params;

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

      res.json({
        success: true,
        message: "Reservation cancelled",
        student: studentDoc, // return updated student info
      });
    } finally {
      session.endSession();
    }
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    res.status(400).json({ success: false, error: err.message || "Failed to cancel reservation" });
  }
});

// GET /api/reservation/all?libraryId=xxx
router.get("/all", async (req, res) => {
  try {
    const { libraryId } = req.query; // admin's library/branch
    if (!libraryId) {
      return res.status(400).json({ success: false, error: "Missing libraryId" });
    }

    const reservations = await Reservation.find()
      .populate({
        path: "bookId",
        select: "title",
      })
      .populate({
        path: "studentId",
        select: "name libraryId",
        match: { libraryId }, // only include students in the same library
      })
      .sort({ reservedAt: -1 });

    // Filter out any reservations where studentId didn't match
    const filtered = reservations.filter(r => r.studentId);

    const formatted = filtered.map(r => ({
      _id: r._id,
      studentId: r.studentId.libraryId,
      studentName: r.studentId.name,
      bookName: r.bookId.title,
      reservedAt: r.reservedAt,
      dueDate: r.expiresAt,
      status: r.status,
    }));

    res.json({ success: true, reservations: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});

// ---------------------------
// GET all reservations (admin view) with student info and actions
router.get("/admin/all", async (req, res) => {
  try {
    // fetch all reservations, populate book & student
    const reservations = await Reservation.find()
      .populate({ path: "bookId", select: "title" })       // book title
      .populate({ path: "studentId", select: "name libraryId" }) // student name + library ID
      .sort({ reservedAt: -1 });

    // format for frontend
    const formatted = reservations.map(r => ({
      _id: r._id,
      studentId: r.studentId?._id || "N/A",          // internal student ID
      studentLibraryId: r.studentId?.libraryId || "N/A",
      studentName: r.studentId?.name || "Unknown",
      bookId: r.bookId?._id || "N/A",
      bookTitle: r.bookId?.title || "Unknown",
      reservedAt: r.reservedAt,
      dueDate: r.expiresAt,
      status: r.status,
      actions: r.status === "reserved" ? ["approve", "decline"] : [], // frontend can render buttons
    }));

    res.json({ success: true, reservations: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});


// PATCH /api/reservation/:id/status
router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // "approved" or "declined"

  if (!["approved", "declined"].includes(status.toLowerCase()))
    return res.status(400).json({ success: false, error: "Invalid status" });

  try {
    const reservation = await Reservation.findById(id)
      .populate("bookId")
      .populate("studentId");

    if (!reservation) return res.status(404).json({ success: false, error: "Reservation not found" });

    const oldStatus = reservation.status;
    reservation.status = status.toLowerCase();
    await reservation.save();

    // If approved, increment borrowedCount and decrement availableCount
    if (status.toLowerCase() === "approved" && oldStatus === "reserved") {
      await Book.findByIdAndUpdate(reservation.bookId._id, {
        $inc: { borrowedCount: 1, reservedCount: -1 }
      });

    // If declined, release the book
    } else if (status.toLowerCase() === "declined" && oldStatus === "reserved") {
      await Book.findByIdAndUpdate(reservation.bookId._id, {
        $inc: { availableCount: 1, reservedCount: -1 }
      });
      await Student.findByIdAndUpdate(reservation.studentId._id, {
        $inc: { activeReservations: -1 }
      });
    }

    res.json({
      success: true,
      message: `Reservation ${status}`,
      reservation: {
        _id: reservation._id,
        studentId: reservation.studentId._id,
        studentLibraryId: reservation.studentId.libraryId,
        studentName: reservation.studentId.name,
        bookId: reservation.bookId._id,
        bookTitle: reservation.bookId.title,
        reservedAt: reservation.reservedAt,
        dueDate: reservation.expiresAt,
        status: reservation.status,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update status" });
  }
});




export default router;
