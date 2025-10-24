const mongoose = require("mongoose");
const { Schema } = mongoose;

const reservationSchema = new Schema({
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
    enum: ["reserved", "borrowed", "expired", "cancelled"],
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
  pickedUpAt: {
    type: Date,
  },
  attemptedPickups: {
    type: Number,
    default: 0,
  },
  metadata: {
    type: Object,
    default: {},
  },
}, {
  timestamps: true,
});

// Indexes
reservationSchema.index({ studentId: 1, status: 1 }); // fast lookup for active reservations
reservationSchema.index({ expiresAt: 1 }); // for expiry job

export default mongoose.model("Reservation", reservationSchema);
