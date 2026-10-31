// utils/helpers.js

export const getHeader = (email, name) =>
  email?.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name?.toLowerCase()
  )?.value || "";

/**
 * Builds a Gmail-compatible base64url-encoded multipart/alternative MIME message.
 * Supports both text/plain and text/html representations, UTF-8 encoding,
 * and RFC 2822 threading headers (In-Reply-To, References, Re: subject).
 */
export const buildMimeMessage = ({
  to,
  subject = "",
  body = "",
  inReplyTo = "",
  references = "",
  isReply = false,
}) => {
  const safeHeader = (value = "") =>
    String(value || "")
      .replace(/[\r\n]+/g, " ")
      .trim();

  const safeTo = safeHeader(to);
  if (!safeTo) {
    throw new Error("Recipient email is required");
  }

  let finalSubject = safeHeader(subject);
  if (isReply && !/^re:/i.test(finalSubject)) {
    finalSubject = `Re: ${finalSubject}`;
  }

  const encodedSubject = `=?UTF-8?B?${Buffer.from(finalSubject, "utf8").toString("base64")}?=`;

  // Clean and normalize body text
  const normalizedBody = String(body || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\*\*(.*?)\*\*/g, "$1") // strip bold
    .replace(/\*(.*?)\*/g, "$1") // strip italic
    .replace(/`/g, "") // strip backticks
    .trim();

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

  if (safeInReplyTo) headers.push(`In-Reply-To: ${safeInReplyTo}`);
  if (safeReferences) headers.push(`References: ${safeReferences}`);

  const plainPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(normalizedBody, "utf8").toString("base64"),
  ].join("\r\n");

  const htmlPart = [
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(htmlDocument, "utf8").toString("base64"),
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
