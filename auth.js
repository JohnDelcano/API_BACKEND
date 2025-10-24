// src/middleware/auth.js
import Student from "./models/Student.js"; // adjust path if needed

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ success: false, error: "No token provided" });

    const token = authHeader.replace("Bearer ", "");
    
    // Dummy token validation: in production, use JWT or similar
    const student = await Student.findOne({ token }); // assumes Student has a 'token' field
    if (!student)
      return res.status(401).json({ success: false, error: "Invalid token" });

    req.user = student; // attach student to request
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: "Authentication failed" });
  }
}
