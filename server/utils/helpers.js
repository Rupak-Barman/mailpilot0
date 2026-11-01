// utils/helpers.js

export const getHeader = (email, name) =>
  email?.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name?.toLowerCase()
  )?.value || "";

export const decodeBase64Url = (value = "") =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export const textFromPayload = (payload) => {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    const plain = payload.parts
      .map((part) => textFromPayload(part))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (plain) return plain;
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
};

/**
 * Strips quoted email history ("On ... wrote:", lines starting with ">") and HTML tags,
 * and truncates the body to 4000 characters.
 */
export const stripQuotedAndHtml = (text = "") => {
  if (!text) return "";
  let cleaned = String(text);

  // 1. Replace block tags and breaks with newlines before stripping other tags
  cleaned = cleaned.replace(/<\s*(?:br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi, "\n");

  // 2. Strip remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // 3. Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");

  // Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 4. Cut off at "On ... wrote:" or "-----Original Message-----"
  const onWroteIdx = cleaned.search(/(?:^|\n)\s*On\s+[\s\S]+?wrote:\s*/i);
  if (onWroteIdx !== -1) {
    cleaned = cleaned.slice(0, onWroteIdx);
  }

  const origMsgIdx = cleaned.search(/(?:^|\n)\s*-+\s*Original Message\s*-+/i);
  if (origMsgIdx !== -1) {
    cleaned = cleaned.slice(0, origMsgIdx);
  }

  // 5. Strip lines starting with ">"
  cleaned = cleaned
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .map((line) => line.trim())
    .join("\n");

  // 6. Collapse 3+ consecutive newlines to 2 and trim
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // 7. Truncate to 4000 characters
  if (cleaned.length > 4000) {
    cleaned = cleaned.slice(0, 4000);
  }

  return cleaned;
};

export const wrapBase64 = (b64 = "") => {
  if (!b64) return "";
  return String(b64).replace(/(.{76})/g, "$1\r\n").trimEnd();
};

/**
 * Strips markdown formatting (bold, italic, headers) safely.
 * Rules:
 * 1. Only strip a marker pair when the opening marker is followed by a non-space
 *    and the closing marker is preceded by a non-space on the same line.
 * 2. Never touch "_".
 * 3. Do not remove lone "*".
 * 4. Leave a literal "\n" alone unless it is an obvious model artefact (e.g. \n{3,}).
 */
export const stripMarkdown = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Strip bold/italic asterisks (*word* or **word**) only when non-space bounded on same line:
    .replace(/(?<=^|[^\w*])(\*{1,2})(?!\s)([^\r\n*]+?)(?<!\s)\1(?=[^\w*]|$)/gm, "$2")
    // Strip header hashes at line start:
    .replace(/^#{1,6}\s+/gm, "")
    // Collapse 3+ consecutive newlines to 2 (model artefact), but leave standard \n alone:
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/**
 * Builds a Gmail-compatible base64url-encoded multipart/alternative MIME message.
 * Supports both text/plain and text/html representations, UTF-8 encoding,
 * 76-char base64 line wrapping (RFC 2045), and RFC 2822 threading headers
 * (In-Reply-To, References, Reply-To, Re: subject).
 */
export const buildMimeMessage = ({
  to,
  subject = "",
  body = "",
  inReplyTo = "",
  references = "",
  isReply = false,
  replyTo = "",
}) => {
  const safeHeader = (value = "") =>
    String(value || "")
      .replace(/[\r\n]+/g, " ")
      .trim();

  const safeTo = safeHeader(to);
  if (!safeTo) {
    throw new Error("Recipient email is required");
  }

  let finalSubject = safeHeader(subject ?? "");
  if (isReply && !/^re:/i.test(finalSubject)) {
    finalSubject = `Re: ${finalSubject}`;
  }

  const encodedSubject = `=?UTF-8?B?${Buffer.from(finalSubject, "utf8").toString("base64")}?=`;

  // Clean and normalize body text
  const normalizedBody = stripMarkdown(body);

  // Clean HTML markup with paragraph tags and proper line heights
  const paragraphs = normalizedBody.split(/\n\s*\n/).filter(Boolean);
  const htmlParagraphs =
    paragraphs.length > 0
      ? paragraphs
          .map((p) => {
            const escaped = p
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/\n/g, "<br/>");
            return `<p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">${escaped}</p>`;
          })
          .join("")
      : `<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">${normalizedBody}</p>`;

  const htmlDocument = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background-color:#ffffff;">${htmlParagraphs}</body></html>`;

  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const headers = [
    `To: ${safeTo}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const safeInReplyTo = safeHeader(inReplyTo);
  const safeReferences = safeHeader(references);
  const safeReplyTo = safeHeader(replyTo);

  if (safeInReplyTo) headers.push(`In-Reply-To: ${safeInReplyTo}`);
  if (safeReferences) headers.push(`References: ${safeReferences}`);
  if (safeReplyTo) headers.push(`Reply-To: ${safeReplyTo}`);

  const plainPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(normalizedBody, "utf8").toString("base64")),
  ].join("\r\n");

  const htmlPart = [
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(htmlDocument, "utf8").toString("base64")),
  ].join("\r\n");

  const mimeMessage = [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    plainPart,
    `--${boundary}`,
    htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return Buffer.from(mimeMessage, "utf8").toString("base64url");
};
