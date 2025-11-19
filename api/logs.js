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

// ✅ TIME IN
router.post("/timein", async (req, res) => {
  try {
    const { studentId } = req.body;

    if (!studentId)
      return res.status(400).json({ success: false, message: "Student ID required" });

    // Find student
    const student = await Student.findOne({ studentId });
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    // 🛑 Check if student already timed in (no timeout yet)
    const existingLog = await Log.findOne({ student: student._id, timeOut: null });
    if (existingLog) {
      return res.status(400).json({
        success: false,
        message: `${student.firstName} ${student.lastName} is already timed in.`,
      });
    }

    // ✅ Create new log entry for time-in
    const log = new Log({ student: student._id });
    await log.save();

    const populatedLog = await log.populate("student", "studentId firstName lastName");

    // 🔔 Emit update to connected clients (real-time)
    const io = req.app.get("io");
    io.emit("logUpdated", { type: "timein", log: populatedLog });

    res.json({ success: true, log: populatedLog });
  } catch (err) {
    console.error("Time-in error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ TIME OUT
router.post("/timeout", async (req, res) => {
  try {
    const { logId, studentId } = req.body;
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

    // 🟢 CASE 2: Student enters studentId
    if (!studentId)
      return res.status(400).json({ success: false, message: "Student ID required" });

    const student = await Student.findOne({ studentId });
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

export default router;
