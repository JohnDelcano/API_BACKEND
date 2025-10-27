import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import { syncBookCounts } from "./utils/syncBookCounts.js"; // ⬅️ import our utility
import { authenticateAdmin } from "../auth.js"; // optional: add admin authentication middleware

const router = express.Router();

/* -----------------------------
   Admin Login - returns JWT
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

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login error", error: err.message });
  }
});

/* -----------------------------
   POST /sync-book-counts
   Recalculate and fix all book counts
----------------------------- */
router.post("/sync-book-counts", authenticateAdmin, async (req, res) => {
  try {
    const io = req.app.get("io"); // get socket instance
    const updatedBooks = await syncBookCounts(io); // pass io for real-time updates
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
