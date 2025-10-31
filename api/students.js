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
import { authenticate } from "../auth.js";


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



// Example: Admin approves a reservation
router.patch("/approve/:reservationId", authenticate, async (req, res) => {
  const { reservationId } = req.params;

  try {
    const reservation = await Reservation.findById(reservationId).populate('student book');
    if (!reservation) return res.status(404).json({ error: "Reservation not found" });

    const student = reservation.student;
    const book = reservation.book;

    // Mark reservation as approved
    reservation.status = "approved";
    await reservation.save();

    // Increment activeReservations for the student
    student.activeReservations += 1;
    await student.save();

    // Mark the book as borrowed
    book.status = "borrowed";
    book.availableCount -= 1;
    book.reservedCount += 1;
    await book.save();

    // Emit event to notify frontend about the approval
    io.emit("reservationApproved", { reservationId, studentId: student._id });

    res.json({ success: true, message: "Reservation approved", reservation });
  } catch (err) {
    res.status(500).json({ error: "Failed to approve reservation" });
  }
});


// VERIFY STUDENT (Admin Action)
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


// GET ALL STUDENTS (for admin view)
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


// Admin marks the book as returned/completed
router.patch("/book/:bookId/status", authenticate, async (req, res) => {
  const { bookId } = req.params;
  const { status } = req.body;

  try {
    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ error: "Book not found" });

    let student;

    // Update book status when returned/completed
    if (status === "returned" || status === "completed") {
      // Reset book status to "Available"
      book.status = "Available";
      book.availableCount += 1;  // Increment available count
      book.reservedCount -= 1;   // Decrease reserved count

      // Find the student who had the reservation and update activeReservations
      student = await Student.findOne({ activeReservations: { $gt: 0 } }).where('reservations.bookId').equals(bookId);
      if (student) {
        // Decrease active reservations by 1 for the student who had the reservation
        student.activeReservations -= 1;
        await student.save();
      }
    }

    await book.save();

    // Emit event to notify frontend (book status updated)
    io.emit("bookStatusUpdated", { bookId, studentId: student?._id });

    res.json({ success: true, message: "Book status updated", book });
  } catch (err) {
    res.status(500).json({ error: "Failed to update book status" });
  }
});


router.get("/recommended/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    const books = await Book.find({ category }).sort({ favoritesCount: -1 }).limit(10);
    res.json({ success: true, data: books });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching recommended books by category", error: err.message });
  }
});


// FAVORITES
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


// TOGGLE FAVORITE
router.post("/favorites/toggle", authenticate, async (req, res) => {
  try {
    const { bookId } = req.body;
    const student = await Student.findById(req.user._id);
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });

    const alreadyFav = student.favorites.some(f => f.toString() === bookId);

    if (alreadyFav) {
      // 🔻 Remove favorite
      student.favorites = student.favorites.filter(f => f.toString() !== bookId);
      book.favoritesCount = Math.max(0, (book.favoritesCount || 0) - 1);
    } else {
      // ❤️ Add favorite
      student.favorites.push(bookId);
      book.favoritesCount = (book.favoritesCount || 0) + 1;
    }

    await Promise.all([student.save(), book.save()]);

    const updated = await student.populate("favorites", "title author picture category status");

    // 🔔 Real-time update (optional)
    try {
      const io = req.app.get("io");
      if (io) io.to(student._id.toString()).emit("favoritesUpdated", updated.favorites);
    } catch {}

    return res.json({ success: true, favorites: updated.favorites });
  } catch (err) {
    console.error("❌ Toggle favorite error:", err);
    return res.status(500).json({ success: false, message: "Failed to toggle favorite" });
  }
});


// MERGE GUEST FAVORITES
router.post("/:id/favorites/merge", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { favorites } = req.body;

    const student = await Student.findById(id);
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    const merged = [...new Set([...student.favorites.map(f => f.toString()), ...(favorites || [])])];
    student.favorites = merged;

    await student.save();
    const updated = await student.populate("favorites", "title author picture category status");

    return res.json({ success: true, favorites: updated.favorites });
  } catch (err) {
    console.error("❌ Merge favorites error:", err);
    return res.status(500).json({ success: false, message: "Failed to merge favorites" });
  }
});


router.get("/:id/favorites", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id).populate("favorites", "title author picture category status");
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    return res.json({ success: true, favorites: student.favorites });
  } catch (err) {
    console.error("❌ Fetch favorites error:", err);
    return res.status(500).json({ success: false, message: "Failed to get favorites" });
  }
});

// CHANGE EMAIL (with old email confirmation)
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


// AUTH & REGISTRATION
router.post("/register", async (req, res) => {
  try {
    const {
      firstName, lastName, email, password,
      birthday, phone, address, schoolname,
      guardian, guardianname, gender, category, grade,
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
    const parsedCategory = Array.isArray(category) ? category : JSON.parse(category || "[]");
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
      category: parsedCategory,
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
// SIGNIN
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: "Email and password required" });

    const student = await Student.findOne({ email: email.trim().toLowerCase() });
    if (!student)
      return res.status(401).json({ success: false, message: "Invalid email" });

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch)
      return res.status(401).json({ success: false, message: "Invalid password" });

    // ✅ Generate proper JWT token
    const token = jwt.sign(
      { id: student._id, email: student.email, studentId: student.studentId }, // <-- FIXED
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "7d" }
    );

    // ✅ Clean sensitive fields
    const cleanStudent = { ...student.toObject(), password: undefined };

    res.json({
      success: true,
      message: "Login successful",
      token,
      student: cleanStudent,
    });
  } catch (err) {
    console.error("Login error:", err);
    res
      .status(500)
      .json({ success: false, message: "Login error", error: err.message });
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

    const fields = ["firstName", "lastName", "birthday", "phone", "address", "schoolname", "guardian", "guardianname", "gender", "category", "profilePicture", "grade"];
    fields.forEach(field => {
      if (req.body[field]) {
        if (field === "category") {
          student.category = Array.isArray(req.body.category) ? req.body.category : JSON.parse(req.body.category || "[]");
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
