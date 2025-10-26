import mongoose from "mongoose";

const logSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  timeIn: { type: Date, default: Date.now },
  timeOut: { type: Date },
  status: { type: String, enum: ["Checked In", "Checked Out", "Pending"], default: "Checked In" },
}, { timestamps: true });

const Log = mongoose.model("Log", logSchema);

export default Log; // ✅ default export
