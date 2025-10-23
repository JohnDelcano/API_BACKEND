import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePicture: { type: String },
  birthday: { type: Date },
  phone: { type: String },
  address: { type: String },
  grade: { type: String },
  schoolname: { type: String },
  guardian: { type: String },
  guardianname: { type: String },
  gender: { type: String },
  genre: { type: [String], default: [] },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Student", studentSchema);
