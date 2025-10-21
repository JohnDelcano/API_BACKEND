import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import bookRoutes from "./api/books.js";
import AnnouncementsRoutes from "./api/announcement.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// Default route for testing
app.get("/", (req, res) => {
  res.send("LIBROSYNC API is running 🚀");
});


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Use the router for /api/books
app.use("/api/books", bookRoutes);
app.use("/api/announcements", AnnouncementsRoutes);

// 404 handler (must come after all routes)
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 50000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
