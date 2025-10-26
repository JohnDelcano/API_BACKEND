import mongoose from "mongoose";

const bookSchema = new mongoose.Schema({
  book_id: { type: String },
  title: { type: String, required: true },
  author: { type: String },
  quantity: { type: Number, default: 0 },
  quality: { type: String },
  picture: { type: String },
  category: { type: String }, 
  genre: { type: String },         
  favoritesCount: { type: Number, default: 0 }, 
  availableCount: { type: Number, default: 1 },
  reservedCount: { type: Number, default: 0 },
  borrowedCount: { type: Number, default: 0 },
  status: {
  type: String,
  enum: ["Available", "Reserved", "Borrowed", "Lost"],
  default: "Available",
},
  createdAt: { type: Date, default: Date.now }  
}, {
  timestamps: true,
});


export default mongoose.model("Book", bookSchema, "books");
