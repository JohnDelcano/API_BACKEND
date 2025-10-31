import express from "express";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticate, authenticateAdmin } from "../auth.js";

const router = express.Router();

const MAX_ACTIVE_RESERVATIONS = 3;
const RESERVATION_EXPIRY_HOURS = 2;

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
  🕒 Expire Old Reservations
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
      status: "Available",
    });

    resv.status = "expired";
    await resv.save();

    // 🔔 Notify both student and admin in real-time
    io.to(resv.studentId.toString()).emit("reservationUpdated", resv.toObject());
    io.to("admins").emit("reservationUpdated", resv.toObject());
  }
}

/* ---------------------------------------
  📘 GET /api/reservation
--------------------------------------- */
router.get("/", authenticate, async (req, res) => {
  try {
    const reservations = await Reservation.find({ studentId: req.user._id })
      .populate("bookId", "title author picture status availableCount reservedCount")
      .populate("studentId", "studentId firstName lastName");

    res.json({ success: true, reservations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch reservations" });
  }
});


/* ---------------------------------------
  🟢 POST /api/reservation/:bookId
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
    if (book) {
  io.emit("bookStatusUpdated", {
    bookId: book._id,
    availableCount: book.availableCount,
    reservedCount: book.reservedCount,
    status: book.status,
  });
}
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

    const populated = await Reservation.findById(reservation._id)
      .populate("studentId", "studentId firstName lastName")
      .populate("bookId", "title");

      io.emit("reservationCreated", populated.toObject());
      io.emit("reservationUpdated", populated.toObject());


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
  ✏ PATCH /api/reservation/:id/status
--------------------------------------- */
router.patch("/:id/status", authenticateAdmin, async (req, res) => {
  try {
    const io = req.app.get("io");
    const { id } = req.params;
    const { status } = req.body;

    const reservation = await Reservation.findById(id)
      .populate("bookId")
      .populate("studentId");

    if (!reservation)
      return res.status(404).json({ success: false, message: "Reservation not found." });

    reservation.status = status;

    // ✅ STATUS: APPROVED
    if (status === "approved") {
      reservation.dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      const book = await Book.findById(reservation.bookId._id);
      if (book) {
        // 🧩 Adjust counters properly
        if (book.reservedCount > 0) book.reservedCount -= 1;
        book.borrowedCount = (book.borrowedCount || 0) + 1;
        book.status = book.availableCount > 0 ? "Available" : "Not Available";
        await book.save();

        // 🟢 Emit real-time update to all clients
        io.emit("bookStatusUpdated", {
          bookId: book._id,
          availableCount: book.availableCount,
          reservedCount: book.reservedCount,
          borrowedCount: book.borrowedCount,
          status: book.status,
        });
      }

      // Update student's active reservations
      const student = await Student.findById(reservation.studentId._id);
      if (student) {
        student.activeReservations = (student.activeReservations || 0) + 1;
        await student.save();
      }

      // Notify the student that reservation was approved
      const studentIdStr =
        typeof reservation.studentId === "object"
          ? reservation.studentId._id?.toString()
          : reservation.studentId?.toString();

      if (studentIdStr) {
        io.to(studentIdStr).emit("reservationApproved", reservation);
        io.to(studentIdStr).emit("reservationUpdated", reservation);
      }
    }

    // ✅ STATUS: RETURNED
    else if (status === "returned") {
      const book = await Book.findById(reservation.bookId._id);
      if (book) {
        if (book.borrowedCount > 0) book.borrowedCount -= 1;
        book.availableCount += 1;
        book.status = book.availableCount > 0 ? "Available" : "Not Available";
        await book.save();

        io.emit("bookStatusUpdated", {
          bookId: book._id,
          availableCount: book.availableCount,
          reservedCount: book.reservedCount,
          borrowedCount: book.borrowedCount,
          status: book.status,
        });
      }

      const student = await Student.findById(reservation.studentId._id);
      if (student && student.activeReservations > 0) {
        student.activeReservations -= 1;
        await student.save();
      }

      const studentIdStr =
        typeof reservation.studentId === "object"
          ? reservation.studentId._id?.toString()
          : reservation.studentId?.toString();

      if (studentIdStr) {
        io.to(studentIdStr).emit("reservationUpdated", reservation);
      }
    }

    // ✅ STATUS: DECLINED
    else if (status === "declined") {
      const book = await Book.findById(reservation.bookId._id);
      if (book) {
        book.availableCount += 1;
        if (book.reservedCount > 0) book.reservedCount -= 1;
        book.status = book.availableCount > 0 ? "Available" : "Not Available";
        await book.save();

        io.emit("bookStatusUpdated", {
          bookId: book._id,
          availableCount: book.availableCount,
          reservedCount: book.reservedCount,
          borrowedCount: book.borrowedCount,
          status: book.status,
        });
      }

      const studentIdStr =
        typeof reservation.studentId === "object"
          ? reservation.studentId._id?.toString()
          : reservation.studentId?.toString();

      if (studentIdStr) {
        io.to(studentIdStr).emit("reservationCancelled", reservation);
        io.to(studentIdStr).emit("reservationUpdated", reservation);
      }

      io.to("admins").emit("reservationCancelled", reservation);
      io.to("admins").emit("reservationUpdated", reservation);
    }

    // ✅ Save the updated reservation
    await reservation.save();

    // Emit general update to admins
    io.to("admins").emit("reservationUpdated", reservation);

    res.json({ success: true, reservation });
  } catch (err) {
    console.error("❌ Error updating reservation:", err);
    res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
});



router.delete("/:id", authenticate, async (req, res) => {
  try {
    const io = req.app.get("io"); 

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ error: "Reservation not found" });
    if (reservation.studentId?.toString() !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
    if (["approved", "returned", "completed"].includes(reservation.status))
      return res.status(400).json({ error: "Cannot cancel this reservation" });

    reservation.status = "cancelled";
    await reservation.save();

    const updatedBook = await Book.findByIdAndUpdate(
      reservation.bookId,
      {
        $inc: { reservedCount: -1, availableCount: 1 }, 
        status: "Available",
      },
      { new: true }
    );

    // ✅ Emit book and reservation updates
    if (updatedBook) {
      io.emit("bookStatusUpdated", {
        bookId: updatedBook._id,
        availableCount: updatedBook.availableCount,
        reservedCount: updatedBook.reservedCount,
        status: updatedBook.status,
      });
    }
    const studentIdStr =
      typeof reservation.studentId === "object"
        ? reservation.studentId._id?.toString()
        : reservation.studentId?.toString();
    if (studentIdStr) {
      // Notify user's other devices/sessions
      io.to(studentIdStr).emit("reservationCancelled", reservation); 
      io.to(studentIdStr).emit("reservationUpdated", reservation); // Added this for consistency
    }
    io.to("admins").emit("reservationCancelled", reservation);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Cancel error:", err);
    res.status(500).json({ error: "Failed to cancel reservation" });
  }
});

// ⚠️ ADMIN CLEANUP: Delete ALL reservations (use carefully!)
router.delete("/admin/delete-all", authenticateAdmin, async (req, res) => {
  try {
    const result = await Reservation.deleteMany({});
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} reservations from database.`,
    });
  } catch (err) {
    console.error("❌ Delete all reservations error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete reservations",
      error: err.message,
    });
  }
});

  //🧾 GET /api/reservation/admin/all
router.get("/admin/all", async (req, res) => {
  try {
    const reservations = await Reservation.find()
      .populate("studentId", "studentId firstName lastName")
      .populate("bookId", "title author picture")
    const formatted = reservations.map((r) => ({
      _id: r._id,
      studentId: r.studentId
        ? {
            _id: r.studentId._id,
            studentId: r.studentId.studentId,
            firstName: r.studentId.firstName,
            lastName: r.studentId.lastName,
          }
        : { _id: null, studentId: "-", firstName: "Deleted", lastName: "" },
      bookId: r.bookId
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

  //👤 GET /api/reservation/my
router.get("/my", authenticate, async (req, res) => {
  try {
    const studentId = req.user.id;
    const reservations = await Reservation.find({ studentId })
      .populate("bookId", "_id title author picture status availableCount reservedCount")
      .sort({ createdAt: -1 });
    res.json({ success: true, reservations });
  } catch (err) {
    console.error("❌ Fetch my reservations error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch reservations" });
  }
});
export default router;