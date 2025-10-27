import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Student from "../../models/Student.js";


const router = express.Router();

router.post("/login", async (req, res) => {
  const { studentId, password } = req.body;
  const student = await Student.findOne({ studentId });
  if (!student) return res.status(404).json({ success: false, error: "Student not found" });

  const isMatch = await bcrypt.compare(password, student.password);
  if (!isMatch) return res.status(400).json({ success: false, error: "Invalid credentials" });

  // ✅ Create token with student's _id
  const token = jwt.sign({ id: student._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

  res.json({ success: true, token });
});

export default router;
