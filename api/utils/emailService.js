import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Create reusable transporter using Gmail or another SMTP service
export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // your Gmail
    pass: process.env.EMAIL_PASS, // app password (not your normal password)
  },
});

// Send reservation reminder
export async function sendExpirationReminder(student, reservation, book) {
  if (!student.email) return;

  const timeLeft = Math.round((reservation.expiresAt - Date.now()) / (60 * 1000));

  const mailOptions = {
    from: `"LIBROSYNC Notifications" <${process.env.EMAIL_USER}>`,
    to: student.email,
    subject: `Reminder: Your reservation for "${book.title}" will expire soon`,
    html: `
      <h3>Hello ${student.firstName},</h3>
      <p>This is a friendly reminder that your reserved book <b>${book.title}</b> will expire in about <b>${timeLeft} minutes</b>.</p>
      <p>Please visit the library to pick it up before it expires.</p>
      <br>
      <p>— LIBROSYNC Team</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Reminder sent to ${student.email} for book "${book.title}"`);
  } catch (err) {
    console.error(`❌ Failed to send reminder to ${student.email}:`, err.message);
  }
}
