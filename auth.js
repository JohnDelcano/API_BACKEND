// auth.js
import jwt from "jsonwebtoken";
import Student from "./models/Student.js";
import Admin from "./models/Admin.js";

// ✅ Use one shared secret
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// -------------------- Student Auth --------------------
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("🔐 Received header:", authHeader); // <--- add this

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("🚫 No token or invalid format");
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    console.log("✅ Decoded token:", decoded);
    req.user = decoded;
    next();
  } catch (error) {
    console.log("❌ JWT verification failed:", error.message);
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
};


// -------------------- Admin Auth --------------------
export async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(401).json({ success: false, error: "Admin not found" });
    }

    req.admin = admin;
    next();
  } catch (err) {
    console.error("Admin auth error:", err);
    res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}
