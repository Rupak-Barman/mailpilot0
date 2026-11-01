/**
 * Shared Email Body & Paragraph Formatting Utilities
 * Used by Batch 3 (auto-generation), AI assist compose, and AI assist revise.
 */

const ABBREVIATIONS = new Set([
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "sr.",
  "jr.",
  "e.g.",
  "i.e.",
  "etc.",
  "vs.",
  "al.",
  "fig.",
  "dept.",
  "approx.",
]);

export const GREETING_REGEX =
  /^(?:hi|hello|dear|hey)\b(?:[^\n,!?]*[,!?]|[^\n]*\n+)\s*/i;

export const SIGN_OFF_KEYWORDS =
  "(?:best regards|warm regards|kind regards|with regards|sincerely|regards|cheers|thanks|thank you|best)";

export const SIGN_OFF_REGEX = new RegExp(
  "(?:(?:\\r?\\n)+|(?<=[.!?])\\s+)" +
    SIGN_OFF_KEYWORDS +
    "[,!]?(?:\\s+[\\s\\S]+)?$",
  "i"
);

/**
 * Split a text block into sentences without splitting on known abbreviations
 * (e.g., Dr., e.g., i.e.) or numbers (e.g. 3.5).
 */
export function splitIntoSentences(text) {
  if (!text) return [];
  const clean = String(text).trim();
  if (!clean) return [];

  // Match sentence punctuation [.!?] followed by whitespace or end of string
  const regex = /([.!?]+)(?:\s+|$)/g;
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    const punct = match[1];
    const matchEnd = match.index + match[0].length;
    const candidate = clean.slice(lastIndex, match.index + punct.length).trim();
    const words = candidate.split(/\s+/);
    const lastWord = words[words.length - 1].toLowerCase();

    const isAbbr =
      ABBREVIATIONS.has(lastWord) ||
      /^[a-z]\.$/i.test(lastWord) ||
      /^[a-z](\.[a-z])+\.?$/i.test(lastWord);

    // If candidate ends with an abbreviation and not at end of text, don't split yet
    if (isAbbr && matchEnd < clean.length) {
      continue;
    }

    tokens.push(clean.slice(lastIndex, match.index + punct.length).trim());
    lastIndex = matchEnd;
  }

  if (lastIndex < clean.length) {
    const remainder = clean.slice(lastIndex).trim();
    if (remainder) {
      if (tokens.length > 0) {
        tokens[tokens.length - 1] += ` ${remainder}`;
      } else {
        tokens.push(remainder);
      }
    }
  }

  return tokens.filter(Boolean);
}

/**
 * Chunk an array of sentences into paragraphs of 2 to 3 sentences.
 */
function chunkSentences(sentences) {
  if (!sentences || sentences.length === 0) return [];
  if (sentences.length <= 1) return sentences;
  if (sentences.length === 2) return [sentences[0], sentences[1]];
  if (sentences.length === 3) {
    return [sentences.slice(0, 2).join(" "), sentences[2]];
  }

  const paragraphs = [];
  for (let i = 0; i < sentences.length; i += 2) {
    if (sentences.length - i === 3) {
      paragraphs.push(sentences.slice(i, i + 3).join(" "));
      break;
    }
    paragraphs.push(sentences.slice(i, i + 2).join(" "));
  }
  return paragraphs;
}

/**
 * Strip model-written leading greetings and trailing sign-offs.
 */
export function stripModelFraming(text) {
  if (!text) return "";
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(GREETING_REGEX, "").trim();
  cleaned = cleaned.replace(SIGN_OFF_REGEX, "").trim();
  return cleaned;
}

/**
 * Normalizes input (string or string[]) into clean body paragraphs:
 * 1. Converts literal "\\n" and "\\r\\n" to real newlines.
 * 2. Normalizes CRLF to LF.
 * 3. Strips model-written greeting and sign-off framing.
 * 4. Splits on blank lines.
 * 5. Trims each paragraph and collapses spaces inside a paragraph only (never across paragraphs).
 * 6. If result is one paragraph longer than ~240 chars or has 2+ sentences,
 *    splits at sentence boundaries into paragraphs of 2 to 3 sentences (preserving abbreviations/numbers).
 */
export function normalizeParagraphs(input) {
  if (!input) return [];

  let raw = "";
  if (Array.isArray(input)) {
    raw = input.filter(Boolean).map(String).join("\n\n");
  } else {
    raw = String(input);
  }

  let text = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  // Remove leading greeting line and trailing sign-off block written by the model
  text = stripModelFraming(text);

  if (!text) return [];

  // Split on blank lines
  const initialParas = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (initialParas.length === 0) return [];

  if (initialParas.length === 1) {
    const single = initialParas[0];
    const sentences = splitIntoSentences(single);
    if (sentences.length === 2 || single.length > 240) {
      return chunkSentences(sentences);
    }
    return [single];
  }

  // Multi-paragraph input: preserve paragraphs, chunking any single paragraph that is > 240 chars
  const result = [];
  for (const p of initialParas) {
    if (p.length > 240) {
      const s = splitIntoSentences(p);
      if (s.length > 1) {
        result.push(...chunkSentences(s));
        continue;
      }
    }
    result.push(p);
  }

  return result;
}

/**
 * Builds standard email body from components:
 * - greeting line
 * - blank line
 * - each paragraph separated by a blank line
 * - blank line
 * - sign-off line
 * - name line
 *
 * Internal newlines strictly use "\n".
 */
export function buildEmailBody({ greeting, paragraphs, signOff, name }) {
  const parts = [];

  const cleanGreeting = typeof greeting === "string" ? greeting.trim() : "";
  if (cleanGreeting) {
    parts.push(cleanGreeting);
  }

  const normParagraphs = Array.isArray(paragraphs)
    ? normalizeParagraphs(paragraphs)
    : normalizeParagraphs(paragraphs);

  if (normParagraphs.length > 0) {
    parts.push(normParagraphs.join("\n\n"));
  }

  const cleanSignOff = typeof signOff === "string" ? signOff.trim() : "";
  const cleanName = typeof name === "string" ? name.trim() : "";

  let signOffBlock = "";
  if (cleanSignOff && cleanName) {
    if (cleanSignOff.toLowerCase().endsWith(cleanName.toLowerCase())) {
      signOffBlock = cleanSignOff;
    } else {
      signOffBlock = `${cleanSignOff}\n${cleanName}`;
    }
  } else if (cleanSignOff) {
    signOffBlock = cleanSignOff;
  } else if (cleanName) {
    signOffBlock = cleanName;
  }

  if (signOffBlock) {
    parts.push(signOffBlock);
  }

  return parts.join("\n\n");
}
