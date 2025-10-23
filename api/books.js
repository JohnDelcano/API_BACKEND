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

// ---------------------------
// GET all books
// ---------------------------
router.get("/", async (req, res) => {
  try {
    const books = await Book.find();
    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting books", error: error.message });
  }
});

// ---------------------------
// GET recommended books (sorted by favoritesCount)
// ---------------------------
router.get("/recommended", async (req, res) => {
  try {
    const books = await Book.find().sort({ favoritesCount: -1 }).limit(10); // top 10
    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting recommended books", error: error.message });
  }
});

// ---------------------------
// GET random books
// ---------------------------
router.get("/random", async (req, res) => {
  try {
    const count = await Book.countDocuments();
    const random = Math.floor(Math.random() * count);
    const books = await Book.find().skip(random).limit(10); // random 10 books
    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting random books", error: error.message });
  }
});

// ---------------------------
// GET books by genre
// ---------------------------
router.get("/genre/:genre", async (req, res) => {
  try {
    const { genre } = req.params;
    const books = await Book.find({ genre });
    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting books by genre", error: error.message });
  }
});

// ---------------------------
// POST new book
// ---------------------------
router.post("/", upload.single("picture"), async (req, res) => {
  try {
    const { book_id, title, author, quantity, quality, genre } = req.body;
    const pictureUrl = req.file?.path ?? req.body.picture;
    const newBook = new Book({ book_id, title, author, quantity, quality, genre, picture: pictureUrl, favoritesCount: 0 });
    await newBook.save();
    res.status(201).json({ message: "Book added successfully!", book: newBook });
  } catch (error) {
    res.status(500).json({ message: "Error adding book", error: error.message });
  }
});

// ---------------------------
// DELETE a book
// ---------------------------
router.delete("/:id", async (req, res) => {
  try {
    const deletedBook = await Book.findByIdAndDelete(req.params.id);
    if (!deletedBook) return res.status(404).json({ message: "Book not found" });
    res.json({ message: "Book deleted successfully", book: deletedBook });
  } catch (error) {
    res.status(500).json({ message: "Error deleting book", error: error.message });
  }
});

// ---------------------------
// UPDATE a book
// ---------------------------
router.put("/:id", upload.single("picture"), async (req, res) => {
  try {
    const { book_id, title, author, quantity, quality, genre } = req.body;
    const pictureUrl = req.file?.path ?? req.body.picture;

    const update = { book_id, title, author, quantity, quality, genre };
    if (pictureUrl) update.picture = pictureUrl;

    const updatedBook = await Book.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!updatedBook) return res.status(404).json({ message: "Book not found" });
    res.json({ message: "Book updated successfully!", book: updatedBook });
  } catch (error) {
    res.status(500).json({ message: "Error updating book", error: error.message });
  }
});

export default router;
