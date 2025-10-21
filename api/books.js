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

export default router;
