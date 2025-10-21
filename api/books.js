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

// Update a book
router.put("/:id", async (req, res) => {
  try {
    const { book_id, title, author, quantity, quality, picture } = req.body;

    // Find the book by ID and update it
    const updatedBook = await Book.findByIdAndUpdate(
      req.params.id,
      { book_id, title, author, quantity, quality, picture },
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
