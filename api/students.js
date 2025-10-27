import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Student from "../models/Student.js";
import Book from "../models/Book.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { io } from "../server.js";

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
    folder: "students",
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const upload = multer({ storage });

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

// ---------------------------
// VERIFY STUDENT (Admin Action)
// ---------------------------
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cooldownUntil, activeReservations } = req.body;

    const student = await Student.findByIdAndUpdate(
      id,
      {
        $set: {
          status: status || "Active",
          cooldownUntil: cooldownUntil || null,
          activeReservations: activeReservations ?? 0,
        },
      },
      { new: true }
    ).select("-password");

    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    res.json({
      success: true,
      message: `${student.firstName} ${student.lastName} has been verified.`,
      student,
    });
  } catch (err) {
    console.error("Error verifying student:", err);
    res.status(500).json({ success: false, message: "Failed to verify student", error: err.message });
  }
  io.to(student._id.toString()).emit("userVerified", { status: student.status });
});


// ---------------------------
// ---------------------------
// GET ALL STUDENTS (for admin view)
// ---------------------------
router.get("/", async (req, res) => {
  try {
    const students = await Student.find().select("-password"); // exclude password for security
    res.json({ success: true, data: students });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error fetching students",
      error: err.message
    });
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { studentId, bookId } = req.params;

    const book = await Book.findById(bookId).session(session);
    if (!book) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Book not found" });
    }

    const student = await Student.findByIdAndUpdate(
      studentId,
      { $addToSet: { favorites: bookId } },
      { new: true, session }
    );

    if (!student) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    book.favoritesCount += 1;
    await book.save({ session });

    await session.commitTransaction();
    res.json({ success: true, message: "Book added to favorites", favorites: student.favorites });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: "Error adding favorite", error: err.message });
  } finally {
    session.endSession();
  }
});

router.delete("/:studentId/favorites/:bookId", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { studentId, bookId } = req.params;

    const book = await Book.findById(bookId).session(session);
    if (!book) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Book not found" });
    }

    const student = await Student.findByIdAndUpdate(
      studentId,
      { $pull: { favorites: bookId } },
      { new: true, session }
    );

    if (!student) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    book.favoritesCount = Math.max(0, book.favoritesCount - 1);
    await book.save({ session });

    await session.commitTransaction();
    res.json({ success: true, message: "Book removed from favorites", favorites: student.favorites });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: "Error removing favorite", error: err.message });
  } finally {
    session.endSession();
  }
});

// ---------------------------
// CHANGE EMAIL (with old email confirmation)
// ---------------------------
router.put("/me/email", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth)
      return res.status(401).json({ success: false, message: "Authorization header missing" });

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    const { oldEmail, newEmail } = req.body;

    if (!oldEmail || !newEmail) {
      return res.status(400).json({ success: false, message: "Old and new email are required" });
    }

    const student = await Student.findById(decoded.id);
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    // Check if old email matches current one
    if (student.email.trim().toLowerCase() !== oldEmail.trim().toLowerCase()) {
      return res.status(401).json({ success: false, message: "Old email does not match current account" });
    }

    // Prevent duplicate new email
    const existing = await Student.findOne({ email: newEmail.trim().toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, message: "New email is already in use" });

    // Update email
    student.email = newEmail.trim().toLowerCase();
    await student.save();

    res.json({
      success: true,
      message: "Email updated successfully",
      student: { ...student.toObject(), password: undefined },
    });
  } catch (err) {
    console.error("Email update error:", err);
    res.status(500).json({ success: false, message: "Error updating email", error: err.message });
  }
});


// ---------------------------
// CHANGE PASSWORD (secure with bcrypt)
// ---------------------------
router.put("/me/password", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth)
      return res.status(401).json({ success: false, message: "Authorization header missing" });

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Old and new passwords are required" });
    }

    const student = await Student.findById(decoded.id).select("+password");
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    // Compare old password
    const isMatch = await bcrypt.compare(oldPassword, student.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Old password is incorrect" });
    }

    // Prevent reusing the same password
    const samePassword = await bcrypt.compare(newPassword, student.password);
    if (samePassword) {
      return res.status(400).json({ success: false, message: "New password cannot be the same as the old one" });
    }

    // Hash new password and save
    const salt = await bcrypt.genSalt(10);
    student.password = await bcrypt.hash(newPassword, salt);
    await student.save();

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ success: false, message: "Error updating password", error: err.message });
  }
});




router.get("/:studentId/favorites", async (req, res) => {
  const { studentId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(studentId)) {
    return res.status(400).json({ success: false, message: "Invalid student ID", favorites: [] });
  }

  try {
    const student = await Student.findById(studentId).populate("favorites");
    if (!student) return res.status(404).json({ success: false, message: "Student not found", favorites: [] });

    res.json({ success: true, favorites: student.favorites || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching favorites", error: err.message, favorites: [] });
  }
});

// ---------------------------
// AUTH & REGISTRATION
// ---------------------------
router.post("/register", async (req, res) => {
  try {
    const {
      firstName, lastName, email, password,
      birthday, phone, address, schoolname,
      guardian, guardianname, gender, genre, grade,
      profilePicture, validIDs
    } = req.body;

    if (!validIDs || validIDs.length < 2) {
      return res.status(400).json({ success: false, message: "2 valid ID pictures required" });
    }

    if (!firstName || !lastName || !email || !password || !profilePicture) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Validate phone numbers
    if (phone && isNaN(Number(phone))) return res.status(400).json({ success: false, message: "Phone must be a number" });
    if (guardian && isNaN(Number(guardian))) return res.status(400).json({ success: false, message: "Guardian phone must be a number" });

    // Check if email already exists
    const emailLower = email.trim().toLowerCase();
    const existing = await Student.findOne({ email: emailLower });
    if (existing) return res.status(409).json({ success: false, message: "Email already taken" });

    // Generate unique Library ID
    const currentYear = new Date().getFullYear();
    let studentId;
    while (true) {
      const count = await Student.countDocuments({ studentId: { $regex: `^${currentYear}-` } });
      studentId = `${currentYear}-${(count + 1).toString().padStart(4, "0")}`;

      const duplicate = await Student.findOne({ studentId });
      if (!duplicate) break; // unique ID found
    }

    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Parse optional fields
    const parsedGenre = Array.isArray(genre) ? genre : JSON.parse(genre || "[]");
    const birthdayDate = birthday ? new Date(birthday) : undefined;

    // Create student
    const student = new Student({
      studentId,
      firstName,
      lastName,
      email: emailLower,
      password: hash,
      profilePicture,
      validIDs,
      birthday: birthdayDate,
      phone: phone ? Number(phone) : undefined,
      address,
      schoolname,
      guardian: guardian ? Number(guardian) : undefined,
      guardianname,
      gender,
      genre: parsedGenre,
      grade
    });

    await student.save();

    res.status(201).json({
      success: true,
      message: "Student registered successfully",
      student: { ...student.toObject(), password: undefined }
    });

  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ success: false, message: "Registration error", error: err.message });
  }
});




// GOOGLE LOGIN
router.post("/google", async (req, res) => {
  try {
    const { email, firstName, lastName, profilePicture } = req.body;
    let student = await Student.findOne({ email });

    if (!student) {
      student = new Student({ email, firstName, lastName, profilePicture, password: "" });
      await student.save();
    }

    const token = jwt.sign({ id: student._id, email: student.email }, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });

    res.json({ success: true, message: "Login successful", token, student });
  } catch (err) {
    res.status(500).json({ success: false, message: "Google login error", error: err.message });
  }
});


// SIGNIN
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

    const student = await Student.findOne({ email: email.trim().toLowerCase() });
    if (!student) return res.status(401).json({ success: false, message: "Invalid email" });

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid password" });

    const token = jwt.sign({ id: student._id, email: student.email,  libraryID: student.libraryID }, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });

    res.json({ success: true, message: "Login successful", token, student: { ...student.toObject(), password: undefined } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Login error", error: err.message });
  }
});



// PROFILE
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

    const fields = ["firstName", "lastName", "birthday", "phone", "address", "schoolname", "guardian", "guardianname", "gender", "genre", "profilePicture", "grade"];
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

router.put("/:studentId/active", async (req, res) => {
  try {
    const { studentId } = req.params;
    await Student.findByIdAndUpdate(studentId, {
      $set: { lastActive: new Date(), status: "Active" },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});




export default router;
