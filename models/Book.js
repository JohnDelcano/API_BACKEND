import mongoose from "mongoose";

const bookSchema = new mongoose.Schema({
  book_id: { type: String },
  title: { type: String, required: true },
  author: { type: String },
  quantity: { type: Number },
  quality: { type: String },
  picture: { type: String }
});

export default mongoose.model("Book", bookSchema, "books");
