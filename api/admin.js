import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import { syncBookCounts } from "./utils/syncBookCounts.js";
import { authenticateAdmin } from "../auth.js";

const router = express.Router();

/* -----------------------------
   ✅ Admin Registration (One-time use)
----------------------------- */
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required." });

    // Check if admin already exists
    const existing = await Admin.findOne({ email });
    if (existing)
      return res.status(400).json({ success: false, message: "Admin already exists." });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin
    const admin = new Admin({
      email,
      password: hashedPassword,
    });

    await admin.save();

    res.json({
      success: true,
      message: "Admin created successfully.",
      admin: { email: admin.email, _id: admin._id },
    });
  } catch (error) {
    console.error("❌ Admin register error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/* -----------------------------
   🔑 Admin Login - returns JWT
----------------------------- */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const admin = await Admin.findOne({ email });
    if (!admin)
      return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, admin.password);
    if (!match)
      return res.status(401).json({ message: "Invalid credentials" });

    const payload = { id: admin._id, email: admin.email, type: admin.type };
    const token = jwt.sign(payload, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });

    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login error", error: err.message });
  }
});

/* -----------------------------
   ⚙️ Sync Book Counts (Protected)
----------------------------- */
router.post("/sync-book-counts", authenticateAdmin, async (req, res) => {
  try {
    const io = req.app.get("io");
    const updatedBooks = await syncBookCounts(io);

    res.json({
      success: true,
      message: `Book counts synced successfully for ${updatedBooks.length} books.`,
    });
  } catch (err) {
    console.error("Sync error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to sync book counts",
      error: err.message,
    });
  }
});

export default router;
