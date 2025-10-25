import jwt from "jsonwebtoken";
import Student from "./models/Student.js";

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer "))
      return res.status(401).json({ success: false, error: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    const student = await Student.findById(decoded.id);
    if (!student) return res.status(401).json({ success: false, error: "User not found" });

    req.user = student;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}
