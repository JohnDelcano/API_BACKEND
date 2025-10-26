import Book from "../../models/Book.js";
import Reservation from "../../models/Reservation.js";

/**
 * Recalculates and fixes all book counts (available, reserved, borrowed, lost)
 * based on current reservations in the database.
 * @param {Object} io - optional socket.io instance to broadcast updates
 */
export async function syncBookCounts(io = null) {
  console.log("🔄 Syncing book counts...");

  const books = await Book.find();
  const updatedBooks = [];

  for (const book of books) {
    const total = book.totalCount || 1;

    // Count reservations by status
    const reservedCount = await Reservation.countDocuments({ bookId: book._id, status: "reserved" });
    const borrowedCount = await Reservation.countDocuments({ bookId: book._id, status: "approved" });
    const lostCount = await Reservation.countDocuments({ bookId: book._id, status: "lost" });

    // Recalculate available copies
    const availableCount = Math.max(total - (reservedCount + borrowedCount + lostCount), 0);

    // Determine new status
    const newStatus =
      borrowedCount > 0 ? "Borrowed" :
      reservedCount > 0 ? "Reserved" :
      lostCount > 0 ? "Lost" : "Available";

    // Apply updates
    const updatedBook = await Book.findByIdAndUpdate(
      book._id,
      {
        availableCount,
        reservedCount,
        borrowedCount,
        lostCount,
        status: newStatus,
      },
      { new: true }
    );

    updatedBooks.push(updatedBook);

    // 📡 Notify admins in real-time
    if (io) {
      io.to("admins").emit("bookSynced", updatedBook);
    }

    console.log(`✅ Synced: ${book.title}`);
  }

  console.log("✅ All book counts synchronized successfully.");
  return updatedBooks;
}
