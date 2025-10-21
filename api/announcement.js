import express from "express";
import Announcement from "../models/Announcement.js";

const router = express.Router();

// GET all announcements
router.get("/", async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }); // latest first
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: "Error getting announcements", error });
  }
});

// POST new announcement
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

export default router;
