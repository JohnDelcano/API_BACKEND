import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  profilePicture: { type: String, default: "" },
  birthday: { type: Date },
  phone: { type: number },
  address: { type: String },
  schoolname: { type: String },
  guardian: { type: number },
  guardianname: { type: String },
  gender: { type: String },
  genre: { type: [String], default: [] }, 
  grade: { type: String, required: true }, 
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
}, { timestamps: true });

export default mongoose.model("Student", studentSchema);
