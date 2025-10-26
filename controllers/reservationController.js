// controllers/reservationController.js
import { io } from "../server.js"; // import io instance

export const approveReservation = async (req, res) => {
  const { id } = req.params;
  const reservation = await Reservation.findByIdAndUpdate(
    id,
    { status: "approved" },
    { new: true }
  ).populate("bookId");

  // update book counts here...

  // ✅ notify all clients in real time
  io.emit("reservationUpdated", {
    bookId: reservation.bookId._id,
    status: "approved",
  });

  res.json({ success: true, reservation });
};
