import express from "express";
import Book from "../models/Book.js";

const router = express.Router();

// GET all books
router.get("/", async (req, res) => {
  try {
    const books = await Book.find();
    res.json(books);
  } catch (error) {
    res.status(500).json({ message: "Error getting books", error });
  }
});

// POST new book
router.post("/", async (req, res) => {
  try {
    const { book_id, title, author, quantity, quality, picture } = req.body;
    const newBook = new Book({ book_id, title, author, quantity, quality, picture });
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

export default router;
