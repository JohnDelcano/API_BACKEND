// Use ES module imports
import mongoose from "mongoose";

const { Schema } = mongoose;

const reservationSchema = new Schema(
  {
    bookId: {
      type: Schema.Types.ObjectId,
      ref: "Book",
      required: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    status: {
      type: String,
      enum: ["reserved", "borrowed", "expired", "cancelled", "approved", "declined"],
      default: "reserved",
    },
    reservedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    dueDate: { type: Date },
    pickedUpAt: {
      type: Date,
    },
    attemptedPickups: {
      type: Number,
      default: 0,
    },
    reminderSent: {
  type: Boolean,
  default: false,
},

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
reservationSchema.index({ studentId: 1, status: 1 }); // fast lookup for active reservations
reservationSchema.index({ expiresAt: 1 }); // for expiry job

export default mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema)
