import mongoose from "mongoose";
const { Schema } = mongoose;

const reservationSchema  = new Schema({
  title: { type: String, required: true },
  author: { type: String },
  totalCount: { type: Number, default: 1 },
  availableCount: { type: Number, default: 1 },
  reservedCount: { type: Number, default: 0 },
  borrowedCount: { type: Number, default: 0 },
  lostCount: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ["Available", "Reserved", "Borrowed", "Lost"],
    default: "Available",
  },
}, { timestamps: true });

export default mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema);
