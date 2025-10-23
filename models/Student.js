import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePicture: { type: String },
  birthday: { type: Date },
  phone: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Student", studentSchema);
