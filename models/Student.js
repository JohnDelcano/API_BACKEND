import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  profilePicture: { type: String, default: "" },
  validIDs: { type: [String], default: [] },
  birthday: { type: Date },
  phone: { type: String },
  address: { type: String },
  schoolname: { type: String },
  guardian: { type: String },
  guardianname: { type: String },
  gender: { type: String },
  genre: { type: [String], default: [] },
  grade: { type: String, required: true },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
  activeReservations: { type: Number, default: 0 },
  cooldownUntil: { type: Date },
  status: {
    type: String,
    enum: ["Pending", "Active", "Inactive", "Blocked"],
    default: "Pending",
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  failedReservationAttempts: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("Student", studentSchema);
