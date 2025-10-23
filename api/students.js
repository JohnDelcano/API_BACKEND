import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Student from "../models/Student.js";
import Book from "../models/Book.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const router = express.Router();


// ---------------------------
// RECOMMENDED BOOKS
// ---------------------------

// Get top 10 recommended books (most favorited)
router.get("/recommended", async (req, res) => {
  try {
    const books = await Book.find()
      .sort({ favoritesCount: -1 }) // sort by favoritesCount descending
      .limit(10);

    res.json(books);
  } catch (err) {
    res.status(500).json({ message: "Error fetching recommended books", error: err.message });
  }
});

// Get top recommended books by genre
router.get("/recommended/genre/:genre", async (req, res) => {
  try {
    const { genre } = req.params;
    const books = await Book.find({ genre })
      .sort({ favoritesCount: -1 })
      .limit(10);

    res.json(books);
  } catch (err) {
    res.status(500).json({ message: "Error fetching recommended books by genre", error: err.message });
  }
});


// ---------------------------
// CONFIGURE CLOUDINARY
// ---------------------------
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

// ---------------------------
// FAVORITES
// ---------------------------

// Add book to favorites & increment favoritesCount
router.put("/:studentId/favorites/:bookId", async (req, res) => {
  try {
    const { studentId, bookId } = req.params;
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ message: "Book not found" });

    if (!student.favorites.includes(bookId)) {
      student.favorites.push(bookId);
      await student.save();

      book.favoritesCount = (book.favoritesCount || 0) + 1;
      await book.save();
    }

    res.json({ message: "Book added to favorites", favorites: student.favorites });
  } catch (err) {
    res.status(500).json({ message: "Error adding favorite", error: err.message });
  }
});

// Remove book from favorites & decrement favoritesCount
router.delete("/:studentId/favorites/:bookId", async (req, res) => {
  try {
    const { studentId, bookId } = req.params;
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ message: "Book not found" });

    student.favorites = student.favorites.filter((id) => id.toString() !== bookId);
    await student.save();

    book.favoritesCount = Math.max((book.favoritesCount || 1) - 1, 0);
    await book.save();

    res.json({ message: "Book removed from favorites", favorites: student.favorites });
  } catch (err) {
    res.status(500).json({ message: "Error removing favorite", error: err.message });
  }
});

// Get student favorites
router.get("/:studentId/favorites", async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId).populate("favorites");
    if (!student) return res.status(404).json({ message: "Student not found" });

    res.json(student.favorites);
  } catch (err) {
    res.status(500).json({ message: "Error fetching favorites", error: err.message });
  }
});

// ---------------------------
// AUTH & REGISTRATION
// ---------------------------

// Register
router.post("/register", upload.single("profilePicture"), async (req, res) => {
  try {
    const { firstName, lastName, email, password, birthday, phone, address, schoolname, guardian, guardianname, gender, genre } = req.body;
    if (!firstName || !lastName || !email || !password) return res.status(400).json({ message: "Missing required fields" });

    const emailLower = email.trim().toLowerCase();
    const existing = await Student.findOne({ email: emailLower });
    if (existing) return res.status(409).json({ message: "Email already taken" });

    const hash = await bcrypt.hash(password, 10);
    const profilePicture = req.file?.path ?? req.body.profilePicture;
    const birthdayDate = birthday ? new Date(birthday) : undefined;

    const student = new Student({ firstName, lastName, email: emailLower, password: hash, profilePicture, birthday: birthdayDate, phone, address, schoolname, guardian, guardianname, gender, genre });
    await student.save();

    res.status(201).json({ message: "Student registered", student: { ...student.toObject(), password: undefined } });
  } catch (err) {
    res.status(500).json({ message: "Registration error", error: err.message });
  }
});

// Google login
router.post("/google", async (req, res) => {
  try {
    const { email, firstName, lastName, profilePicture } = req.body;
    let student = await Student.findOne({ email });

    if (!student) {
      student = new Student({ email, firstName, lastName, profilePicture, password: "" });
      await student.save();
    }

    const token = jwt.sign({ id: student._id, email: student.email }, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });
    res.json({ message: "Login successful", token, student });
  } catch (err) {
    res.status(500).json({ message: "Google login error", error: err.message });
  }
});

// Sign in
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const student = await Student.findOne({ email });
    if (!student) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: student._id, email: student.email }, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });
    res.json({ message: "Login successful", token, student: { ...student.toObject(), password: undefined } });
  } catch (err) {
    res.status(500).json({ message: "Login error", error: err.message });
  }
});

// ---------------------------
// PROFILE
// ---------------------------

// Get current student
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: "Authorization header missing" });

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    const student = await Student.findById(decoded.id).select("-password");
    if (!student) return res.status(404).json({ message: "Student not found" });

    res.json({ student });
  } catch (err) {
    res.status(401).json({ message: "Invalid token", error: err.message });
  }
});

// Update profile
router.put("/me", upload.single("profilePicture"), async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: "Authorization header missing" });

    const token = auth.split(" ")[1];
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
