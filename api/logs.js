import express from "express";
import Log from "../models/Log.js";
import Student from "../models/Student.js";

const router = express.Router();

// ✅ GET all logs
router.get("/", async (req, res) => {
  try {
    const logs = await Log.find()
      .populate("student", "studentId firstName lastName")
      .sort({ timeIn: -1 });

    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ✅ TIME OUT
router.post("/timeout", async (req, res) => {
  try {
    const { logId, studentId, qrData } = req.body;

    const io = req.app.get("io");

    // 🟢 CASE 1: Admin provides logId directly
    if (logId) {
      const log = await Log.findById(logId);
      if (!log) return res.status(404).json({ success: false, message: "Log not found" });

      log.timeOut = new Date();
      log.status = "Checked Out";
      await log.save();

      const populatedLog = await log.populate("student", "studentId firstName lastName");

      io.emit("logUpdated", { type: "timeout", log: populatedLog });
      return res.json({ success: true, log: populatedLog });
    }

    // 🟢 CASE 2: Student scans QR or enters studentId
    const idToSearch = qrData || studentId;
    if (!idToSearch)
      return res.status(400).json({ success: false, message: "Student ID or QR code required" });

    const student = await Student.findOne({ studentId: idToSearch });
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    // Find active log
    const log = await Log.findOne({ student: student._id, timeOut: null }).sort({ timeIn: -1 });
    if (!log)
      return res.status(404).json({ success: false, message: "No active time-in found" });

    log.timeOut = new Date();
    log.status = "Checked Out";
    await log.save();

    const populatedLog = await log.populate("student", "studentId firstName lastName");

    io.emit("logUpdated", { type: "timeout", log: populatedLog });
    res.json({ success: true, log: populatedLog });
  } catch (err) {
    console.error("Timeout error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});




// ✅ TIME OUT
router.post("/timeout", async (req, res) => {
  try {
    const { logId, studentId, qrData } = req.body;

    // If logId provided (admin selecting a record)
    if (logId) {
      const log = await Log.findById(logId).populate("student", "studentId firstName lastName");
      if (!log) return res.status(404).json({ success: false, message: "Log not found" });

      log.timeOut = new Date();
      log.status = "Checked Out";
      await log.save();

      const io = req.app.get("io");
      io.emit("logUpdated", { type: "timeout", log });
      return res.json({ success: true, log });
    }

    // If using studentId or QR
    const idToSearch = qrData || studentId;
    if (!idToSearch)
      return res.status(400).json({ success: false, message: "Student ID or QR code required" });

    const student = await Student.findOne({ studentId: idToSearch });
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    // Find the latest log of this student with no timeOut yet
    const log = await Log.findOne({ student: student._id, timeOut: null }).sort({ timeIn: -1 });
    if (!log)
      return res.status(404).json({ success: false, message: "No active time-in found" });

    log.timeOut = new Date();
    log.status = "Checked Out";
    await log.save();

    const io = req.app.get("io");
    io.emit("logUpdated", { type: "timeout", log });

    res.json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


export default router;
