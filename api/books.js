// routes/books.js
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

// Single CloudinaryStorage - switch behavior by fieldname
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    // For pdfFile field -> upload as raw resource to folder "librosync/pdfs"
    if (file.fieldname === "pdfFile") {
      return {
        folder: "librosync/pdfs",
        resource_type: "raw", // important for non-image
        allowed_formats: ["pdf"],
      };
    }

    // Default -> picture (images)
    return {
      folder: "librosync/books",
      allowed_formats: ["jpg", "jpeg", "png"],
      transformation: [{ width: 1200, crop: "limit" }],
    };
  },
});

const upload = multer({ storage });

// ---------------------------
// GET all books
// ---------------------------
router.get("/", async (req, res) => {
  try {
    const books = await Book.find({ status: { $ne: "Lost" } });

    // Recompute availableCount dynamically
    const booksWithCounts = books.map((b) => ({
      ...b.toObject(),
      availableCount:
        (b.quantity || 0) -
        (b.borrowedCount || 0) -
        (b.reservedCount || 0) -
        (b.lostCount || 0),
    }));

    res.status(200).json(booksWithCounts);
  } catch (error) {
    res.status(500).json({ message: "Error getting books", error: error.message });
  }
});

router.get("/updates", async (req, res) => {
  try {
    const books = await Book.find().sort({ updatedAt: -1 }).limit(10);
    res.json(books);
  } catch (err) {
    res.status(500).json({ message: err.message });
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
// GET books by category
// ---------------------------
router.get("/category/:category", async (req, res) => {
  try {
    let { category } = req.params;
    category = category.trim().toLowerCase();

    const books = await Book.find({
      category: { $regex: `^${category}$`, $options: "i" },
    });

    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting books by category", error: error.message });
  }
});

// ---------------------------
// POST new book (supports picture + pdfFile)
// ---------------------------
router.post(
  "/",
  upload.fields([
    { name: "picture", maxCount: 1 },
    { name: "pdfFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      let { book_id, title, author, quantity, quality, category } = req.body;

      // Extract uploaded file URLs (Cloudinary provides `path`)
      const pictureUrl = req.files?.picture?.[0]?.path ?? req.body.picture ?? null;
      const pdfUrl = req.files?.pdfFile?.[0]?.path ?? req.body.pdfFile ?? null;

      // Normalize category
      const normalizedCategory = Array.isArray(category)
        ? category
        : category
        ? [category]
        : [];

      const newBook = new Book({
        book_id,
        title,
        author,
        quantity,
        quality,
        availableCount: quantity,
        reservedCount: 0,
        borrowedCount: 0,
        category: normalizedCategory,
        picture: pictureUrl,
        pdfFile: pdfUrl,
        favoritesCount: 0,
        status: "Available",
      });

      await newBook.save();

      // Notify all connected clients
      const io = req.app.get("io");
      io?.emit("bookAdded", newBook);

      res.status(201).json({ message: "Book added successfully!", book: newBook });
    } catch (error) {
      res.status(500).json({ message: "Error adding book", error: error.message });
    }
  }
);

// ---------------------------
// DELETE a book
// ---------------------------
router.delete("/:id", async (req, res) => {
  try {
    const deletedBook = await Book.findByIdAndDelete(req.params.id);
    if (!deletedBook) {
      return res.status(404).json({ success: false, message: "Book not found" });
    }

    // Notify all clients
    const io = req.app.get("io");
    io?.emit("bookDeleted", req.params.id);

    res.status(200).json({ success: true, message: "Book deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error deleting book", error: error.message });
  }
});

// ---------------------------
// UPDATE a book (supports JSON + image/pdf upload)
// ---------------------------
router.put("/:id", async (req, res) => {
  // If multipart/form-data, use multer.fields to parse files then handleUpdate
  if (req.headers["content-type"]?.startsWith("multipart/form-data")) {
    upload.fields([
      { name: "picture", maxCount: 1 },
      { name: "pdfFile", maxCount: 1 },
    ])(req, res, (err) => {
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

    const {
      book_id,
      title,
      author,
      quantity,
      quality,
      category,
      picture,
      pdfFile,
    } = req.body;

    // Prefer uploaded files -> then form body -> then existing values
    const pictureUrl = req.files?.picture?.[0]?.path ?? picture ?? existingBook.picture;
    const pdfUrl = req.files?.pdfFile?.[0]?.path ?? pdfFile ?? existingBook.pdfFile;

    const normalizedCategory = category
      ? Array.isArray(category)
        ? category
        : [category]
      : existingBook.category;

    const update = {
      book_id: book_id ?? existingBook.book_id,
      title: title ?? existingBook.title,
      author: author ?? existingBook.author,
      quantity: quantity ?? existingBook.quantity,
      quality: quality ?? existingBook.quality,
      category: normalizedCategory,
      picture: pictureUrl,
      pdfFile: pdfUrl,
    };

    // adjust available count if quantity changes (ensure numeric)
    const newQuantity = typeof update.quantity === "string" ? Number(update.quantity) : update.quantity;
    const oldQuantity = existingBook.quantity ?? 0;
    if (typeof newQuantity === "number" && newQuantity !== oldQuantity) {
      const diff = newQuantity - oldQuantity;
      update.availableCount = (existingBook.availableCount || 0) + diff;
    }

    // recompute status based on counts
    const bookCounts = {
      availableCount: update.availableCount ?? existingBook.availableCount,
      reservedCount: existingBook.reservedCount,
      borrowedCount: existingBook.borrowedCount,
      lostCount: existingBook.lostCount,
    };

    update.status =
      bookCounts.lostCount > 0
        ? "Lost"
        : bookCounts.borrowedCount > 0
        ? "Borrowed"
        : bookCounts.reservedCount > 0
        ? "Reserved"
        : bookCounts.availableCount > 0
        ? "Available"
        : "Reserved";

    const updatedBook = await Book.findByIdAndUpdate(id, update, { new: true });

    // Notify clients of update
    const io = req.app.get("io");
    io?.emit("bookUpdated", updatedBook);

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
