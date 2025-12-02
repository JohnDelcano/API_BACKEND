import express from "express";
import Log from "../models/Log.js";
import Student from "../models/Student.js";
import dayjs from "dayjs";

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

    const student = await Student.findOne({ studentId });
    if (!student)
      return res.status(404).json({ success: false, message: "Student not found" });

    // Check if already timed in (no timeout yet)
    const existingLog = await Log.findOne({ student: student._id, timeOut: null });
    if (existingLog) {
      return res.status(400).json({
        success: false,
        message: `${student.firstName} ${student.lastName} is already timed in.`,
      });
    }

    // Check if student has already printed today in any log
    const todayPrintedLog = await Log.findOne({
      student: student._id,
      lastPrintedAt: {
        $gte: dayjs().startOf("day").toDate(),
        $lte: dayjs().endOf("day").toDate(),
      },
    });

    // Create new time-in log
    const log = new Log({ student: student._id });
    await log.save();

    const populatedLog = await log.populate("student", "studentId firstName lastName");

    // Add alreadyPrinted flag
    const responseLog = {
      ...populatedLog.toObject(),
      alreadyPrinted: !!todayPrintedLog, // ✅ if printed today, input will be disabled
    };

    const io = req.app.get("io");
    io.emit("logUpdated", { type: "timein", log: responseLog });

    res.json({ success: true, log: responseLog });
  } catch (err) {
    console.error("Time-in error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ TIME OUT (with print count)
router.post("/timeout", async (req, res) => {
  try {
    const { logId, studentId, printCount } = req.body;
    const io = req.app.get("io");

    let log;

    if (logId) {
      log = await Log.findById(logId);
      if (!log) return res.status(404).json({ success: false, message: "Log not found" });
    } else if (studentId) {
      const student = await Student.findOne({ studentId });
      if (!student)
        return res.status(404).json({ success: false, message: "Student not found" });

      log = await Log.findOne({ student: student._id, timeOut: null }).sort({ timeIn: -1 });
      if (!log)
        return res.status(404).json({ success: false, message: "No active time-in found" });
    } else {
      return res.status(400).json({ success: false, message: "logId or studentId required" });
    }

    // Prevent saving new prints if already printed today
    const alreadyPrintedToday = await Log.findOne({
      student: log.student,
      lastPrintedAt: {
        $gte: dayjs().startOf("day").toDate(),
        $lte: dayjs().endOf("day").toDate(),
      },
    });

    if (alreadyPrintedToday) {
      log.timeOut = new Date();
      log.status = "Checked Out";
      await log.save();
      const populatedLog = await log.populate("student", "studentId firstName lastName");
      io.emit("logUpdated", { type: "timeout", log: populatedLog });

      return res.json({
        success: true,
        log: { ...populatedLog.toObject(), alreadyPrinted: true },
        message: "Already printed today. Print count not saved.",
      });
    }

    // Save print info if provided
    if (printCount !== undefined && printCount > 0) {
      log.printCount = printCount;
      log.prints.push({ quantity: printCount, date: new Date() });
      log.lastPrintedAt = new Date();
    }

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

router.get("/monthly", async (req, res) => {
  try {
    const logs = await Log.find({ lastPrintedAt: { $ne: null } }).populate("student", "studentId firstName lastName");

    // Plain JS object
    const monthlyStats = {};

    logs.forEach(log => {
      const month = dayjs(log.lastPrintedAt).format("MMM");
      if (!monthlyStats[month]) monthlyStats[month] = { printed: 0 };
      monthlyStats[month].printed += 1; // each log counts as 1 student printed
    });

    const result = Object.entries(monthlyStats).map(([month, data]) => ({ month, ...data }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


export default router;
