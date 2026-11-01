import express from "express";

import auth from "../middleware/auth.js";
import User from "../models/User.js";

const router = express.Router();

const clean = (value, max) =>
  String(value || "").trim().slice(0, max);

// Get all writing personas belonging to the logged-in user.
router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("personas");

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    return res.json(user.personas || []);
  } catch (error) {
    console.error("Get personas error:", error);

    return res.status(500).json({
      message: "Could not fetch writing personas."
    });
  }
});

// Create a persona.
router.post("/", auth, async (req, res) => {
  try {
    const name = clean(req.body.name, 80);

    if (!name) {
      return res.status(400).json({
        message: "Persona name is required."
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const duplicate = user.personas.some(
      (persona) =>
        persona.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      return res.status(409).json({
        message: "A persona with this name already exists."
      });
    }

    user.personas.push({
      name,
      instructions: clean(req.body.instructions, 4000),
      signature: clean(req.body.signature, 1000)
    });

    await user.save();

    const createdPersona =
      user.personas[user.personas.length - 1];

    return res.status(201).json(createdPersona);
  } catch (error) {
    console.error("Create persona error:", error);

    return res.status(500).json({
      message: "Could not create writing persona."
    });
  }
});

// Update a persona.
router.patch("/:personaId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const persona = user.personas.id(req.params.personaId);

    if (!persona) {
      return res.status(404).json({
        message: "Persona not found."
      });
    }

    if (req.body.name !== undefined) {
      const name = clean(req.body.name, 80);

      if (!name) {
        return res.status(400).json({
          message: "Persona name is required."
        });
      }

      const duplicate = user.personas.some(
        (item) =>
          String(item._id) !== String(persona._id) &&
          item.name.toLowerCase() === name.toLowerCase()
      );

      if (duplicate) {
        return res.status(409).json({
          message: "A persona with this name already exists."
        });
      }

      persona.name = name;
    }

    if (req.body.instructions !== undefined) {
      persona.instructions = clean(
        req.body.instructions,
        4000
      );
    }

    if (req.body.signature !== undefined) {
      persona.signature = clean(
        req.body.signature,
        1000
      );
    }

    await user.save();

    return res.json(persona);
  } catch (error) {
    console.error("Update persona error:", error);

    return res.status(500).json({
      message: "Could not update writing persona."
    });
  }
});

// Delete a persona.
// Any routing rule assigned to it falls back to Default persona.
router.delete("/:personaId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const persona = user.personas.id(req.params.personaId);

    if (!persona) {
      return res.status(404).json({
        message: "Persona not found."
      });
    }

    const personaId = String(persona._id);

    user.personas.pull({
      _id: persona._id
    });

    user.labels.forEach((label) => {
      if (String(label.personaId || "") === personaId) {
        label.personaId = "";
      }
    });

    await user.save();

    return res.json({
      message: "Persona deleted successfully."
    });
  } catch (error) {
    console.error("Delete persona error:", error);

    return res.status(500).json({
      message: "Could not delete writing persona."
    });
  }
});

export default router;