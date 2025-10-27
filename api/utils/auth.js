// routes/api/auth.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Student from "../../models/Student.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

router.post("/login", async (req, res) => {
  try {
    const { studentId, password } = req.body;
    const student = await Student.findOne({ studentId });
    if (!student) return res.status(404).json({ success: false, error: "Student not found" });

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) return res.status(400).json({ success: false, error: "Invalid credentials" });

    // ✅ Token uses the same secret as middleware
    const token = jwt.sign({ id: student._id }, JWT_SECRET, { expiresIn: "7d" });

    res.json({ success: true, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
