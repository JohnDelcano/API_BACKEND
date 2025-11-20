import express from "express";
import ExcelJS from "exceljs";
import Log from "../models/Log.js";
import Student from "../models/Student.js";
import Reservation from "../models/Reservation.js";
import { authenticateAdmin } from "../auth.js";

const router = express.Router();

router.get("/report/download", authenticateAdmin, async (req, res) => {
  try {
    // 1️⃣ Fetch all data
    const logs = await Log.find().populate("student", "studentId firstName lastName email").sort({ timeIn: -1 });
    const reservations = await Reservation.find()
      .populate("studentId", "studentId firstName lastName email")
      .populate("bookId", "title author category")
      .sort({ reservedAt: -1 });
    const students = await Student.find().select("-password").sort({ createdAt: -1 });

    // 2️⃣ Create a workbook
    const workbook = new ExcelJS.Workbook();

    // ------------------
    // Logs Sheet
    // ------------------
    const logSheet = workbook.addWorksheet("Logs");
    logSheet.columns = [
      { header: "Student ID", key: "studentId", width: 15 },
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 25 },
      { header: "Time In", key: "timeIn", width: 20 },
      { header: "Time Out", key: "timeOut", width: 20 },
      { header: "Status", key: "status", width: 15 },
    ];
    logs.forEach(log => {
      logSheet.addRow({
        studentId: log.student?.studentId || "",
        name: `${log.student?.firstName || ""} ${log.student?.lastName || ""}`,
        email: log.student?.email || "",
        timeIn: log.timeIn ? log.timeIn.toLocaleString() : "",
        timeOut: log.timeOut ? log.timeOut.toLocaleString() : "",
        status: log.status || "",
      });
    });

    // ------------------
    // Reservations Sheet
    // ------------------
    const resSheet = workbook.addWorksheet("Reservations");
    resSheet.columns = [
      { header: "Student ID", key: "studentId", width: 15 },
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 25 },
      { header: "Book Title", key: "bookTitle", width: 30 },
      { header: "Book Author", key: "bookAuthor", width: 25 },
      { header: "Category", key: "category", width: 20 },
      { header: "Status", key: "status", width: 15 },
      { header: "Reserved At", key: "reservedAt", width: 20 },
      { header: "Due Date", key: "dueDate", width: 20 },
    ];
    reservations.forEach(r => {
      resSheet.addRow({
        studentId: r.studentId?.studentId || "",
        name: `${r.studentId?.firstName || ""} ${r.studentId?.lastName || ""}`,
        email: r.studentId?.email || "",
        bookTitle: r.bookId?.title || "",
        bookAuthor: r.bookId?.author || "",
        category: r.bookId?.category || "",
        status: r.status || "",
        reservedAt: r.reservedAt ? r.reservedAt.toLocaleString() : "",
        dueDate: r.dueDate ? r.dueDate.toLocaleString() : "",
      });
    });

    // ------------------
    // Students Sheet
    // ------------------
    const studentSheet = workbook.addWorksheet("Students");
    studentSheet.columns = [
      { header: "Student ID", key: "studentId", width: 15 },
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 25 },
      { header: "Status", key: "status", width: 15 },
      { header: "Created At", key: "createdAt", width: 20 },
    ];
    students.forEach(s => {
      studentSheet.addRow({
        studentId: s.studentId || "",
        name: `${s.firstName || ""} ${s.lastName || ""}`,
        email: s.email || "",
        status: s.status || "",
        createdAt: s.createdAt ? s.createdAt.toLocaleString() : "",
      });
    });

    // 3️⃣ Set headers and send
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=report-${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("❌ Generate report error:", err);
    res.status(500).json({ success: false, message: "Failed to generate report", error: err.message });
  }
});

export default router;
