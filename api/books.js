import express from "express";
import Book from "../models/Book.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const router = express.Router();

// ---------------------------
// Cloudinary config
// ---------------------------
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
// GET recommended books (top favorites)
// ---------------------------
router.get("/recommended", async (req, res) => {
  try {
    const books = await Book.find().sort({ favoritesCount: -1 }).limit(10);
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
    const random = Math.floor(Math.random() * Math.max(count - 10, 0));
    const books = await Book.find().skip(random).limit(10);
    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting random books", error: error.message });
  }
});

// ---------------------------
// GET books by genre (normalized)
// ---------------------------
router.get("/genre/:genre", async (req, res) => {
  try {
    let { genre } = req.params;
    genre = genre.trim().toLowerCase();

    const books = await Book.find({
      genre: { $regex: `^${genre}$`, $options: "i" },
    });

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
    let { book_id, title, author, quantity, quality, genre } = req.body;
    const pictureUrl = req.file?.path ?? req.body.picture;

    // Normalize genre
    const normalizedGenre = Array.isArray(genre)
      ? genre.map(g => g.trim().toLowerCase())
      : genre?.trim().toLowerCase();

    const newBook = new Book({
      book_id,
      title,
      author,
      quantity,
      quality,
      availableCount: quantity,
      reservedCount: 0,
      borrowedCount: 0,
      genre: normalizedGenre,
      picture: pictureUrl,
      favoritesCount: 0,
    });

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
    if (!deletedBook) {
      return res.status(404).json({ success: false, message: "Book not found" });
    }

    res.status(200).json({ success: true, message: "Book deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error deleting book", error: error.message });
  }
});

// ---------------------------
// UPDATE a book (supports JSON + image upload)
// ---------------------------
router.put("/:id", async (req, res, next) => {
  // If multipart form, let multer handle it
  if (req.headers["content-type"]?.startsWith("multipart/form-data")) {
    upload.single("picture")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(500).json({ message: "Upload error", error: err.message });
      }
      handleUpdate(req, res);
    });
  } else {
    handleUpdate(req, res);
  }
});

async function handleUpdate(req, res) {
  try {
    const { id } = req.params;
    const existingBook = await Book.findById(id);
    if (!existingBook) return res.status(404).json({ message: "Book not found" });

    const { book_id, title, author, quantity, quality, genre, picture } = req.body;
    const pictureUrl = req.file?.path ?? picture ?? existingBook.picture;

    const normalizedGenre = genre
      ? Array.isArray(genre)
        ? genre.map((g) => g.trim().toLowerCase())
        : genre.trim().toLowerCase()
      : existingBook.genre;

    const update = {
      book_id: book_id ?? existingBook.book_id,
      title: title ?? existingBook.title,
      author: author ?? existingBook.author,
      quantity: quantity ?? existingBook.quantity,
      quality: quality ?? existingBook.quality,
      genre: normalizedGenre,
      picture: pictureUrl,
    };

    if (quantity && quantity !== existingBook.quantity) {
      const diff = quantity - existingBook.quantity;
      update.availableCount = (existingBook.availableCount || 0) + diff;
    }

    const updatedBook = await Book.findByIdAndUpdate(id, update, { new: true });
    res.json({ message: "Book updated successfully!", book: updatedBook });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ message: "Error updating book", error: error.message });
  }
}



// ---------------------------
// GET single book by ID
// ---------------------------
router.get("/:id", async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.status(200).json(book);
  } catch (error) {
    res.status(500).json({ message: "Error getting book", error: error.message });
  }
});

export default router;
