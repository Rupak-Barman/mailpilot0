import { randomUUID } from "node:crypto";
import { getLanceDB, getLanceTable } from "../config/lancedb.js";

const TABLE_NAME = "knowledge_chunks";
const VECTOR_DIMENSIONS = 768;
const EMBEDDING_MODEL = "embeddinggemma-2:270m";

/**
 * Escape single quotes in string values used in LanceDB filters.
 */
function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Insert PDF chunks and their embeddings into LanceDB.
 */
export async function addKnowledgeChunks({
  userId,
  documentId,
  fileName,
  chunks,
}) {
  if (!userId || !documentId || !fileName || !chunks?.length) {
    throw new Error("Missing document information");
  }

  const records = chunks.map((chunk, index) => {
    if (
      typeof chunk.text !== "string" ||
      !chunk.text.trim() ||
      !Array.isArray(chunk.embedding)
    ) {
      throw new Error(`Invalid chunk at index ${index}`);
    }

    if (chunk.embedding.length !== VECTOR_DIMENSIONS) {
      throw new Error(
        `Invalid vector dimensions at index ${index}: expected ${VECTOR_DIMENSIONS}, received ${chunk.embedding.length}`
      );
    }

    if (!chunk.embedding.every(Number.isFinite)) {
      throw new Error(`Invalid vector values at index ${index}`);
    }

    return {
      id: randomUUID(),
      userId: String(userId),
      documentId: String(documentId),
      fileName: String(fileName),
      chunkIndex: index,
      text: chunk.text,
      vector: chunk.embedding,
      embeddingModel: EMBEDDING_MODEL,
      createdAt: new Date().toISOString(),
    };
  });

  const db = await getLanceDB();
  const table = await getLanceTable(TABLE_NAME);

  if (!table) {
    await db.createTable(TABLE_NAME, records);
  } else {
    await table.add(records);
  }

  return records.length;
}

/**
 * Search the current user's knowledge documents.
 *
 * Pass documentId to restrict retrieval to one specific PDF.
 * If documentId is omitted, search across all of that user's PDFs.
 */
export async function searchKnowledge({
  userId,
  documentId,
  documentIds,
  queryVector,
  limit = 3,
}) {
  if (!userId || !Array.isArray(queryVector)) {
    return [];
  }

  if (queryVector.length !== VECTOR_DIMENSIONS) {
    throw new Error(
      `Invalid query vector dimensions: expected ${VECTOR_DIMENSIONS}, received ${queryVector.length}`
    );
  }

  if (!queryVector.every(Number.isFinite)) {
    throw new Error("Query vector contains invalid numeric values");
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Search limit must be a positive integer");
  }

  const table = await getLanceTable(TABLE_NAME);

  if (!table) {
    return [];
  }

  const conditions = [
    `userId = '${escapeSql(userId)}'`,
  ];

  if (Array.isArray(documentIds)) {
    const ids = [...new Set(documentIds.map(String).filter(Boolean))];
    if (ids.length === 0) return [];
    conditions.push(`documentId IN (${ids.map(id => `'${escapeSql(id)}'`).join(", ")})`);
  } else if (documentId) {
    conditions.push(`documentId = '${escapeSql(documentId)}'`);
  }

  const filter = conditions.join(" AND ");

  return table
    .vectorSearch(queryVector)
    .where(filter)
    .select([
      "text",
      "fileName",
      "documentId",
      "chunkIndex",
    ])
    .limit(limit)
    .toArray();
}

/**
 * Delete all chunks belonging to a particular document.
 */
export async function deleteKnowledgeDocument({
  userId,
  documentId,
}) {
  if (!userId || !documentId) {
    throw new Error("userId and documentId are required");
  }

  const table = await getLanceTable(TABLE_NAME);

  if (!table) {
    return;
  }

  const filter =
    `userId = '${escapeSql(userId)}' AND ` +
    `documentId = '${escapeSql(documentId)}'`;

  await table.delete(filter);
}