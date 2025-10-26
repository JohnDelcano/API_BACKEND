import jwt from "jsonwebtoken";
import Student from "./models/Student.js";
import Admin from "./models/Admin.js";

// 🧑‍🎓 Authenticate Student
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ success: false, error: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    const student = await Student.findById(decoded.id);
    if (!student)
      return res.status(401).json({ success: false, error: "User not found" });

    req.user = student;
    next();
  } catch (err) {
    console.error("Student auth error:", err);
    res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

// 🧑‍💼 Authenticate Admin
export async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ success: false, error: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    const admin = await Admin.findById(decoded.id);
    if (!admin)
      return res.status(401).json({ success: false, error: "Admin not found" });

    req.admin = admin;
    next();
  } catch (err) {
    console.error("Admin auth error:", err);
    res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}
