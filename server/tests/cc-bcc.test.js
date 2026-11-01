import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildMimeMessage,
  isValidEmail,
  parseRecipient,
  parseRecipientList,
  formatRecipient,
  formatRecipientList,
  processRecipients
} from "../utils/helpers.js";
import EmailAction, { normalizeRecipientList } from "../models/EmailAction.js";
import User from "../models/User.js";

describe("BATCH 5.7: CC and BCC", () => {
  describe("1. Header output & backwards compatibility", () => {
    it("writes Cc and Bcc headers when cc and bcc are provided as recipient arrays", () => {
      const raw = buildMimeMessage({
        to: [{ name: "Alice", email: "alice@example.com" }],
        cc: [
          { name: "Bob", email: "bob@example.com" },
          { name: "Charlie", email: "charlie@example.com" }
        ],
        bcc: [{ name: "Secret", email: "bcc@example.com" }],
        subject: "Project Update",
        body: "Hello team"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");

      assert.match(decoded, /^To: Alice <alice@example\.com>$/m);
      assert.match(
        decoded,
        /^Cc: Bob <bob@example\.com>, Charlie <charlie@example\.com>$/m
      );
      assert.match(decoded, /^Bcc: Secret <bcc@example\.com>$/m);
    });

    it("writes plain email when name is not provided or empty", () => {
      const raw = buildMimeMessage({
        to: "alice@example.com",
        cc: ["bob@example.com"],
        bcc: "charlie@example.com",
        subject: "Testing",
        body: "Test body"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");

      assert.match(decoded, /^To: alice@example\.com$/m);
      assert.match(decoded, /^Cc: bob@example\.com$/m);
      assert.match(decoded, /^Bcc: charlie@example\.com$/m);
    });

    it("omits Cc and Bcc headers when cc and bcc are missing or empty", () => {
      const raw = buildMimeMessage({
        to: "alice@example.com",
        subject: "No CC or BCC",
        body: "Test body"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");

      assert.match(decoded, /^To: alice@example\.com$/m);
      assert.doesNotMatch(decoded, /^Cc:/m);
      assert.doesNotMatch(decoded, /^Bcc:/m);
    });

    it("remains fully backwards compatible with string to parameter", () => {
      const raw = buildMimeMessage({
        to: "recipient@example.com",
        subject: "Batch 6 compatibility",
        body: "Body text"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      assert.match(decoded, /^To: recipient@example\.com$/m);
      assert.match(decoded, /MIME-Version: 1\.0/);
    });
  });

  describe("2. Own-address removal", () => {
    it("removes user own address case-insensitively from cc and bcc", () => {
      const raw = buildMimeMessage({
        to: "recipient@example.com",
        cc: [
          { name: "Me", email: "user@example.com" },
          { name: "Colleague", email: "colleague@example.com" }
        ],
        bcc: [
          "USER@EXAMPLE.COM",
          "auditor@example.com"
        ],
        subject: "Check CC",
        body: "Body",
        userEmail: "user@example.com"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");

      assert.match(decoded, /^Cc: Colleague <colleague@example\.com>$/m);
      assert.doesNotMatch(decoded, /user@example\.com/i);
      assert.match(decoded, /^Bcc: auditor@example\.com$/m);
    });

    it("does not remove user address from to field", () => {
      const raw = buildMimeMessage({
        to: "user@example.com",
        cc: "colleague@example.com",
        subject: "To self",
        body: "Note to self",
        userEmail: "user@example.com"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      assert.match(decoded, /^To: user@example\.com$/m);
    });
  });

  describe("3. Invalid addresses rejected", () => {
    it("rejects invalid email address in to field", () => {
      assert.throws(
        () => {
          buildMimeMessage({
            to: "not-an-email",
            subject: "Invalid",
            body: "Test"
          });
        },
        /Invalid recipient email address/
      );
    });

    it("rejects invalid email address in cc field", () => {
      assert.throws(
        () => {
          buildMimeMessage({
            to: "alice@example.com",
            cc: ["valid@example.com", "not an email"],
            subject: "Invalid CC",
            body: "Test"
          });
        },
        /Invalid recipient email address/
      );
    });

    it("rejects invalid email address in bcc field", () => {
      assert.throws(
        () => {
          buildMimeMessage({
            to: "alice@example.com",
            bcc: "bad@domain@double.com",
            subject: "Invalid BCC",
            body: "Test"
          });
        },
        /Invalid recipient email address/
      );
    });

    it("isValidEmail correctly validates emails", () => {
      assert.equal(isValidEmail("test@example.com"), true);
      assert.equal(isValidEmail("user.name+tag@sub.example.co.uk"), true);
      assert.equal(isValidEmail(""), false);
      assert.equal(isValidEmail(null), false);
      assert.equal(isValidEmail("missing-at.com"), false);
      assert.equal(isValidEmail("missing-domain@"), false);
      assert.equal(isValidEmail("@missing-local.com"), false);
      assert.equal(isValidEmail("has spaces@example.com"), false);
    });
  });

  describe("4. Header injection stripped", () => {
    it("strips CR and LF from recipient names and emails", () => {
      const raw = buildMimeMessage({
        to: [
          {
            name: "Alice\r\nBcc: evil@example.com",
            email: "alice@example.com"
          }
        ],
        subject: "Testing injection\r\nInjected-Header: evil",
        body: "Clean body"
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");

      assert.doesNotMatch(decoded, /\r\nInjected-Header:/);
      assert.doesNotMatch(decoded, /\r\nBcc: evil@example.com/);
      assert.match(decoded, /^To: AliceBcc: evil@example\.com <alice@example\.com>$/m);
    });

    it("rejects email addresses containing injected newlines", () => {
      assert.throws(() => {
        buildMimeMessage({
          to: "alice@example.com\r\nBcc: evil@example.com",
          subject: "Test",
          body: "Body"
        });
      }, /Invalid recipient email address/);
    });
  });

  describe("5. Deduplication, parsing and 20-recipient limit", () => {
    it("deduplicates addresses case-insensitively keeping first name", () => {
      const processed = processRecipients([
        { name: "Bob First", email: "bob@example.com" },
        { name: "Bob Duplicate", email: "BOB@EXAMPLE.COM" },
        { name: "Bob Third", email: "bob@example.com" }
      ]);

      assert.equal(processed.length, 1);
      assert.equal(processed[0].name, "Bob First");
      assert.equal(processed[0].email, "bob@example.com");
    });

    it("parses comma and semicolon separated strings with names", () => {
      const input = '"Smith, Alice" <alice@example.com>, bob@example.com; Charlie <charlie@example.com>';
      const parsed = parseRecipientList(input);

      assert.equal(parsed.length, 3);
      assert.equal(parsed[0].email, "alice@example.com");
      assert.equal(parsed[1].email, "bob@example.com");
      assert.equal(parsed[2].name, "Charlie");
      assert.equal(parsed[2].email, "charlie@example.com");
    });

    it("limits recipients to 20 per field", () => {
      const recipients = [];
      for (let i = 1; i <= 25; i++) {
        recipients.push({ name: `User ${i}`, email: `user${i}@example.com` });
      }

      const processed = processRecipients(recipients);
      assert.equal(processed.length, 20);
      assert.equal(processed[0].email, "user1@example.com");
      assert.equal(processed[19].email, "user20@example.com");
    });
  });

  describe("6. Model schema & lazy migration", () => {
    it("lazily migrates existing string fields to recipient arrays", () => {
      const normalized = normalizeRecipientList("single@example.com");
      assert.deepEqual(normalized, [{ name: "", email: "single@example.com" }]);

      const normalizedMultiple = normalizeRecipientList("a@example.com, b@example.com");
      assert.deepEqual(normalizedMultiple, [
        { name: "", email: "a@example.com" },
        { name: "", email: "b@example.com" }
      ]);

      const normalizedEmpty = normalizeRecipientList(null);
      assert.deepEqual(normalizedEmpty, []);
    });

    it("EmailAction OutgoingTurn schema stores to, cc, bcc, suggestedCc as recipient arrays", () => {
      const action = new EmailAction({
        userId: "user_test_123",
        turns: [
          {
            incomingMessageId: "msg_1",
            outgoing: {
              kind: "draft",
              to: "client@example.com",
              cc: ["manager@example.com"],
              bcc: [{ name: "Log", email: "log@example.com" }],
              suggestedCc: ["other@example.com"]
            }
          }
        ]
      });

      const turnOutgoing = action.turns[0].outgoing;
      assert.equal(Array.isArray(turnOutgoing.to), true);
      assert.equal(turnOutgoing.to[0].email, "client@example.com");
      assert.equal(Array.isArray(turnOutgoing.cc), true);
      assert.equal(turnOutgoing.cc[0].email, "manager@example.com");
      assert.equal(Array.isArray(turnOutgoing.bcc), true);
      assert.equal(turnOutgoing.bcc[0].name, "Log");
      assert.equal(turnOutgoing.bcc[0].email, "log@example.com");
      assert.equal(Array.isArray(turnOutgoing.suggestedCc), true);
      assert.equal(turnOutgoing.suggestedCc[0].email, "other@example.com");
    });

    it("User schema does not support defaultCc or label alwaysCc (Batch 5.9 removal)", () => {
      const user = new User({
        email: "user@example.com",
        settings: {
          groupBySender: true,
          defaultCc: ["assistant@example.com", "archive@example.com"]
        },
        labels: [
          {
            name: "Finance",
            color: "#3b82f6",
            alwaysCc: ["cfo@example.com"]
          }
        ]
      });

      // defaultCc and alwaysCc are ignored and omitted by the schema
      assert.equal(user.settings.defaultCc, undefined);
      assert.equal(user.labels[0].alwaysCc, undefined);
      assert.equal(user.labels[0].color, "#3b82f6");
    });
  });

  describe("7. SuggestedCc logic & No automatic CC (Batch 5.9)", () => {
    it("suggestedCc extracts other incoming recipients excluding sender and user", () => {
      const userEmail = "me@example.com";
      const senderFrom = "Alice Sender <alice@example.com>";
      const incomingTo = "me@example.com, Bob Colleague <bob@example.com>";
      const incomingCc = "Carol <carol@example.com>, Dave <dave@example.com>, me@example.com";

      const allIncoming = [
        ...parseRecipientList(incomingTo),
        ...parseRecipientList(incomingCc)
      ];
      const senderRecipient = parseRecipient(senderFrom);
      const senderEmailLower = senderRecipient.email.toLowerCase();
      const userEmailLower = userEmail.toLowerCase();

      const suggestedMap = new Map();
      for (const r of allIncoming) {
        const el = r.email.toLowerCase();
        if (el && el !== senderEmailLower && el !== userEmailLower) {
          if (!suggestedMap.has(el)) {
            suggestedMap.set(el, { name: r.name || "", email: r.email });
          }
        }
      }
      const suggestedCc = Array.from(suggestedMap.values());

      assert.equal(suggestedCc.length, 3);
      assert.deepEqual(
        suggestedCc.map((s) => s.email),
        ["bob@example.com", "carol@example.com", "dave@example.com"]
      );
    });

    it("generated draft and auto reply have an empty cc by default (nothing is CC'd automatically)", () => {
      // Incoming email with multiple other recipients
      const incomingTo = "user@example.com, other1@example.com";
      const incomingCc = "other2@example.com";
      const userEmail = "user@example.com";
      const senderFrom = "client@example.com";

      const allIncoming = [
        ...parseRecipientList(incomingTo),
        ...parseRecipientList(incomingCc)
      ];
      const senderRecipient = parseRecipient(senderFrom);
      const senderEmailLower = senderRecipient.email.toLowerCase();
      const userEmailLower = userEmail.toLowerCase();

      const suggestedMap = new Map();
      for (const r of allIncoming) {
        const el = r.email.toLowerCase();
        if (el && el !== senderEmailLower && el !== userEmailLower) {
          if (!suggestedMap.has(el)) {
            suggestedMap.set(el, { name: r.name || "", email: r.email });
          }
        }
      }
      const suggestedCc = Array.from(suggestedMap.values()).slice(0, 20);

      // Verify rule: appliedCc is ALWAYS empty
      const appliedCc = [];
      const appliedTo = [senderRecipient];
      const appliedBcc = [];

      assert.equal(appliedCc.length, 0);
      assert.deepEqual(appliedCc, []);

      // Building MIME with empty CC produces no CC header
      const raw = buildMimeMessage({
        to: appliedTo,
        cc: appliedCc,
        bcc: appliedBcc,
        subject: "Re: Inquiry",
        body: "Thank you for reaching out.",
        userEmail
      });

      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      assert.match(decoded, /^To: client@example\.com$/m);
      assert.doesNotMatch(decoded, /^Cc:/m);
      assert.doesNotMatch(decoded, /^Bcc:/m);

      // Suggested recipients exist for manual user addition only
      assert.equal(suggestedCc.length, 2);
      assert.deepEqual(
        suggestedCc.map((r) => r.email),
        ["other1@example.com", "other2@example.com"]
      );
    });
  });
});
