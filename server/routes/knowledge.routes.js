import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import auth from "../middleware/auth.js";
import KnowledgeDocument from "../models/KnowledgeDocument.js";
import Knowledge from "../models/Knowledge.js";
import { processDocumentText } from "../services/embedding.service.js";
import { addKnowledgeChunks, deleteKnowledgeDocument } from "../services/vectorStore.service.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post("/upload", auth, upload.single("document"), async (req, res) => {
  let parser;
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.mimetype !== "application/pdf") return res.status(400).json({ message: "Only PDF files are allowed" });
    parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const rawText = pdfData.text;
    if (!rawText?.trim()) return res.status(400).json({ message: "Could not extract any text from the PDF" });
    const documentId = randomUUID();
    const chunks = await processDocumentText(rawText, req.file.originalname);
    if (!chunks.length) return res.status(400).json({ message: "No text chunks could be created" });
    const chunksAdded = await addKnowledgeChunks({ userId: String(req.user.id), documentId, fileName: req.file.originalname, chunks });
    await KnowledgeDocument.create({ userId: String(req.user.id), documentId, fileName: req.file.originalname, chunks: chunksAdded });
    return res.status(201).json({ message: "Document successfully processed and embedded.", documentId, fileName: req.file.originalname, chunksAdded });
  } catch (error) {
    console.error("Knowledge upload error:", error);
    return res.status(500).json({ message: error.message || "An error occurred while processing the document." });
  } finally { if (parser) await parser.destroy().catch(() => {}); }
});

router.get("/", auth, async (req, res) => {
  try {
    // One-time compatibility migration: move existing MongoDB-embedded chunks into LanceDB
    // so documents uploaded before this architecture change remain selectable.
    const legacy = await Knowledge.find({ userId: req.user.id }).lean();
    const grouped = new Map();
    for (const chunk of legacy) {
      if (!grouped.has(chunk.fileName)) grouped.set(chunk.fileName, []);
      grouped.get(chunk.fileName).push(chunk);
    }
    for (const [fileName, chunks] of grouped) {
      let metadata = await KnowledgeDocument.findOne({ userId: String(req.user.id), fileName });
      if (metadata) continue;
      const documentId = randomUUID();
      try {
        const migratedChunks = chunks.filter(c => Array.isArray(c.embedding) && c.embedding.length === 768 && c.text?.trim()).map(c => ({ text: c.text, embedding: c.embedding }));
        if (!migratedChunks.length) continue;
        const count = await addKnowledgeChunks({ userId: String(req.user.id), documentId, fileName, chunks: migratedChunks });
        metadata = await KnowledgeDocument.create({ userId: String(req.user.id), documentId, fileName, chunks: count });
      } catch (migrationError) {
        console.error(`Could not migrate legacy knowledge document ${fileName}:`, migrationError.message);
      }
    }
    const docs = await KnowledgeDocument.find({ userId: String(req.user.id) }).sort({ createdAt: -1 }).lean();
    return res.json(docs.map(d => ({ documentId: d.documentId, fileName: d.fileName, chunks: d.chunks, createdAt: d.createdAt })));
  } catch (error) { return res.status(500).json({ message: "Error fetching knowledge documents." }); }
});

router.delete("/:documentId", auth, async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findOne({ userId: String(req.user.id), documentId: req.params.documentId });
    if (!doc) return res.status(404).json({ message: "Knowledge document not found" });
    await deleteKnowledgeDocument({ userId: String(req.user.id), documentId: doc.documentId });
    await KnowledgeDocument.deleteOne({ _id: doc._id });
    await Knowledge.deleteMany({ userId: req.user.id, fileName: doc.fileName });
    await (await import("../models/User.js")).default.updateMany(
      { _id: req.user.id },
      { $pull: { "labels.$[].knowledgeDocumentIds": doc.documentId } }
    );
    return res.json({ message: "Document removed successfully." });
  } catch (error) { console.error("Knowledge delete error:", error); return res.status(500).json({ message: error.message || "Error deleting document." }); }
});
export default router;
