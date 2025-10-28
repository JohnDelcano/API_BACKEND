import express from "express";
import Log from "../models/Log.js";
import Student from "../models/Student.js";

const router = express.Router();

// GET all logs
// GET all logs
router.get("/", async (req, res) => {
  try {
    console.log("Fetching logs...");  // Log to check if route is hit
    const logs = await Log.find()
      .populate("student", "studentId firstName lastName")
      .sort({ timeIn: -1 });

    res.json({ success: true, data: logs });
  } catch (err) {
    console.error("Error in /api/logs:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// TIME IN
router.post("/timein", async (req, res) => {
  try {
    const { studentId } = req.body;
    const student = await Student.findOne({ studentId });
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    const log = new Log({ student: student._id });
    await log.save();

    // ✅ Populate student info before sending response
    const populatedLog = await log.populate("student", "studentId firstName lastName");

    res.json({ success: true, log: populatedLog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// TIME OUT
router.post("/timeout/:logId", async (req, res) => {
  try {
    const { logId } = req.params;
    const log = await Log.findById(logId);
    if (!log) return res.status(404).json({ success: false, message: "Log not found" });

    log.timeOut = new Date();
    log.status = "Checked Out";
    await log.save();

    res.json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
