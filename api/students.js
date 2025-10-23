import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Student from "../models/Student.js";
import Book from "../models/Book.js";

const router = express.Router();

// ---------------------------
// RECOMMENDED BOOKS
// ---------------------------
router.get("/recommended", async (req, res) => {
  try {
    const books = await Book.find().sort({ favoritesCount: -1 }).limit(10);
    res.json({ success: true, data: books });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching recommended books", error: err.message });
  }
});

router.get("/recommended/genre/:genre", async (req, res) => {
  try {
    const { genre } = req.params;
    const books = await Book.find({ genre }).sort({ favoritesCount: -1 }).limit(10);
    res.json({ success: true, data: books });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching recommended books by genre", error: err.message });
  }
});

// ---------------------------
// FAVORITES
// ---------------------------
router.put("/:studentId/favorites/:bookId", async (req, res) => {
  try {
    const { studentId, bookId } = req.params;

    const student = await Student.findByIdAndUpdate(
      studentId,
      { $addToSet: { favorites: bookId } },
      { new: true }
    );
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    await Book.findByIdAndUpdate(bookId, { $inc: { favoritesCount: 1 } });

    res.json({ success: true, message: "Book added to favorites", favorites: student.favorites });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error adding favorite", error: err.message });
  }
});

router.delete("/:studentId/favorites/:bookId", async (req, res) => {
  try {
    const { studentId, bookId } = req.params;

    const student = await Student.findByIdAndUpdate(
      studentId,
      { $pull: { favorites: bookId } },
      { new: true }
    );
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    await Book.findByIdAndUpdate(bookId, { $inc: { favoritesCount: -1 } });

    res.json({ success: true, message: "Book removed from favorites", favorites: student.favorites });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error removing favorite", error: err.message });
  }
});

router.get("/:studentId/favorites", async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId).populate("favorites");
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    res.json({ success: true, data: student.favorites });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching favorites", error: err.message });
  }
});

// ---------------------------
// AUTH & REGISTRATION
// ---------------------------
router.post("/register", async (req, res) => {
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
      genre,
      profilePicture
    } = req.body;

    if (!firstName || !lastName || !email || !password)
      return res.status(400).json({ success: false, message: "Missing required fields" });

    const emailLower = email.trim().toLowerCase();
    const existing = await Student.findOne({ email: emailLower });
    if (existing) return res.status(409).json({ success: false, message: "Email already taken" });

    const hash = await bcrypt.hash(password, 10);

    // Ensure genre is an array
    const parsedGenre = Array.isArray(genre) ? genre : JSON.parse(genre || "[]");
    const birthdayDate = birthday ? new Date(birthday) : undefined;

    const student = new Student({
      firstName,
      lastName,
      email: emailLower,
      password: hash,
      profilePicture, // Cloudinary URL
      birthday: birthdayDate,
      phone,
      address,
      schoolname,
      guardian,
      guardianname,
      gender,
      genre: parsedGenre
    });

    await student.save();

    res.status(201).json({
      success: true,
      message: "Student registered",
      student: { ...student.toObject(), password: undefined }
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ success: false, message: "Registration error", error: err.message });
  }
});

// ---------------------------
// GOOGLE LOGIN
// ---------------------------
router.post("/google", async (req, res) => {
  try {
    const { email, firstName, lastName, profilePicture } = req.body;
    let student = await Student.findOne({ email });

    if (!student) {
      student = new Student({ email, firstName, lastName, profilePicture, password: "" });
      await student.save();
    }

    const token = jwt.sign(
      { id: student._id, email: student.email },
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "7d" }
    );

    res.json({ success: true, message: "Login successful", token, student });
  } catch (err) {
    res.status(500).json({ success: false, message: "Google login error", error: err.message });
  }
});

// ---------------------------
// SIGNIN
// ---------------------------
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

    const student = await Student.findOne({ email });
    if (!student) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign(
      { id: student._id, email: student.email },
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "7d" }
    );

    res.json({ success: true, message: "Login successful", token, student: { ...student.toObject(), password: undefined } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Login error", error: err.message });
  }
});

// ---------------------------
// PROFILE
// ---------------------------
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ success: false, message: "Authorization header missing" });

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    const student = await Student.findById(decoded.id).select("-password");
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    res.json({ success: true, student });
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid token", error: err.message });
  }
});

router.put("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ success: false, message: "Authorization header missing" });

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    const student = await Student.findById(decoded.id);
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    // Update profile fields
    const fields = ["firstName", "lastName", "birthday", "phone", "address", "schoolname", "guardian", "guardianname", "gender", "genre", "profilePicture"];
    fields.forEach(field => {
      if (req.body[field]) {
        if (field === "genre") {
          student.genre = Array.isArray(req.body.genre) ? req.body.genre : JSON.parse(req.body.genre || "[]");
        } else {
          student[field] = req.body[field];
        }
      }
    });

    await student.save();
    res.json({ success: true, message: "Profile updated", student: { ...student.toObject(), password: undefined } });
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid token", error: err.message });
  }
});

export default router;
