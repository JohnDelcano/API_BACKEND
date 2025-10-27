// auth.js
import jwt from "jsonwebtoken";
import Admin from "./models/Admin.js";

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const student = await Student.findOne({ email });
  if (!student) return res.status(400).json({ success: false, error: "Invalid email" });

  const isMatch = await student.comparePassword(password);
  if (!isMatch) return res.status(400).json({ success: false, error: "Invalid password" });

  const token = jwt.sign({ id: student._id }, process.env.JWT_SECRET || "dev_secret", {
    expiresIn: "1d",
  });

  res.json({ success: true, token, student });
});


/* ------------------------------------------
   🧑‍💼 Admin Authentication Middleware
------------------------------------------ */
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