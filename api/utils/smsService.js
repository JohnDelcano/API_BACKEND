import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendSMSReminder(student, reservation, book) {
  if (!student.phone) return; // skip if no phone number

  const timeLeft = Math.round((reservation.expiresAt - Date.now()) / (60 * 1000));

  const message = `
  Hello ${student.firstName}, your reserved book "${book.title}" will expire in about ${timeLeft} minutes.
  Please pick it up before it expires. — LIBROSYNC
  `;

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE,
      to: student.phone,
    });
    console.log(`📱 SMS reminder sent to ${student.phone} for book "${book.title}"`);
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${student.phone}:`, error.message);
  }
}
