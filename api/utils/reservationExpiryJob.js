// src/utils/reservationExpiryJob.js
import Reservation from "../../models/Reservation.js";
import Book from "../../models/Book.js";
import Student from "../../models/Student.js";
import { sendSMSReminder } from "./smsService.js";

export async function expireOldReservations(io) {
  const now = new Date();
  const soon = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes ahead

  try {
    // 🔔 Step 1: Send SMS reminder for soon-to-expire reservations
    const soonToExpire = await Reservation.find({
      status: "reserved",
      expiresAt: { $gt: now, $lt: soon },
      reminderSent: false,
    })
      .populate("studentId")
      .populate("bookId");

    for (const resv of soonToExpire) {
      await sendSMSReminder(resv.studentId, resv, resv.bookId);
      resv.reminderSent = true;
      await resv.save();
    }

    // ⏰ Step 2: Mark overdue reservations as expired
    const expiredReservations = await Reservation.find({
      status: "reserved",
      expiresAt: { $lt: now },
    });

    for (const resv of expiredReservations) {
      await Book.findByIdAndUpdate(
        resv.bookId,
        { $inc: { availableCount: 1, reservedCount: -1 }, status: "Available" },
        { new: true }
      );

      await Student.findByIdAndUpdate(
        resv.studentId,
        { $inc: { activeReservations: -1 } },
        { new: true }
      );

      resv.status = "expired";
      await resv.save();

      if (io) io.emit("reservationUpdated", resv);
    }

    if (soonToExpire.length > 0 || expiredReservations.length > 0)
      console.log(
        `⏰ Expired ${expiredReservations.length}, reminded ${soonToExpire.length} reservations`
      );
  } catch (error) {
    console.error("Error in reservation expiry job:", error.message);
  }
}
