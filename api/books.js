import express from "express";
import Book from "../models/Book.js";
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
    folder: "librosync/books",
    allowed_formats: ["jpg", "jpeg", "png"],
    transformation: [{ width: 1200, crop: "limit" }],
  },
});

const upload = multer({ storage });

// GET all books
router.get("/", async (req, res) => {
  try {
    const books = await Book.find();
    res.status(201).json({ message: "Book added successfully!", book: newBook });
  } catch (error) {
    res.status(500).json({ message: "Error getting books", error });
  }
});

// POST new book
router.post("/", upload.single("picture"), async (req, res) => {
  try {
    const { book_id, title, author, quantity, quality } = req.body;
    // Prefer uploaded file URL, fallback to picture from body (if provided)
    const pictureUrl = req.file?.path ?? req.body.picture;
    const newBook = new Book({ book_id, title, author, quantity, quality, picture: pictureUrl });
    await newBook.save();
    res.status(201).json({ message: "Book added successfully!", book: newBook });
  } catch (error) {
    res.status(500).json({ message: "Error adding book", error });
  }
});

// Delete a book
router.delete("/:id", async (req, res) => {
  try {
    const deletedBook = await Book.findByIdAndDelete(req.params.id);
    if (!deletedBook) {
      return res.status(404).json({ message: "Book not found" });
    }
    res.json({ message: "Book deleted successfully", book: deletedBook });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update a book
router.put("/:id", upload.single("picture"), async (req, res) => {
  try {
    const { book_id, title, author, quantity, quality } = req.body;
    const pictureUrl = req.file?.path ?? req.body.picture;

    // Build update object
    const update = { book_id, title, author, quantity, quality };
    if (pictureUrl) update.picture = pictureUrl;

    // Find the book by ID and update it
    const updatedBook = await Book.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true } // new: true returns the updated document
    );

    if (!updatedBook) {
      return res.status(404).json({ message: "Book not found" });
    }

    res.json({ message: "Book updated successfully!", book: updatedBook });
  } catch (err) {
    res.status(500).json({ message: "Error updating book", error: err.message });
  }
});

export default router;
