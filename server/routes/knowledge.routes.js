import express from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";

import auth from "../middleware/auth.js";

import KnowledgeDocument from "../models/KnowledgeDocument.js";
import Knowledge from "../models/Knowledge.js";
import User from "../models/User.js";

import { processDocumentText } from "../services/embedding.service.js";

import {
  addKnowledgeChunks,
  deleteKnowledgeDocument
} from "../services/vectorStore.service.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

const cleanDisplayName = (value) =>
  String(value || "").trim().slice(0, 100);

/**
 * Upload and index a PDF knowledge base.
 *
 * Form data:
 * - document: PDF file
 * - displayName: user-defined knowledge-base name
 */
router.post(
  "/upload",
  auth,
  upload.single("document"),
  async (req, res) => {
    let parser;
    let documentId;

    try {
      if (!req.file) {
        return res.status(400).json({
          message: "No file uploaded."
        });
      }

      const fileExtension = path.extname(req.file.originalname || "").toLowerCase();
      if (req.file.mimetype !== "application/pdf" || fileExtension !== ".pdf") {
        return res.status(400).json({
          message: "Only PDF files are allowed."
        });
      }

      // Sanitize original filename: strip path traversal and non-safe characters
      const baseName = path.basename(req.file.originalname || "document.pdf");
      const safeFileName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
      req.file.originalname = safeFileName;

      const displayName = cleanDisplayName(req.body.displayName);

      if (!displayName) {
        return res.status(400).json({
          message: "Knowledge base name is required."
        });
      }

      if (displayName.length > 100) {
        return res.status(400).json({
          message: "Knowledge base name cannot exceed 100 characters."
        });
      }

      const userId = String(req.user.id);

      // Prevent duplicate custom names for the same user.
      const existingDocuments = await KnowledgeDocument.find({
        userId
      })
        .select("displayName fileName")
        .lean();

      const duplicate = existingDocuments.some((doc) => {
        const existingName = doc.displayName || doc.fileName;

        return (
          String(existingName).trim().toLowerCase() ===
          displayName.toLowerCase()
        );
      });

      if (duplicate) {
        return res.status(409).json({
          message: "A knowledge base with this name already exists."
        });
      }

      parser = new PDFParse({
        data: req.file.buffer
      });

      const pdfData = await parser.getText();
      const rawText = pdfData.text;

      if (!rawText?.trim()) {
        return res.status(400).json({
          message: "Could not extract any text from the PDF."
        });
      }

      documentId = randomUUID();

      // Keep using the original filename for the existing
      // document-processing pipeline.
      const chunks = await processDocumentText(
        rawText,
        req.file.originalname
      );

      if (!chunks.length) {
        return res.status(400).json({
          message: "No text chunks could be created."
        });
      }

      // Add chunks to LanceDB using the stable documentId.
      const chunksAdded = await addKnowledgeChunks({
        userId,
        documentId,
        fileName: req.file.originalname,
        chunks
      });

      try {
        // Save metadata in MongoDB.
        await KnowledgeDocument.create({
          userId,
          documentId,
          fileName: req.file.originalname,
          displayName,
          chunks: chunksAdded
        });
      } catch (metadataError) {
        // Roll back vector data if metadata creation fails.
        await deleteKnowledgeDocument({
          userId,
          documentId
        }).catch((rollbackError) => {
          console.error(
            "Knowledge upload rollback failed:",
            rollbackError.message
          );
        });

        throw metadataError;
      }

      return res.status(201).json({
        message: "Knowledge base successfully processed and embedded.",
        documentId,
        fileName: req.file.originalname,
        displayName,
        chunksAdded
      });
    } catch (error) {
      console.error("Knowledge upload error:", error);

      return res.status(500).json({
        message:
          error.message ||
          "An error occurred while processing the document."
      });
    } finally {
      if (parser) {
        await parser.destroy().catch(() => {});
      }
    }
  }
);

/**
 * Get the current user's knowledge bases.
 *
 * Includes a compatibility migration for older MongoDB
 * Knowledge chunks created before the LanceDB implementation.
 */
router.get("/", auth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const legacy = await Knowledge.find({
      userId: req.user.id
    }).lean();

    // Group old chunks by original filename.
    const grouped = new Map();

    for (const chunk of legacy) {
      if (!grouped.has(chunk.fileName)) {
        grouped.set(chunk.fileName, []);
      }

      grouped.get(chunk.fileName).push(chunk);
    }

    // Move older embeddings into LanceDB when needed.
    for (const [fileName, chunks] of grouped) {
      const existingMetadata = await KnowledgeDocument.findOne({
        userId,
        fileName
      });

      if (existingMetadata) {
        continue;
      }

      const documentId = randomUUID();

      try {
        const migratedChunks = chunks
          .filter(
            (chunk) =>
              Array.isArray(chunk.embedding) &&
              chunk.embedding.length === 768 &&
              chunk.text?.trim()
          )
          .map((chunk) => ({
            text: chunk.text,
            embedding: chunk.embedding
          }));

        if (!migratedChunks.length) {
          continue;
        }

        const count = await addKnowledgeChunks({
          userId,
          documentId,
          fileName,
          chunks: migratedChunks
        });

        await KnowledgeDocument.create({
          userId,
          documentId,
          fileName,

          // For an old document, initially use its original
          // filename as the display name.
          displayName: fileName,

          chunks: count
        });
      } catch (migrationError) {
        console.error(
          `Could not migrate legacy knowledge document ${fileName}:`,
          migrationError.message
        );
      }
    }

    const documents = await KnowledgeDocument.find({
      userId
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(
      documents.map((doc) => ({
        documentId: doc.documentId,
        fileName: doc.fileName,

        // Backward compatibility for older records.
        displayName: doc.displayName || doc.fileName,

        chunks: doc.chunks,
        createdAt: doc.createdAt
      }))
    );
  } catch (error) {
    console.error("Knowledge listing error:", error);

    return res.status(500).json({
      message: "Error fetching knowledge documents."
    });
  }
});

/**
 * Delete a knowledge base and all its indexed chunks.
 *
 * Also remove its documentId from every routing rule.
 */
router.delete("/:documentId", auth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const doc = await KnowledgeDocument.findOne({
      userId,
      documentId: req.params.documentId
    });

    if (!doc) {
      return res.status(404).json({
        message: "Knowledge document not found."
      });
    }

    // First delete vector chunks.
    await deleteKnowledgeDocument({
      userId,
      documentId: doc.documentId
    });

    // Then delete metadata.
    await KnowledgeDocument.deleteOne({
      _id: doc._id
    });

    // Remove legacy MongoDB chunks associated with the
    // original filename.
    await Knowledge.deleteMany({
      userId: req.user.id,
      fileName: doc.fileName
    });

    // Remove this document ID from all routing rules.
    await User.updateOne(
      { _id: req.user.id },
      {
        $pull: {
          "labels.$[].knowledgeDocumentIds": doc.documentId
        }
      }
    );

    return res.json({
      message: "Knowledge base removed successfully."
    });
  } catch (error) {
    console.error("Knowledge delete error:", error);

    return res.status(500).json({
      message:
        error.message || "Error deleting knowledge document."
    });
  }
});

export default router;
