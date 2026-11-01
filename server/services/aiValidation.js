/**
 * AI output validation and greeting/sign-off formatting utilities.
 */

/**
 * Extract sender's first name from RFC From header.
 * e.g. "Alice Smith <alice@example.com>" -> "Alice"
 *      "Dr. Robert Paulson <bob@test.com>" -> "Robert"
 *      "<alice@example.com>" -> null
 */
export function extractSenderFirstName(from) {
  if (!from || typeof from !== "string") return null;

  let namePart = from.trim();
  const angleMatch = namePart.match(/^([^<]+)<.*>$/);
  if (angleMatch) {
    namePart = angleMatch[1].trim();
  }

  // Remove surrounding quotes
  namePart = namePart.replace(/^["']|["']$/g, "").trim();

  // If namePart is just an email or contains @, no reliable first name
  if (namePart.includes("@") || !namePart) return null;

  // Strip common titles/prefixes
  namePart = namePart.replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+/i, "").trim();

  const tokens = namePart.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const firstToken = tokens[0].replace(/[^a-zA-Z'-]/g, "").trim();
  // Ensure it's a real name (at least 2 letters, not a number or symbol)
  if (firstToken.length >= 2 && /^[a-zA-Z]/.test(firstToken)) {
    return firstToken;
  }

  return null;
}

/**
 * Build greeting prefix in code.
 * Tone formal: "Dear <First Name>,"
 * Default/friendly: "Hi <First Name>,"
 * Fallback when name unknown: "Hello,"
 */
export function buildGreeting({ from, tone = "friendly" } = {}) {
  const firstName = extractSenderFirstName(from);
  const isFormal = String(tone).toLowerCase() === "formal";

  if (!firstName) {
    return "Hello,";
  }

  return isFormal ? `Dear ${firstName},` : `Hi ${firstName},`;
}

/**
 * Build sign-off block in code.
 * Uses profile name from the user's profile.
 * Tone formal: "Sincerely,\n<User Name>"
 * Default/friendly: "Best regards,\n<User Name>"
 */
export function buildSignOff({ userName, tone = "friendly" } = {}) {
  const isFormal = String(tone).toLowerCase() === "formal";
  const signOffClosing = isFormal ? "Sincerely" : "Best regards";
  const cleanName = typeof userName === "string" ? userName.trim() : "";

  return cleanName ? `${signOffClosing},\n${cleanName}` : `${signOffClosing},`;
}

/**
 * Remove any greeting or sign-off inadvertently written by the model.
 */
export function stripGreetingsAndSignOffs(text) {
  if (!text) return "";

  let cleaned = text.trim();

  // Strip leading greeting if model generated one
  cleaned = cleaned.replace(
    /^(?:hi|hello|dear|hey)\b[^\n,]*[,!]?\s*\n*/i,
    ""
  ).trim();

  // Strip trailing sign-off if model generated one
  cleaned = cleaned.replace(
    /\n+(?:best regards|warm regards|kind regards|sincerely|regards|cheers|best|thanks|thank you)[^\n]*(?:\n+[^\n]+)?$/i,
    ""
  ).trim();

  return cleaned;
}

/**
 * Helper to check if a specific string exists in trusted context.
 */
function isContainedInContext(target, trustedContextNormalized) {
  if (!target) return true;
  const cleanTarget = String(target).toLowerCase().trim();
  if (!cleanTarget) return true;
  return trustedContextNormalized.includes(cleanTarget);
}

/**
 * Validate generated email body according to BATCH 3 validation rules:
 * 1. Empty or under ~5 words -> invalid
 * 2. Placeholders ([Name], [Your Name], [Your, {name}, TODO, <insert) -> invalid
 * 3. Markdown remnants (**, ##, ```) -> invalid
 * 4. Raw JSON leftovers -> invalid
 * 5. Invented specifics (numbers, dates, prices, URLs, email addresses, phone numbers
 *    not present in email, retrieved chunks, or profile/persona) -> invalid
 * Never flag proper nouns.
 */
export function validateGeneratedBody({
  body,
  emailText = "",
  retrievedKnowledge = "",
  userProfile = "",
  persona = ""
} = {}) {
  if (!body || typeof body !== "string") {
    return {
      valid: false,
      reason: "invalid_output",
      error: "Body is empty"
    };
  }

  const trimmed = body.trim();

  // 1. Word count: must not be under ~5 words
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 5) {
    return {
      valid: false,
      reason: "invalid_output",
      error: `Body too short (${words.length} words, minimum 5 required)`
    };
  }

  // 2. Placeholders: [Name], [Your Name], [Your, {name}, TODO, <insert
  const placeholderRegex = /\[(?:name|your name|your|insert|\.\.\.)\]|\[your\b|\{name\}|\btodo\b|<insert/i;
  const placeholderMatch = trimmed.match(placeholderRegex);
  if (placeholderMatch) {
    return {
      valid: false,
      reason: "invalid_output",
      error: `Placeholder detected: "${placeholderMatch[0]}"`
    };
  }

  // 3. Markdown remnants: **, ##, triple backtick
  if (/\*\*|##|```/.test(trimmed)) {
    return {
      valid: false,
      reason: "invalid_output",
      error: "Markdown remnants detected (bold, headers, or backticks)"
    };
  }

  // 4. Raw JSON leftovers
  if (
    /\{[\s\S]*"[a-zA-Z0-9_]+"\s*:[\s\S]*\}/.test(trimmed) ||
    /^\s*\{[\s\S]*\}\s*$/.test(trimmed) ||
    trimmed.includes('{"') ||
    trimmed.includes('"}')
  ) {
    return {
      valid: false,
      reason: "invalid_output",
      error: "Raw JSON leftovers detected"
    };
  }

  // 5. Invented specifics: prices, URLs, emails, phone numbers, and multi-digit numbers/dates
  const trustedContext = [
    emailText,
    retrievedKnowledge,
    userProfile,
    persona
  ].join(" ").toLowerCase();

  // (a) Prices: e.g. $49, $120.00, 50 USD, 100 dollars
  const priceMatches = trimmed.match(/\$\s*\d+(?:\.\d{2})?|\b\d+\s*(?:dollars|usd|eur|gbp|euros|cents)\b/gi) || [];
  for (const price of priceMatches) {
    const rawNumber = price.replace(/[^\d.]/g, "");
    if (!isContainedInContext(price, trustedContext) && !isContainedInContext(rawNumber, trustedContext)) {
      return {
        valid: false,
        reason: "invalid_output",
        error: `Invented price detected: "${price}"`
      };
    }
  }

  // (b) URLs: https://... or www....
  const urlMatches = trimmed.match(/\bhttps?:\/\/[^\s<>"{}|\\^`]+|\bwww\.[^\s<>"{}|\\^`]+/gi) || [];
  for (const url of urlMatches) {
    if (!isContainedInContext(url, trustedContext)) {
      return {
        valid: false,
        reason: "invalid_output",
        error: `Invented URL detected: "${url}"`
      };
    }
  }

  // (c) Email addresses:
  const emailMatches = trimmed.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi) || [];
  for (const email of emailMatches) {
    if (!isContainedInContext(email, trustedContext)) {
      return {
        valid: false,
        reason: "invalid_output",
        error: `Invented email address detected: "${email}"`
      };
    }
  }

  // (d) Phone numbers:
  const phoneMatches = trimmed.match(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g) || [];
  for (const phone of phoneMatches) {
    const digitsOnly = phone.replace(/\D/g, "");
    if (!isContainedInContext(phone, trustedContext) && !isContainedInContext(digitsOnly, trustedContext)) {
      return {
        valid: false,
        reason: "invalid_output",
        error: `Invented phone number detected: "${phone}"`
      };
    }
  }

  // (e) Multi-digit numbers (like order numbers, dates like 2026, specific quantities like 150)
  const numberMatches = trimmed.match(/\b\d{2,}\b|\b\d+%\b/g) || [];
  for (const num of numberMatches) {
    const cleanNum = num.toLowerCase().trim();
    if (!isContainedInContext(cleanNum, trustedContext)) {
      return {
        valid: false,
        reason: "invalid_output",
        error: `Invented number/statistic detected: "${num}"`
      };
    }
  }

  return { valid: true };
}

