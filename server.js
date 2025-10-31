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
import logRoutes from "./api/logs.js";
import { expireOldReservations } from "./api/utils/reservationExpiryJob.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // For production: replace with your frontend domain
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

// 🔗 Attach io instance to all routes
app.set("io", io);

// ------------------ SOCKET.IO ------------------
io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  // 🧑 Join personal room when user connects (called from frontend)
  socket.on("joinUser", (userId) => {
    if (!userId) return;
    socket.join(userId);
    console.log(`👤 User ${userId} joined personal room`);
  });

  // 🧑‍💼 Join admin room
  socket.on("joinAdmin", () => {
    socket.join("admins");
    console.log("🛠️ Admin joined admin room");
  });

  // 🧹 Optional: allow user to leave room (e.g. logout)
  socket.on("leaveUser", (userId) => {
    if (userId) {
      socket.leave(userId);
      console.log(`🚪 User ${userId} left their room`);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// Expose io for modules
export { io };

// ------------------ MIDDLEWARE ------------------
app.use(cors());
app.use(express.json());

// Default route
app.get("/", (req, res) => {
  res.send("📚 LIBROSYNC API is running 🚀");
});

// ------------------ DATABASE ------------------
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ------------------ ROUTES ------------------
app.use("/api/books", bookRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/reservation", reservationRoutes);
app.use("/api/logs", logRoutes);

// ------------------ AUTO-EXPIRATION JOB ------------------
setInterval(() => expireOldReservations(io), 60 * 1000);

// ------------------ 404 HANDLER ------------------
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ------------------ START SERVER ------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
