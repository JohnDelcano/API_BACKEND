import mongoose from "mongoose";

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String },
  quantity: { type: Number, default: 1 },
  availableCount: { type: Number, default: 1 },
  reservedCount: { type: Number, default: 0 },
  borrowedCount: { type: Number, default: 0 },
  lostCount: { type: Number, default: 0 },
  pdfFile: { type: String, default: null },
  overview: { type: String, default: "" },
  category: [{ type: String }],
  picture: { type: String },
  status: {
    type: String,
    enum: ["Available", "Reserved", "Borrowed", "Lost", "Not Available"],
    default: "Available",
  },
}, { timestamps: true });

bookSchema.pre("save", function (next) {
  if (this.lostCount > 0) {
    this.status = "Lost";
  } else if (this.borrowedCount > 0) {
    this.status = "Borrowed";
  } else if (this.reservedCount > 0) {
    this.status = "Reserved";
  } else if (this.availableCount === 0) {
    this.status = "Not Available"; // Set to "Not Available" when no copies are available
  } else {
    this.status = "Available";
  }
  next();
});

export default mongoose.models.Book || mongoose.model("Book", bookSchema);
