import mongoose from "mongoose";

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String },
  quantity: { type: Number, default: 1 },
  availableCount: { type: Number, default: 1 },
  reservedCount: { type: Number, default: 0 },
  borrowedCount: { type: Number, default: 0 },
  lostCount: { type: Number, default: 0 },
  genre: [{ type: String }],
  picture: { type: String },
  status: {
    type: String,
    enum: ["Available", "Reserved", "Borrowed", "Lost"],
    default: "Available",
  },
});

export default mongoose.models.Book || mongoose.model("Book", bookSchema);
