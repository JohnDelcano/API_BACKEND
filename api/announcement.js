import express from "express";
import Announcement from "../models/Announcement.js";

const router = express.Router();

// Display Announcements
router.get("/", async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }); // latest first
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: "Error getting announcements", error });
  }
});

// Add New Announcement
router.post("/", async (req, res) => {
  try {
    const { title, content, author } = req.body;

    const newAnnouncement = new Announcement({
      title,
      content,
      createdAt: new Date(),
    });

    await newAnnouncement.save();
    res.status(201).json({ message: "Announcement added successfully!", announcement: newAnnouncement });
  } catch (error) {
    res.status(500).json({ message: "Error adding announcement", error });
  }
});

// Update Announcement
router.put("/:id", async (req, res) => {
  try {
    const { title, content } = req.body;
    const updated = await Announcement.findByIdAndUpdate(
      req.params.id,
      { title, content },
      { new: true }
    );
    res.json({ message: "Announcement updated", announcement: updated });
  } catch (error) {
    res.status(500).json({ message: "Error updating announcement", error });
  }
});

// Delete Announcement
router.delete("/:id", async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: "Announcement deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting announcement", error });
  }
});


export default router;
