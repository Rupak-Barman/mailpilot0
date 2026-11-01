
import "dotenv/config";

const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
).replace(/\/+$/, "");

const EMBEDDING_MODEL =
  process.env.OLLAMA_EMBEDDING_MODEL || "embeddinggemma-2:270m";

const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 16;

/**
 * Splits text into overlapping chunks.
 * Uses approximate character-based chunking.
 */
function chunkText(text, chunkSize = 1000, overlap = 200) {
  if (!text) return [];

  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const word of words) {
    if (
      currentLength + word.length > chunkSize &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.join(" "));

      // Preserve overlapping words.
      let overlapLength = 0;
      const overlapWords = [];

      for (let i = currentChunk.length - 1; i >= 0; i--) {
        const w = currentChunk[i];

        if (overlapLength + w.length > overlap) break;

        overlapWords.unshift(w);
        overlapLength += w.length + 1;
      }

      currentChunk = [...overlapWords];
      currentLength = overlapLength;
    }

    currentChunk.push(word);
    currentLength += word.length + 1;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Calls the local Ollama embedding API.
 * Accepts one or multiple input strings.
 */
async function requestEmbeddings(inputs) {
  try {
    const response = await fetch(
      `${OLLAMA_BASE_URL}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: inputs,
          truncate: false,
          keep_alive: "10m"
        }),
        signal: AbortSignal.timeout(120000)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Ollama returned HTTP ${response.status}: ${errorText}`
      );
    }

    const data = await response.json();

    if (!Array.isArray(data.embeddings)) {
      throw new Error("Invalid embedding response from Ollama");
    }

    if (data.embeddings.length !== inputs.length) {
      throw new Error("Embedding count does not match input count");
    }

    return data.embeddings.map((vector, index) => {
      if (
        !Array.isArray(vector) ||
        vector.length !== EMBEDDING_DIMENSIONS
      ) {
        throw new Error(
          `Invalid embedding dimensions at index ${index}. Expected ${EMBEDDING_DIMENSIONS}, received ${vector?.length}`
        );
      }

      if (!vector.every(Number.isFinite)) {
        throw new Error(
          `Embedding at index ${index} contains invalid values`
        );
      }

      return vector;
    });

  } catch (error) {
    console.error("Local embedding generation failed:", error.message);

    throw new Error(
      `Failed to generate local embedding: ${error.message}`
    );
  }
}

/**
 * Generates an embedding for a document chunk.
 *
 * EmbeddingGemma 2 document format:
 * title: filename | text: document content
 */
export async function generateDocumentEmbedding(
  text,
  title = "none"
) {
  if (!text?.trim()) {
    throw new Error("Document text cannot be empty");
  }

  const documentInput =
    `title: ${title || "none"} | text: ${text}`;

  const [embedding] = await requestEmbeddings([
    documentInput
  ]);

  return embedding;
}

let embeddingMock = null;

export function setEmbeddingMock(fn) {
  embeddingMock = fn;
}

/**
 * Generates an embedding for a retrieval query.
 *
 * Used when searching the RAG knowledge base.
 */
export async function generateQueryEmbedding(text) {
  if (embeddingMock) {
    return embeddingMock(text);
  }
  if (!text?.trim()) {
    throw new Error("Query text cannot be empty");
  }

  const queryInput =
    `task: question answering | query: ${text}`;

  const [embedding] = await requestEmbeddings([
    queryInput
  ]);

  return embedding;
}

/**
 * Backward-compatible document embedding function.
 */
export async function generateEmbedding(text) {
  return generateDocumentEmbedding(text);
}

/**
 * Processes PDF text:
 * 1. Splits text into chunks.
 * 2. Creates document embeddings in batches.
 * 3. Returns text and corresponding vectors.
 *
 * @param {string} rawText
 * @param {string} fileName
 * @returns {Promise<Array<{text: string, embedding: number[]}>>}
 */
export async function processDocumentText(
  rawText,
  fileName = "none"
) {
  const chunks = chunkText(rawText);

  if (chunks.length === 0) {
    return [];
  }

  const results = [];

  console.log(
    `Processing ${chunks.length} document chunks using ${EMBEDDING_MODEL}`
  );

  // Process chunks in batches to reduce HTTP requests.
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const inputs = batch.map(
      chunk => `title: ${fileName || "none"} | text: ${chunk}`
    );

    const embeddings = await requestEmbeddings(inputs);

    for (let j = 0; j < batch.length; j++) {
      results.push({
        text: batch[j],
        embedding: embeddings[j]
      });
    }

    console.log(
      `Embedded ${Math.min(i + batch.length, chunks.length)} / ${chunks.length} chunks`
    );
  }

  return results;
}
