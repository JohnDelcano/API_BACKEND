import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

import bookRoutes from "./api/books.js";
import announcementRoutes from "./api/announcement.js";
import adminRoutes from "./api/admin.js";
import studentRoutes from "./api/students.js";
import reservationRoutes from "./api/reservation.js"; 
import logRoutes from "./api/logs.js"
import { expireOldReservations } from "./api/utils/reservationExpiryJob.js";


dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Make io accessible in routes
app.set("io", io);

app.use(cors());
app.use(express.json());

// Default route for testing
app.get("/", (req, res) => {
  res.send("LIBROSYNC API is running 🚀");
});

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Use Routers
app.use("/api/books", bookRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/reservation", reservationRoutes);
app.use("/api/logs", logRoutes);

// Auto-expire reservations and send SMS reminders every 1 minute
setInterval(() => expireOldReservations(io), 60 * 1000);


// 404 handler (must come after all routes)
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
