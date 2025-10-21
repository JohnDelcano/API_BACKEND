import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import bookRoutes from "./api/books.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Use the router for /api/books
app.use("/api/books", bookRoutes); 

const PORT = process.env.PORT || 50000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
