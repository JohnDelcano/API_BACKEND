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
    const student = await Student.findOne({ studentId });
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    const log = new Log({ student: student._id });
    await log.save();

    const populatedLog = await log.populate("student", "studentId firstName lastName");

    // 🔔 Emit to all connected clients
    const io = req.app.get("io");
    io.emit("logUpdated", { type: "timein", log: populatedLog });

    res.json({ success: true, log: populatedLog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ TIME OUT
router.post("/timeout/:logId", async (req, res) => {
  try {
    const { logId } = req.params;
    const log = await Log.findById(logId).populate("student", "studentId firstName lastName");
    if (!log)
      return res.status(404).json({ success: false, message: "Log not found" });

    log.timeOut = new Date();
    log.status = "Checked Out";
    await log.save();

    // 🔔 Emit to all connected clients
    const io = req.app.get("io");
    io.emit("logUpdated", { type: "timeout", log });

    res.json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
