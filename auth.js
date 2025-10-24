// src/middleware/auth.js
import Student from "./models/Student.js"; // adjust path if needed

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ success: false, error: "No token provided" });

    const token = authHeader.replace("Bearer ", "").trim(); // remove spaces

    if (!token) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }

    // Find student with this token
    const student = await Student.findOne({ token });
    if (!student)
      return res.status(401).json({ success: false, error: "Invalid token" });

    req.user = student; // attach student to request
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ success: false, error: "Authentication failed" });
  }
}