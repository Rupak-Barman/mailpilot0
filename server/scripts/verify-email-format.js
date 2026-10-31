// server/scripts/verify-email-format.js
import { buildMimeMessage } from "../utils/helpers.js";

const sampleInput = {
  to: "partner@example.com",
  subject: "Partnership Inquiry",
  body: "Hi Jane,\n\nThank you for reaching out regarding the partnership proposal. We are very interested in discussing this further.\n\nPlease let us know your availability for a brief call next week.\n\nBest regards,\nMailpilot Team",
  inReplyTo: "<msg-12345@example.com>",
  references: "<msg-12345@example.com>",
  isReply: true,
};

console.log("Generating sample MIME message...");
const encoded = buildMimeMessage(sampleInput);

console.log("\n--- Encoded Base64url (length: " + encoded.length + ") ---");
console.log(encoded.slice(0, 100) + "...");

const decoded = Buffer.from(encoded, "base64url").toString("utf8");
console.log("\n--- Decoded MIME Structure ---");
console.log(decoded);

// Assertions
const checks = [
  { name: "To header", pass: decoded.includes("To: partner@example.com") },
  { name: "Re: Subject", pass: decoded.includes("Subject: =?UTF-8?B?") },
  { name: "In-Reply-To header", pass: decoded.includes("In-Reply-To: <msg-12345@example.com>") },
  { name: "References header", pass: decoded.includes("References: <msg-12345@example.com>") },
  { name: "MIME-Version header", pass: decoded.includes("MIME-Version: 1.0") },
  { name: "Multipart boundary header", pass: decoded.includes('Content-Type: multipart/alternative; boundary="') },
  { name: "Plain text part exists", pass: decoded.includes('Content-Type: text/plain; charset="UTF-8"') },
  { name: "HTML part exists", pass: decoded.includes('Content-Type: text/html; charset="UTF-8"') },
];

console.log("\n--- Verification Results ---");
let allPassed = true;
for (const check of checks) {
  console.log(`[${check.pass ? "PASS" : "FAIL"}] ${check.name}`);
  if (!check.pass) allPassed = false;
}

if (!allPassed) {
  console.error("\nVerification failed!");
  process.exit(1);
} else {
  console.log("\nAll email formatting checks passed successfully!");
}

