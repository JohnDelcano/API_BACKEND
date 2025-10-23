const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Book = require("../models/Book");
const Student = require("../models/Student");
const Reservation = require("../models/Reservation");
const { authenticate, isAdmin } = require("../middleware/auth");

const MAX_ACTIVE_RESERVATIONS = 1;
const COOLDOWN_MINUTES = [1, 5, 30]; // cooldown backoff

function computeCooldown(attempt) {
  const mins = COOLDOWN_MINUTES[Math.min(attempt - 1, COOLDOWN_MINUTES.length - 1)];
  return new Date(Date.now() + mins * 60 * 1000);
}

// Helper: start a session and attempt to start a transaction
async function startSessionWithTxn() {
  try {
    const session = await mongoose.startSession();
    let txnStarted = false;
    try {
      session.startTransaction();
      txnStarted = true;
    } catch (err) {
      // Transactions unavailable (likely standalone mongod). Proceed without txn.
      console.warn("Transactions unavailable: proceeding without transaction.", err?.message);
    }
    return { session, txnStarted };
  } catch (err) {
    // startSession failed (rare). Log and return no session/txn so callers fall back safely.
    console.error("Failed to start Mongo session:", err && err.message);
    return { session: null, txnStarted: false };
  }
}

/**
 * POST /api/books/:bookId/reserve
 * Reserve a book
 */
router.post("/:bookId/reserve", authenticate, async (req, res) => {
  const student = req.user;
  const bookId = req.params.bookId;

  // cooldown check
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
    // fetch student doc inside session
    const studentQuery = Student.findById(student._id);
    if (session) studentQuery.session(session);
    const studentDoc = await studentQuery.exec();

    if ((studentDoc.activeReservations || 0) >= MAX_ACTIVE_RESERVATIONS) {
      if (txnStarted) await session.abortTransaction();
      if (session) session.endSession();
      return res.status(403).json({ success: false, error: "You already have an active reservation" });
    }

    // decrement book availability
    const bookQuery = Book.findOneAndUpdate(
      { _id: bookId, availableCount: { $gt: 0 } },
      { $inc: { availableCount: -1, reservedCount: 1 } },
      { new: true }
    );
    if (session) bookQuery.session(session);
    const book = await bookQuery.exec();
    if (!book) {
      if (txnStarted) await session.abortTransaction();
      if (session) session.endSession();
      return res.status(400).json({ success: false, error: "No available copies" });
    }

    // create reservation
    const reservationDoc = {
      bookId,
      studentId: studentDoc._id,
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const reservation = await Reservation.create([reservationDoc], session ? { session } : {});
    studentDoc.activeReservations = (studentDoc.activeReservations || 0) + 1;
    if (session) await studentDoc.save({ session }); else await studentDoc.save();

    if (txnStarted) await session.commitTransaction();
    if (session) session.endSession();

    res.status(201).json({ success: true, reservation: reservation[0] });
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    if (session) session.endSession();
    console.error("Reserve error:", err);
    const msg = err?.message || "Reservation failed";
    // Map some common messages to HTTP status codes for better client handling.
    let status = 500;
    if (/No available copies/i.test(msg)) status = 400;
    else if (/active reservation/i.test(msg) || /already have an active reservation/i.test(msg)) status = 403;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * GET /api/students/:studentId/reservations
 */
router.get("/students/:studentId/reservations", authenticate, async (req, res) => {
  // enforce that only student or admin can query
  if (!req.user.isAdmin && req.user._id.toString() !== req.params.studentId) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  try {
    const reservations = await Reservation.find({ studentId: req.params.studentId })
      .populate("bookId")
      .sort({ reservedAt: -1 });
    res.json({ success: true, reservations });
  } catch (err) {
    console.error("Failed to list reservations for student", req.params.studentId, err);
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});

/**
 * GET /api/reservations/:id
 */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id).populate("bookId studentId");
    if (!reservation) return res.status(404).json({ success: false, error: "Reservation not found" });
    if (!req.user.isAdmin && reservation.studentId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    res.json({ success: true, reservation });
  } catch (err) {
    console.error("Failed to get reservation", req.params.id, err);
    res.status(500).json({ success: false, error: "Failed to fetch reservation" });
  }
});

/**
 * DELETE /api/reservations/:id
 */
router.delete("/:id", authenticate, async (req, res) => {
  const { session, txnStarted } = await startSessionWithTxn();
  try {
    const reservationQuery = Reservation.findById(req.params.id);
    if (session) reservationQuery.session(session);
    const reservation = await reservationQuery.exec();
    if (!reservation) throw new Error("Reservation not found");

    if (!req.user.isAdmin && reservation.studentId.toString() !== req.user._id.toString()) {
      throw new Error("Not authorized to cancel this reservation");
    }

    if (reservation.status === "reserved") {
      const bookQuery = Book.findByIdAndUpdate(reservation.bookId, { $inc: { availableCount: 1, reservedCount: -1 } });
      if (session) bookQuery.session(session);
      await bookQuery.exec();

      const studentQuery = Student.findById(reservation.studentId);
      if (session) studentQuery.session(session);
      const student = await studentQuery.exec();
      student.activeReservations = Math.max((student.activeReservations || 1) - 1, 0);
      if (session) await student.save({ session }); else await student.save();
    }

    reservation.status = "cancelled";
    if (session) await reservation.save({ session }); else await reservation.save();

    if (txnStarted) await session.commitTransaction();
    if (session) session.endSession();

    res.json({ success: true, message: "Reservation cancelled" });
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    if (session) session.endSession();
    console.error("Failed to cancel reservation", req.params.id, err);
    const msg = err?.message || "Failed to cancel reservation";
    let status = 400;
    if (/not found/i.test(msg)) status = 404;
    else if (/not authorized/i.test(msg)) status = 403;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/reservations/:id/mark-borrowed
 */
router.put("/:id/mark-borrowed", authenticate, isAdmin, async (req, res) => {
  const { session, txnStarted } = await startSessionWithTxn();
  try {
    const reservationQuery = Reservation.findById(req.params.id);
    if (session) reservationQuery.session(session);
    const reservation = await reservationQuery.exec();
    if (!reservation) throw new Error("Reservation not found");
    if (reservation.status !== "reserved") throw new Error("Reservation cannot be marked borrowed");

    reservation.status = "borrowed";
    reservation.pickedUpAt = new Date();
    if (session) await reservation.save({ session }); else await reservation.save();

    const bookQuery = Book.findByIdAndUpdate(reservation.bookId, { $inc: { borrowedCount: 1, reservedCount: -1 } });
    if (session) bookQuery.session(session);
    await bookQuery.exec();

    const studentQuery = Student.findById(reservation.studentId);
    if (session) studentQuery.session(session);
    const student = await studentQuery.exec();
    student.activeReservations = Math.max((student.activeReservations || 1) - 1, 0);
    if (session) await student.save({ session }); else await student.save();

    if (txnStarted) await session.commitTransaction();
    if (session) session.endSession();

    res.json({ success: true, reservation });
  } catch (err) {
    if (txnStarted) await session.abortTransaction();
    if (session) session.endSession();
    console.error("Failed to mark reservation borrowed", req.params.id, err);
    const msg = err?.message || "Failed to mark borrowed";
    let status = 400;
    if (/not found/i.test(msg)) status = 404;
    else if (/not authorized/i.test(msg)) status = 403;
    else if (/cannot be marked borrowed/i.test(msg)) status = 400;
    else status = 500;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * Expiry job
 */
async function expireReservationsBatch(limit = 100) {
  const now = new Date();
  const expired = await Reservation.find({ status: "reserved", expiresAt: { $lte: now } })
    .sort({ expiresAt: 1 })
    .limit(limit)
    .exec();
  if (!expired || expired.length === 0) return 0;

  for (const r of expired) {
    const { session, txnStarted } = await startSessionWithTxn();
    try {
      const opts = session ? { session } : {};
      await Reservation.findByIdAndUpdate(r._id, { status: "expired" }, opts);
      await Book.findByIdAndUpdate(r.bookId, { $inc: { availableCount: 1, reservedCount: -1 } }, opts);

      const studentQuery = Student.findById(r.studentId);
      if (session) studentQuery.session(session);
      const student = await studentQuery.exec();
      if (!student) {
        // Student missing — log and continue (ensure we don't crash the batch)
        console.warn("Student for reservation not found:", r.studentId, "reservation:", r._id);
      } else {
        const failedAttempts = (student.failedReservationAttempts || 0) + 1;
        student.failedReservationAttempts = failedAttempts;
        student.cooldownUntil = computeCooldown(failedAttempts);
        student.activeReservations = Math.max((student.activeReservations || 1) - 1, 0);
        if (session) await student.save({ session }); else await student.save();
      }

      if (txnStarted) await session.commitTransaction();
    } catch (err) {
      if (txnStarted) await session.abortTransaction();
      console.error("Failed to expire reservation", r._id, err);
    } finally {
      if (session) session.endSession();
    }
  }

  return expired.length;
}

// Self-scheduling loop
let expireJobRunning = false;
async function expireReservationsLoop() {
  if (expireJobRunning) return;
  expireJobRunning = true;
  try {
    let processed;
    do {
      processed = await expireReservationsBatch(100);
      if (processed > 0) await new Promise(r => setTimeout(r, 200));
    } while (processed > 0);
  } catch (err) {
    console.error("expireReservationsLoop failed", err);
  } finally {
    expireJobRunning = false;
    setTimeout(expireReservationsLoop, 30 * 1000);
  }
}
setImmediate(expireReservationsLoop);

module.exports = router;
