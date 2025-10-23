import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";

const router = express.Router();

// Register a new admin (only for initial setup)
router.post("/register", async (req, res) => {
  try {
    const { email, password, type } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const existing = await Admin.findOne({ email });
    if (existing) return res.status(409).json({ message: "Admin already exists" });

    const hash = await bcrypt.hash(password, 10);
    const admin = new Admin({ email, password: hash, type });
    await admin.save();
    res.status(201).json({ message: "Admin created" });
  } catch (err) {
    res.status(500).json({ message: "Error creating admin", error: err.message });
  }
});

// Login - returns JWT
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    const payload = { id: admin._id, email: admin.email, type: admin.type };
    const token = jwt.sign(payload, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: "Login error", error: err.message });
  }
});

// Protected route: get current admin info
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: "Authorization header missing" });
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") return res.status(401).json({ message: "Invalid authorization format" });

    const token = parts[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    const admin = await Admin.findById(decoded.id).select("-password");
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json({ admin });
  } catch (err) {
    res.status(401).json({ message: "Invalid token", error: err.message });
  }
});

export default router;
