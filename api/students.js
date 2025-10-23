import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Student from "../models/Student.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "librosync/students",
    allowed_formats: ["jpg", "jpeg", "png"],
    transformation: [{ width: 800, crop: "limit" }],
  },
});

const upload = multer({ storage });


// Register (accepts optional profilePicture file)
router.post("/register", upload.single("profilePicture"), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      birthday,
      phone,
      address,
      schoolname,
      guardian,
      guardianname,
      gender,
      genre
    } = req.body;

    // Required fields check
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Normalize email
    const emailLower = email.trim().toLowerCase();

    // Check if email already exists
    const existing = await Student.findOne({ email: emailLower });
    if (existing) {
      return res.status(409).json({ message: "Email already taken" });
    }

    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Convert birthday string to Date
    const birthdayDate = birthday ? new Date(birthday) : undefined;

    // Get profile picture from Cloudinary or optional body
    const profilePicture = req.file?.path ?? req.body.profilePicture;

    // Create new student
    const student = new Student({
      firstName,
      lastName,
      email: emailLower,
      password: hash,
      profilePicture,
      birthday: birthdayDate,
      phone,
      address,
      schoolname,
      guardian,
      guardianname,
      gender,
      genre
    });

    await student.save();

    res.status(201).json({
      message: "Student registered",
      student: { ...student.toObject(), password: undefined }
    });
  } catch (err) {
    res.status(500).json({ message: "Registration error", error: err.message });
  }
});


// Sign in using email and password
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check required fields
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    // Find student by email
    const student = await Student.findOne({ email });
    if (!student) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const payload = { id: student._id, email: student.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      token,
      student: {
        id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        profilePicture: student.profilePicture,
        birthday: student.birthday,
        phone: student.phone,
        address: student.address,
        schoolname: student.schoolname,
        guardian: student.guardian,
        guardianname: student.guardianname,
        gender: student.gender,
        genre: student.genre
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Login error", error: err.message });
  }
});


// Get current student info (protected)
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: "Authorization header missing" });
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") return res.status(401).json({ message: "Invalid authorization format" });

    const token = parts[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    const student = await Student.findById(decoded.id).select("-password");
    if (!student) return res.status(404).json({ message: "Student not found" });
    res.json({ student });
  } catch (err) {
    res.status(401).json({ message: "Invalid token", error: err.message });
  }
});

// Update profile (optional profilePicture file)
router.put("/me", upload.single("profilePicture"), async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: "Authorization header missing" });
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") return res.status(401).json({ message: "Invalid authorization format" });

    const token = parts[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    const student = await Student.findById(decoded.id);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const { firstName, lastName, birthday, phone } = req.body;
    if (firstName) student.firstName = firstName;
    if (lastName) student.lastName = lastName;
    if (birthday) student.birthday = birthday;
    if (phone) student.phone = phone;
    const profilePicture = req.file?.path ?? req.body.profilePicture;
    if (profilePicture) student.profilePicture = profilePicture;

    await student.save();
    res.json({ message: "Profile updated", student: { ...student.toObject(), password: undefined } });
  } catch (err) {
    res.status(401).json({ message: "Invalid token", error: err.message });
  }
});

export default router;
