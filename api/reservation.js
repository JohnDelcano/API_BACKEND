import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticate, authenticateAdmin } from "../auth.js";

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

    if (studentDoc.status !== "Active") {
      throw new Error("Your account must be verified before reserving books.");
    }

    const activeApproved = await Reservation.countDocuments({
      studentId: studentDoc._id,
      status: "approved",
    });
    if (activeApproved >= MAX_ACTIVE_RESERVATIONS)
      throw new Error(`You can only have ${MAX_ACTIVE_RESERVATIONS} borrowed books.`);

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

    // ✅ Populate before emitting
    const populated = await Reservation.findById(reservation._id)
      .populate("studentId", "studentId firstName lastName")
      .populate("bookId", "title");

    // ✅ Emit updates
    io.to(studentDoc._id.toString()).emit("reservationCreated", populated.toObject());
    io.to("admins").emit("adminReservationUpdated", {
      _id: populated._id,
      student: populated.studentId,
      book: populated.bookId,
      reservedAt: populated.reservedAt,
      dueDate: populated.dueDate,
      status: populated.status,
    });

    // ✅ Respond once
    res.status(201).json({
      success: true,
      message: "Book reserved successfully.",
      reservation: populated,
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
/* ---------------------------------------
   ✏ PATCH /api/reservation/:id/status
   Update status (approve / decline / returned / lost)
--------------------------------------- */
router.patch("/:id/status", authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const io = req.app.get("io");

  if (!["approved", "declined", "returned"].includes(status)) {
    return res.status(400).json({ success: false, error: "Invalid status" });
  }

  try {
    const reservation = await Reservation.findById(id)
      .populate("bookId", "title availableCount reservedCount")
      .populate("studentId", "studentId firstName lastName");

    if (!reservation) {
      return res.status(404).json({ success: false, error: "Reservation not found" });
    }

    // Update reservation status
    reservation.status = status;
    if (status === "approved") {
      reservation.approvedAt = new Date();
      reservation.dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // example 7-day borrow
    }
    if (status === "returned") {
      reservation.returnedAt = new Date();
    }

    await reservation.save();

    // Adjust book counts
    const book = reservation.bookId;
    if (status === "declined") {
      book.availableCount += 1;
      book.reservedCount = Math.max(0, book.reservedCount - 1);
    } else if (status === "returned") {
      book.availableCount += 1;
    }
    await book.save();

    // ✅ Send real-time updates
    const studentRoom = reservation.studentId._id.toString();

    // Emit to the student (so their “Reserve” button updates)
    io.to(studentRoom).emit("reservationStatusChanged", {
      _id: reservation._id,
      status: reservation.status,
      book: {
        _id: book._id,
        title: book.title,
        availableCount: book.availableCount,
      },
    });

    // Emit to admins (so dashboard refreshes live)
    io.to("admins").emit("adminReservationUpdated", {
      _id: reservation._id,
      student: reservation.studentId,
      book: reservation.bookId,
      status: reservation.status,
      updatedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      message: `Reservation ${status} successfully.`,
      reservation,
    });
  } catch (error) {
    console.error("❌ Error updating reservation status:", error);
    res.status(500).json({ success: false, error: "Server error" });
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
