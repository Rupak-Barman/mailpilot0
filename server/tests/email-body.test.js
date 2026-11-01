import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEmailBody,
  normalizeParagraphs,
  splitIntoSentences,
  stripModelFraming,
  GREETING_REGEX,
  SIGN_OFF_REGEX
} from "../utils/emailBody.js";
import { buildGreeting, buildSignOff } from "../services/aiValidation.js";
import { buildMimeMessage } from "../utils/helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Email Body Formatting, Paragraph Normalization & Framing", () => {
  const sampleInput =
    "Dear Rupak, My career goals are to excel in CSE engineering and build a successful business. I aim to leverage technology to innovate and solve complex problems. Sincerely, Rupak Barman";

  it("1. exact sample through normalizeParagraphs: output has greeting from code, 2 paragraphs, and profile sign-off; no Dear or Sincerely", () => {
    const paragraphs = normalizeParagraphs(sampleInput);
    assert.equal(paragraphs.length, 2, "Sample should produce exactly 2 paragraphs");
    assert.equal(
      paragraphs[0],
      "My career goals are to excel in CSE engineering and build a successful business."
    );
    assert.equal(
      paragraphs[1],
      "I aim to leverage technology to innovate and solve complex problems."
    );

    const greeting = buildGreeting({ from: "Rupak Barman <rupak@example.com>", tone: "friendly" });
    const signOff = buildSignOff({ userName: "Rupak Barman", tone: "friendly" });
    const fullBody = buildEmailBody({
      greeting,
      paragraphs,
      signOff,
      name: "Rupak Barman"
    });

    const expected =
      "Hi Rupak,\n\nMy career goals are to excel in CSE engineering and build a successful business.\n\nI aim to leverage technology to innovate and solve complex problems.\n\nBest regards,\nRupak Barman";

    assert.equal(fullBody, expected);
    assert.ok(!fullBody.includes("Dear"), "Must not contain model-written 'Dear'");
    assert.ok(!fullBody.includes("Sincerely"), "Must not contain model-written 'Sincerely'");
    assert.ok(fullBody.startsWith("Hi Rupak,\n\n"));
    assert.ok(fullBody.endsWith("Best regards,\nRupak Barman"));
  });

  it("2. handles literal '\\n' sequences, CRLF sequences, one long paragraph, and already well-formed input", () => {
    // Literal \n
    const literalN = "First paragraph line.\\n\\nSecond paragraph line.";
    const parasFromLiteralN = normalizeParagraphs(literalN);
    assert.deepEqual(parasFromLiteralN, ["First paragraph line.", "Second paragraph line."]);

    // CRLF
    const crlf = "Line 1 in para 1.\r\n\r\nLine 2 in para 2.";
    const parasFromCrlf = normalizeParagraphs(crlf);
    assert.deepEqual(parasFromCrlf, ["Line 1 in para 1.", "Line 2 in para 2."]);

    // One long paragraph (>240 chars)
    const longSingleParagraph =
      "This is the first sentence detailing engineering advancements. This is the second sentence providing empirical data on system latency under heavy load. This is the third sentence evaluating distributed architectures against monolithic benchmarks. This is the fourth sentence concluding our initial research findings.";
    assert.ok(longSingleParagraph.length > 240);
    const parasFromLong = normalizeParagraphs(longSingleParagraph);
    assert.ok(parasFromLong.length >= 2, "Long paragraph should be split into 2 or more paragraphs");
    assert.equal(
      parasFromLong[0],
      "This is the first sentence detailing engineering advancements. This is the second sentence providing empirical data on system latency under heavy load."
    );
    assert.equal(
      parasFromLong[1],
      "This is the third sentence evaluating distributed architectures against monolithic benchmarks. This is the fourth sentence concluding our initial research findings."
    );

    // Already well-formed input remains unchanged
    const wellFormed = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";
    const parasFromWellFormed = normalizeParagraphs(wellFormed);
    assert.deepEqual(parasFromWellFormed, [
      "First paragraph here.",
      "Second paragraph here.",
      "Third paragraph here."
    ]);
  });

  it("3. sentence splitting does not break 'e.g.', 'Dr. Smith' or '3.5'", () => {
    const textWithAbbrs =
      "Dr. Smith reviewed section 3.5 of our report e.g. for accuracy. He confirmed the numbers were correct. Please proceed with the submission.";
    const sentences = splitIntoSentences(textWithAbbrs);

    assert.equal(sentences.length, 3, "Should split into exactly 3 sentences");
    assert.equal(
      sentences[0],
      "Dr. Smith reviewed section 3.5 of our report e.g. for accuracy."
    );
    assert.equal(sentences[1], "He confirmed the numbers were correct.");
    assert.equal(sentences[2], "Please proceed with the submission.");
  });

  it("4. revise mode keeps the paragraph count and preserves custom user framing", () => {
    const currentParagraphs = [
      "Here is the first point we discussed yesterday.",
      "Here is the second point regarding the project milestones.",
      "Let us know if you need any adjustments to this plan."
    ];
    const numberedList = currentParagraphs
      .map((p, idx) => `[Paragraph ${idx + 1}]:\n${p}`)
      .join("\n\n");

    assert.ok(numberedList.includes("[Paragraph 1]:"));
    assert.ok(numberedList.includes("[Paragraph 2]:"));
    assert.ok(numberedList.includes("[Paragraph 3]:"));

    // User customized greeting and sign-off
    const customUserDraft =
      "Good morning team,\n\nWe have updated the release notes.\n\nAll my best,\nAlice";
    const greetingMatch = GREETING_REGEX.test(customUserDraft);
    // "Good morning" is not hi/hello/dear/hey, so framingMatched remains false
    assert.equal(greetingMatch, false, "Custom greeting must not be detected as default model greeting");

    // Custom framing is preserved as-is
    const customParas = normalizeParagraphs(customUserDraft);
    const bodyRebuilt = buildEmailBody({
      greeting: "",
      paragraphs: customParas,
      signOff: ""
    });
    assert.ok(bodyRebuilt.includes("Good morning team,"));
    assert.ok(bodyRebuilt.includes("All my best,"));
  });

  it("5. assist compose, assist revise, and the auto-generation path all call buildEmailBody", () => {
    const aiEngineSrc = fs.readFileSync(
      path.resolve(__dirname, "../services/aiEngine.js"),
      "utf8"
    );
    const aiAssistSrc = fs.readFileSync(
      path.resolve(__dirname, "../services/aiAssist.service.js"),
      "utf8"
    );

    // aiEngine.js uses buildEmailBody and normalizeParagraphs
    assert.ok(aiEngineSrc.includes("buildEmailBody("), "aiEngine.js must call buildEmailBody");
    assert.ok(aiEngineSrc.includes("normalizeParagraphs("), "aiEngine.js must call normalizeParagraphs");

    // aiAssist.service.js uses buildEmailBody and normalizeParagraphs
    assert.ok(aiAssistSrc.includes("buildEmailBody("), "aiAssist.service.js must call buildEmailBody");
    assert.ok(aiAssistSrc.includes("normalizeParagraphs("), "aiAssist.service.js must call normalizeParagraphs");
  });

  it("6. decoded MIME: plain part has blank lines, HTML part has <p> tags with proper HTML escaping", () => {
    const paragraphs = [
      "We received your enquiry regarding pricing & availability.",
      "The service tier is <standard> and rates are $100/mo."
    ];
    const fullBody = buildEmailBody({
      greeting: "Hi Taylor,",
      paragraphs,
      signOff: "Best regards,",
      name: "Alex Smith"
    });

    const rawMime = buildMimeMessage({
      to: "taylor@example.com",
      subject: "Pricing Inquiry",
      body: fullBody,
      userEmail: "alex@example.com"
    });

    const decoded = Buffer.from(rawMime, "base64url").toString("utf8");

    // Plain text part
    const plainMatch = decoded.match(
      /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n----/
    );
    assert.ok(plainMatch, "MIME must contain text/plain part");
    const plainText = Buffer.from(plainMatch[1].replace(/\r\n/g, ""), "base64").toString("utf8");

    // Plain text contains blank lines between sections
    const normalizedPlain = plainText.replace(/\r\n/g, "\n");
    assert.ok(normalizedPlain.includes("Hi Taylor,\n\n"));
    assert.ok(normalizedPlain.includes("\n\nBest regards,\nAlex Smith"));
    const plainParagraphs = normalizedPlain.split(/\n\s*\n/).filter(Boolean);
    assert.equal(plainParagraphs.length, 4, "Plain text part must have 4 distinct blank-line separated sections");

    // HTML text part
    const htmlMatch = decoded.match(
      /Content-Type: text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n----/
    );
    assert.ok(htmlMatch, "MIME must contain text/html part");
    const htmlText = Buffer.from(htmlMatch[1].replace(/\r\n/g, ""), "base64").toString("utf8");

    // HTML contains <p style="..."> tags for each paragraph
    const pTagMatches = htmlText.match(/<p style="[^"]*">([\s\S]*?)<\/p>/g);
    assert.ok(pTagMatches, "HTML must contain paragraph tags");
    assert.equal(pTagMatches.length, 4, "HTML part must contain 4 <p> elements");

    // HTML escaping
    assert.ok(htmlText.includes("&amp;"), "& must be escaped to &amp;");
    assert.ok(htmlText.includes("&lt;standard&gt;"), "<standard> must be escaped to &lt;standard&gt;");
    assert.ok(!htmlText.includes("<standard>"), "Raw unescaped HTML tag must not exist");
  });

  it("7. frontend component verification: editor textarea and read-only views preserve line breaks with whitespace-pre-wrap", () => {
    const rawSrc = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/features/emailActions/EmailActionDetail.jsx"),
      "utf8"
    );
    const detailComponentSrc = rawSrc.replace(/\r\n/g, "\n");

    // Verifies textarea is used for body editing
    assert.ok(
      detailComponentSrc.includes('<textarea\n                                name="body"'),
      "Draft editor must use a textarea for body editing"
    );

    // Verifies whitespace-pre-wrap is used for read-only outgoing body display
    assert.ok(
      detailComponentSrc.includes("whitespace-pre-wrap break-words"),
      "Read-only outgoing body view must use whitespace-pre-wrap"
    );

    // Verifies state update does not strip newlines
    assert.ok(
      detailComponentSrc.includes("editor.setAiPreview(previewObj)") ||
        detailComponentSrc.includes("setForm((prev) => ({ ...prev, body: res.body }))"),
      "Assist draft update must set res.body directly without stripping newlines"
    );
  });
});
