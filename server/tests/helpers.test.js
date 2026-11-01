import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripMarkdown,
  wrapBase64,
  buildMimeMessage,
  getHeader,
} from "../utils/helpers.js";
import { updateGmailDraft } from "../services/gmail.service.js";

describe("stripMarkdown", () => {
  it("leaves lone asterisks untouched (e.g. arithmetic)", () => {
    assert.equal(stripMarkdown("5 * 3 and 2 * 4"), "5 * 3 and 2 * 4");
    assert.equal(stripMarkdown("a * b * c"), "a * b * c");
  });

  it("never touches underscores in identifiers or emails", () => {
    assert.equal(stripMarkdown("snake_case_name"), "snake_case_name");
    assert.equal(stripMarkdown("john_smith_2@x.com"), "john_smith_2@x.com");
    assert.equal(
      stripMarkdown("user_id and order_id_final"),
      "user_id and order_id_final"
    );
  });

  it("strips bold markdown formatting", () => {
    assert.equal(stripMarkdown("**bold** text"), "bold text");
    assert.equal(stripMarkdown("Here is **bold**!"), "Here is bold!");
    assert.equal(
      stripMarkdown("**multiple words bold**"),
      "multiple words bold"
    );
  });

  it("strips italic markdown formatting", () => {
    assert.equal(stripMarkdown("*italic* text"), "italic text");
    assert.equal(stripMarkdown("Here is *italic*!"), "Here is italic!");
  });

  it("strips both bold and italic in the same text", () => {
    assert.equal(
      stripMarkdown("**bold** and *italic* text"),
      "bold and italic text"
    );
  });

  it("strips header hashes at the beginning of a line", () => {
    assert.equal(
      stripMarkdown("### Heading 3\nContent goes here"),
      "Heading 3\nContent goes here"
    );
    assert.equal(
      stripMarkdown("# Header 1\n## Header 2"),
      "Header 1\nHeader 2"
    );
  });

  it("collapses 3+ consecutive newlines to 2 but leaves standard newlines alone", () => {
    assert.equal(stripMarkdown("line 1\n\n\n\nline 2"), "line 1\n\nline 2");
    assert.equal(stripMarkdown("line 1\n\nline 2"), "line 1\n\nline 2");
    assert.equal(stripMarkdown("line 1\nline 2"), "line 1\nline 2");
  });

  it("preserves literal backslashes and does not corrupt file paths", () => {
    assert.equal(
      stripMarkdown("C:\\new_folder\\notes.txt"),
      "C:\\new_folder\\notes.txt"
    );
  });

  it("handles null, undefined, and empty string safely", () => {
    assert.equal(stripMarkdown(""), "");
    assert.equal(stripMarkdown(null), "");
    assert.equal(stripMarkdown(undefined), "");
  });
});

describe("wrapBase64", () => {
  it("returns empty string for empty/falsy inputs", () => {
    assert.equal(wrapBase64(""), "");
    assert.equal(wrapBase64(null), "");
    assert.equal(wrapBase64(undefined), "");
  });

  it("does not wrap strings with length <= 76", () => {
    const str50 = "A".repeat(50);
    assert.equal(wrapBase64(str50), str50);

    const str76 = "B".repeat(76);
    assert.equal(wrapBase64(str76), str76);
  });

  it("wraps strings longer than 76 characters at 76 characters per line", () => {
    const str100 = "C".repeat(100);
    const wrapped = wrapBase64(str100);
    const lines = wrapped.split("\r\n");

    assert.equal(lines.length, 2);
    assert.equal(lines[0].length, 76);
    assert.equal(lines[1].length, 24);
    assert.equal(wrapped.replace(/\r\n/g, ""), str100);
  });

  it("ensures every line has length <= 76 for long payloads", () => {
    const longStr = "D".repeat(450);
    const wrapped = wrapBase64(longStr);
    const lines = wrapped.split("\r\n");

    for (const line of lines) {
      assert.ok(
        line.length <= 76,
        `Line length ${line.length} exceeds 76 characters`
      );
    }
    assert.equal(wrapped.replace(/\r\n/g, ""), longStr);
  });
});

describe("buildMimeMessage", () => {
  it("builds a base64url-encoded multipart MIME message with 76-char wrapped base64 lines", () => {
    const raw = buildMimeMessage({
      to: "recipient@example.com",
      subject: "Hello World",
      body: "This is a test email with a fairly long body to verify that the base64 content-transfer-encoding wrapping behaves properly according to RFC 2045 specifications.\n\nSecond paragraph here.",
    });

    assert.ok(typeof raw === "string" && raw.length > 0);

    // Decode base64url to inspect inner MIME structure
    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    assert.match(decoded, /To: recipient@example\.com/);
    assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
    assert.match(decoded, /MIME-Version: 1\.0/);
    assert.match(decoded, /Content-Type: multipart\/alternative; boundary=/);
    assert.match(decoded, /Content-Type: text\/plain; charset="UTF-8"/);
    assert.match(decoded, /Content-Type: text\/html; charset="UTF-8"/);

    // Extract plain and HTML base64 blocks and verify all lines <= 76 chars
    const plainMatch = decoded.match(
      /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n------=_Part_/
    );
    assert.ok(plainMatch, "plain text part found");
    const plainBase64Lines = plainMatch[1].split("\r\n");
    for (const line of plainBase64Lines) {
      assert.ok(
        line.length <= 76,
        `Plain part base64 line exceeds 76 chars: ${line.length}`
      );
    }

    const htmlMatch = decoded.match(
      /Content-Type: text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n------=_Part_/
    );
    assert.ok(htmlMatch, "html part found");
    const htmlBase64Lines = htmlMatch[1].split("\r\n");
    for (const line of htmlBase64Lines) {
      assert.ok(
        line.length <= 76,
        `HTML part base64 line exceeds 76 chars: ${line.length}`
      );
    }

    // Verify content decoding matches
    const plainContent = Buffer.from(
      plainMatch[1].replace(/\r\n/g, ""),
      "base64"
    ).toString("utf8");
    assert.ok(plainContent.includes("Second paragraph here."));
  });

  it("includes In-Reply-To, References, and Reply-To headers when provided", () => {
    const raw = buildMimeMessage({
      to: "recipient@example.com",
      subject: "Test Subject",
      body: "Reply content",
      inReplyTo: "<msg-101@example.com>",
      references: "<msg-100@example.com> <msg-101@example.com>",
      replyTo: "replies@example.com",
      isReply: true,
    });

    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(decoded, /In-Reply-To: <msg-101@example\.com>/);
    assert.match(
      decoded,
      /References: <msg-100@example\.com> <msg-101@example\.com>/
    );
    assert.match(decoded, /Reply-To: replies@example\.com/);
  });

  it("handles Re: subject prefixing correctly", () => {
    // Adds Re: when isReply is true and subject lacks it
    const raw1 = buildMimeMessage({
      to: "recipient@example.com",
      subject: "Inquiry",
      body: "Text",
      isReply: true,
    });
    const decoded1 = Buffer.from(raw1, "base64url").toString("utf8");
    const subjectMatch1 = decoded1.match(/Subject: =\?UTF-8\?B\?(.+?)\?=/);
    const decodedSubject1 = Buffer.from(subjectMatch1[1], "base64").toString(
      "utf8"
    );
    assert.equal(decodedSubject1, "Re: Inquiry");

    // Does not duplicate Re: if already present
    const raw2 = buildMimeMessage({
      to: "recipient@example.com",
      subject: "Re: Inquiry",
      body: "Text",
      isReply: true,
    });
    const decoded2 = Buffer.from(raw2, "base64url").toString("utf8");
    const subjectMatch2 = decoded2.match(/Subject: =\?UTF-8\?B\?(.+?)\?=/);
    const decodedSubject2 = Buffer.from(subjectMatch2[1], "base64").toString(
      "utf8"
    );
    assert.equal(decodedSubject2, "Re: Inquiry");
  });

  it("guards against undefined and null subjects without crashing", () => {
    assert.doesNotThrow(() => {
      buildMimeMessage({
        to: "recipient@example.com",
        subject: undefined,
        body: "Hello",
        isReply: false,
      });
    });

    assert.doesNotThrow(() => {
      buildMimeMessage({
        to: "recipient@example.com",
        subject: null,
        body: "Hello",
        isReply: true,
      });
    });
  });

  it("throws error when recipient email is missing", () => {
    assert.throws(
      () => {
        buildMimeMessage({
          to: "",
          subject: "No recipient",
          body: "Hello",
        });
      },
      { message: "Recipient email is required" }
    );
  });
});

describe("updateGmailDraft", () => {
  it("passes inReplyTo, references, and replyTo to MIME message and updates draft", async () => {
    let capturedCall = null;
    const mockGmail = {
      users: {
        drafts: {
          update: async (params) => {
            capturedCall = params;
            return { data: { id: params.id, message: params.requestBody.message } };
          },
        },
      },
    };

    const res = await updateGmailDraft(mockGmail, {
      gmailDraftId: "draft-789",
      to: "user@example.com",
      subject: "Re: Follow up",
      body: "Draft body text",
      threadId: "thread-123",
      inReplyTo: "<msg-456@example.com>",
      references: "<msg-123@example.com> <msg-456@example.com>",
      replyTo: "no-reply@example.com",
    });

    assert.equal(res.id, "draft-789");
    assert.equal(capturedCall.userId, "me");
    assert.equal(capturedCall.id, "draft-789");
    assert.equal(capturedCall.requestBody.message.threadId, "thread-123");

    const decoded = Buffer.from(
      capturedCall.requestBody.message.raw,
      "base64url"
    ).toString("utf8");

    assert.match(decoded, /In-Reply-To: <msg-456@example\.com>/);
    assert.match(
      decoded,
      /References: <msg-123@example\.com> <msg-456@example\.com>/
    );
    assert.match(decoded, /Reply-To: no-reply@example\.com/);
  });

  it("does not crash when subject is undefined in updateGmailDraft", async () => {
    let capturedRaw = null;
    const mockGmail = {
      users: {
        drafts: {
          update: async (params) => {
            capturedRaw = params.requestBody.message.raw;
            return { data: { id: params.id } };
          },
        },
      },
    };

    await assert.doesNotReject(async () => {
      await updateGmailDraft(mockGmail, {
        gmailDraftId: "draft-001",
        to: "user@example.com",
        subject: undefined,
        body: "Body without subject",
      });
    });

    assert.ok(capturedRaw);
  });

  it("throws error when gmailDraftId is missing", async () => {
    const mockGmail = {};
    await assert.rejects(
      async () => {
        await updateGmailDraft(mockGmail, {
          to: "user@example.com",
          subject: "Test",
          body: "Hello",
        });
      },
      { message: "Gmail draft ID is missing" }
    );
  });
});
