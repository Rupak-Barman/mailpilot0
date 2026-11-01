// tests/ai-engine-batch3.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import Analytics from "../models/Analytics.js";

import {
  extractSenderFirstName,
  buildGreeting,
  buildSignOff,
  stripGreetingsAndSignOffs,
  validateGeneratedBody
} from "../services/aiValidation.js";

import {
  analyzeEmailAI,
  AITransientError,
  AIPermanentError,
  isTransientAIError
} from "../services/aiEngine.js";

import { setSearchKnowledgeMock } from "../services/vectorStore.service.js";
import { processThreadGroup } from "../jobs/poll.job.js";
import { generateRagDistanceReport } from "../tools/rag-distance-report.js";

describe("BATCH 3: AI Engine, Grounding & Validation", () => {
  const originalFetch = global.fetch;
  const originalProcessedEmailFindOne = ProcessedEmail.findOne;
  const originalProcessedEmailCreate = ProcessedEmail.create;
  const originalEmailActionFindOne = EmailAction.findOne;
  const originalEmailActionCreate = EmailAction.create;
  const originalAnalyticsFindOne = Analytics.findOne;
  const originalAnalyticsCreate = Analytics.create;

  afterEach(() => {
    global.fetch = originalFetch;
    setSearchKnowledgeMock(null);
    ProcessedEmail.findOne = originalProcessedEmailFindOne;
    ProcessedEmail.create = originalProcessedEmailCreate;
    EmailAction.findOne = originalEmailActionFindOne;
    EmailAction.create = originalEmailActionCreate;
    Analytics.findOne = originalAnalyticsFindOne;
    Analytics.create = originalAnalyticsCreate;
  });

  describe("1. Greeting & Sign-off code injection", () => {
    it("extractSenderFirstName correctly parses display names and handles edge cases", () => {
      assert.equal(extractSenderFirstName("Alice Smith <alice@example.com>"), "Alice");
      assert.equal(extractSenderFirstName('"Robert Paulson" <bob@test.com>'), "Robert");
      assert.equal(extractSenderFirstName("Dr. Marcus Brody <mbrody@univ.edu>"), "Marcus");
      assert.equal(extractSenderFirstName("Mrs. Sarah Connor <sconnor@cyberdyne.com>"), "Sarah");
      assert.equal(extractSenderFirstName("David <david@acme.com>"), "David");
      // Fallbacks when name is unknown or missing
      assert.equal(extractSenderFirstName("<alice@example.com>"), null);
      assert.equal(extractSenderFirstName("alice.smith@example.com"), null);
      assert.equal(extractSenderFirstName(""), null);
      assert.equal(extractSenderFirstName(null), null);
    });

    it("buildGreeting constructs formal, friendly, or fallback greetings", () => {
      // Friendly (default)
      assert.equal(buildGreeting({ from: "Alice Smith <alice@example.com>", tone: "friendly" }), "Hi Alice,");
      assert.equal(buildGreeting({ from: "Alice Smith <alice@example.com>", tone: "casual" }), "Hi Alice,");
      // Formal
      assert.equal(buildGreeting({ from: "Alice Smith <alice@example.com>", tone: "formal" }), "Dear Alice,");
      // Fallback when name cannot be parsed
      assert.equal(buildGreeting({ from: "<unknown@example.com>", tone: "friendly" }), "Hello,");
      assert.equal(buildGreeting({ from: "<unknown@example.com>", tone: "formal" }), "Hello,");
      assert.equal(buildGreeting({ from: "", tone: "formal" }), "Hello,");
    });

    it("buildSignOff constructs closing with profile name", () => {
      assert.equal(
        buildSignOff({ userName: "Alex Taylor", tone: "friendly" }),
        "Best regards,\nAlex Taylor"
      );
      assert.equal(
        buildSignOff({ userName: "Alex Taylor", tone: "formal" }),
        "Sincerely,\nAlex Taylor"
      );
      assert.equal(buildSignOff({ userName: "", tone: "friendly" }), "Best regards,");
      assert.equal(buildSignOff({ userName: null, tone: "formal" }), "Sincerely,");
    });

    it("stripGreetingsAndSignOffs removes accidental model-written greetings and sign-offs", () => {
      const raw = `Hi Alice,\n\nWe have reviewed your request and are processing the refund.\n\nBest regards,\nOllama Bot`;
      const cleaned = stripGreetingsAndSignOffs(raw);
      assert.equal(cleaned, "We have reviewed your request and are processing the refund.");
    });
  });

  describe("2. Validation rules (validateGeneratedBody)", () => {
    const defaultContext = {
      emailText: "Hi, I placed order #12345 yesterday. Can I return it for the $49 refund?",
      retrievedKnowledge: "[returns.txt]\nReturns are accepted within 30 days for a full refund of $49. Contact https://help.acme.com for status.",
      userProfile: "Alex Taylor, Support Lead at Acme Corp",
      persona: "Friendly support persona"
    };

    it("rule 1: rejects empty body or body under 5 words", () => {
      const emptyRes = validateGeneratedBody({ body: "   ", ...defaultContext });
      assert.equal(emptyRes.valid, false);
      assert.equal(emptyRes.reason, "invalid_output");

      const shortRes = validateGeneratedBody({ body: "Thank you so much.", ...defaultContext }); // 4 words
      assert.equal(shortRes.valid, false);
      assert.equal(shortRes.reason, "invalid_output");

      const validRes = validateGeneratedBody({ body: "Thank you for contacting us today regarding this.", ...defaultContext }); // 7 words
      assert.equal(validRes.valid, true);
    });

    it("rule 2: rejects placeholder tokens", () => {
      const placeholders = [
        "Hello [Name], your item has been dispatched.",
        "Please send your details to [Your Name] soon.",
        "Thank you for contacting [Your Company] support.",
        "Your order {name} is confirmed.",
        "TODO: finish writing response.",
        "The estimated delivery is <insert date here>."
      ];

      for (const ph of placeholders) {
        const res = validateGeneratedBody({ body: ph, ...defaultContext });
        assert.equal(res.valid, false, `Should reject placeholder in: "${ph}"`);
        assert.equal(res.reason, "invalid_output");
      }
    });

    it("rule 3: rejects markdown remnants (**, ##, triple backtick)", () => {
      const boldRes = validateGeneratedBody({
        body: "Here is your **important** update regarding the shipment.",
        ...defaultContext
      });
      assert.equal(boldRes.valid, false);
      assert.equal(boldRes.reason, "invalid_output");

      const headerRes = validateGeneratedBody({
        body: "## Shipment Status\nYour order has been shipped.",
        ...defaultContext
      });
      assert.equal(headerRes.valid, false);

      const codeRes = validateGeneratedBody({
        body: "Here is the code ```test``` for tracking.",
        ...defaultContext
      });
      assert.equal(codeRes.valid, false);
    });

    it("rule 4: rejects raw JSON leftovers", () => {
      const jsonRes = validateGeneratedBody({
        body: '{"can_answer": true, "body": "Thank you for reaching out to us."}',
        ...defaultContext
      });
      assert.equal(jsonRes.valid, false);
      assert.equal(jsonRes.reason, "invalid_output");
    });

    it("rule 5: rejects invented specifics (prices, URLs, emails, phone numbers, numbers)", () => {
      // Invented price not in context ($999 vs $49 in context)
      const fakePriceRes = validateGeneratedBody({
        body: "Your order refund will be $999 for the inconvenience.",
        ...defaultContext
      });
      assert.equal(fakePriceRes.valid, false);
      assert.match(fakePriceRes.error, /Invented price/i);

      // Known price from context ($49 is in knowledge)
      const validPriceRes = validateGeneratedBody({
        body: "We will gladly process your full refund of $49 promptly.",
        ...defaultContext
      });
      assert.equal(validPriceRes.valid, true);

      // Invented URL not in context
      const fakeUrlRes = validateGeneratedBody({
        body: "You can download your invoice at https://scam-site.org/invoice.pdf now.",
        ...defaultContext
      });
      assert.equal(fakeUrlRes.valid, false);
      assert.match(fakeUrlRes.error, /Invented URL/i);

      // Known URL in context
      const validUrlRes = validateGeneratedBody({
        body: "You can check status at https://help.acme.com anytime.",
        ...defaultContext
      });
      assert.equal(validUrlRes.valid, true);

      // Invented phone number
      const fakePhoneRes = validateGeneratedBody({
        body: "Please call us immediately at 555-432-1099 to confirm.",
        ...defaultContext
      });
      assert.equal(fakePhoneRes.valid, false);
      assert.match(fakePhoneRes.error, /Invented phone/i);

      // Invented email address
      const fakeEmailRes = validateGeneratedBody({
        body: "Please send your receipts to unlisted@externalcompany.com today.",
        ...defaultContext
      });
      assert.equal(fakeEmailRes.valid, false);
      assert.match(fakeEmailRes.error, /Invented email/i);

      // Proper nouns are NEVER flagged
      const properNounRes = validateGeneratedBody({
        body: "Marcus and Sarah at Cyberdyne will review this by Friday afternoon.",
        ...defaultContext
      });
      assert.equal(properNounRes.valid, true);
    });
  });

  describe("3. Grounding: strict pass, strict fail, and flexible", () => {
    const mockUser = {
      _id: "user_test_rag_1",
      name: "Alex Taylor",
      profileDescription: "Support Lead at Acme"
    };

    it("strict pass: best chunk distance <= RAG_MAX_DISTANCE generates draft with injected greeting & sign-off", async () => {
      // Mock Ollama chat and embedding APIs
      global.fetch = async (url, options) => {
        const urlStr = String(url || "");

        if (urlStr.includes("/api/embed")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              embeddings: [new Array(768).fill(0.05)]
            })
          };
        }

        const body = JSON.parse(options.body || "{}");
        const prompt = body.messages?.[0]?.content || "";

        if (prompt.includes("Classify the incoming email")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              message: {
                content: JSON.stringify({
                  label: "Returns",
                  summary: "Customer inquiring about return policy."
                })
              }
            })
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                can_answer: true,
                body: "We accept returns within 30 days with original receipt for a full refund."
              })
            }
          })
        };
      };

      // Mock vector search returning chunk with distance 0.25 (< RAG_MAX_DISTANCE 0.5)
      setSearchKnowledgeMock(async () => [
        {
          _distance: 0.25,
          text: "We accept returns within 30 days with original receipt for a full refund.",
          fileName: "returns.txt",
          documentId: "doc_return_policy",
          chunkIndex: 0
        }
      ]);

      // Set RAG_MAX_DISTANCE to 0.5
      process.env.RAG_MAX_DISTANCE = "0.5";

      const labels = [
        {
          id: "label_ret",
          name: "Returns",
          tone: "friendly",
          action: { type: "draft" },
          grounding: "strict",
          knowledgeDocumentIds: ["doc_return_policy"]
        }
      ];

      const res = await analyzeEmailAI({
        userId: "user_test_rag_1",
        userProfileName: "Alex Taylor",
        subject: "How do I return?",
        from: "Bob Builder <bob@builder.com>",
        snippet: "Can I return this?",
        bodyText: "What is your return policy?",
        userProfileDescription: "Acme Support",
        labels,
        personas: []
      });

      assert.equal(res.label, "Returns");
      assert.equal(res.action, "draft");
      assert.equal(res.can_answer, true);
      assert.equal(res.outcome, "drafted");
      // Greeting and sign-off injected in code:
      assert.ok(res.body.startsWith("Hi Bob,\n\n"), "Must start with injected greeting 'Hi Bob,'");
      assert.ok(res.body.includes("Best regards,\nAlex Taylor"), "Must end with injected sign-off 'Best regards,\nAlex Taylor'");
      assert.ok(!res.body.includes("[Name]"), "Must not contain placeholders");
    });

    it("strict fail: best chunk distance > RAG_MAX_DISTANCE sets needs_manual and no_knowledge_match", async () => {
      process.env.RAG_MAX_DISTANCE = "0.5";

      global.fetch = async (url, options) => {
        const urlStr = String(url || "");
        if (urlStr.includes("/api/embed")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              embeddings: [new Array(768).fill(0.05)]
            })
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                label: "Returns",
                summary: "Return inquiry."
              })
            }
          })
        };
      };

      // Mock vector search returning chunks with distance 0.85 (> RAG_MAX_DISTANCE 0.5)
      setSearchKnowledgeMock(async () => [
        {
          _distance: 0.85,
          text: "Unrelated chunk.",
          fileName: "other.txt",
          documentId: "doc_returns",
          chunkIndex: 0
        }
      ]);

      const labels = [
        {
          id: "label_ret",
          name: "Returns",
          tone: "friendly",
          action: { type: "reply" },
          grounding: "strict",
          knowledgeDocumentIds: ["doc_returns"]
        }
      ];

      const res = await analyzeEmailAI({
        userId: "user_test_rag_1",
        userProfileName: "Alex Taylor",
        subject: "Return query",
        from: "Alice <alice@test.com>",
        snippet: "Need return",
        bodyText: "How to return?",
        labels,
        personas: []
      });

      assert.equal(res.can_answer, false);
      assert.equal(res.outcome, "needs_manual");
      assert.equal(res.failureReason, "no_knowledge_match");
      assert.equal(res.body, "");
    });

    it("flexible mode: no RAG required; allows polite acknowledgement", async () => {
      process.env.RAG_MAX_DISTANCE = "0.5";

      global.fetch = async (url, options) => {
        const body = JSON.parse(options.body || "{}");
        const prompt = body.messages?.[0]?.content || "";

        if (prompt.includes("Classify the incoming email")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              message: {
                content: JSON.stringify({
                  label: "General",
                  summary: "General inquiry."
                })
              }
            })
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                can_answer: true,
                body: "Thank you for reaching out to our team. We have received your note and will follow up shortly."
              })
            }
          })
        };
      };

      const labels = [
        {
          id: "label_gen",
          name: "General",
          tone: "formal",
          action: { type: "draft" },
          grounding: "flexible",
          knowledgeDocumentIds: []
        }
      ];

      const res = await analyzeEmailAI({
        userId: "user_test_rag_1",
        userProfileName: "Alex Taylor",
        subject: "Hello there",
        from: "Dr. Henry Jones <hjones@university.edu>",
        snippet: "Checking in",
        bodyText: "Checking in on the project status.",
        labels,
        personas: []
      });

      assert.equal(res.can_answer, true);
      assert.equal(res.action, "draft");
      assert.equal(res.outcome, "drafted");
      assert.ok(res.body.startsWith("Dear Henry,\n\n"), "Formal greeting used for formal tone");
      assert.ok(res.body.includes("Sincerely,\nAlex Taylor"), "Formal sign-off used for formal tone");
    });
  });

  describe("4. poll.job.js & 'no Gmail call is made on needs_manual'", () => {
    it("no Gmail draft or reply is created, email stays unread, category label is applied, and turn is recorded as needs_manual", async () => {
      const user = {
        _id: "user_nm_1",
        name: "Alex Taylor",
        email: "support@acme.com",
        profileDescription: "Support",
        labels: [
          {
            id: "label_billing_id",
            name: "Billing",
            tone: "friendly",
            enabled: true,
            action: { type: "reply" },
            grounding: "strict",
            knowledgeDocumentIds: ["doc_billing_unknown"]
          }
        ]
      };

      let draftCreateCalled = false;
      let messageSendCalled = false;
      let labelModifyCalled = false;
      let removeUnreadCalled = false;
      let savedProcessedEmail = null;
      let savedEmailAction = null;

      const mockGmail = {
        users: {
          messages: {
            get: async () => ({
              data: {
                id: "msg_nm_100",
                threadId: "thread_nm_100",
                internalDate: String(Date.now()),
                snippet: "Why was I charged $500?",
                payload: {
                  headers: [
                    { name: "From", value: "Clara Oswald <clara@tardis.org>" },
                    { name: "Subject", value: "Unrecognized fee" },
                    { name: "Message-ID", value: "<clara100@tardis.org>" }
                  ],
                  body: {
                    data: Buffer.from("I do not understand this charge.").toString("base64")
                  }
                }
              }
            }),
            modify: async ({ requestBody }) => {
              if (requestBody.addLabelIds?.includes("label_billing_id")) {
                labelModifyCalled = true;
              }
              if (requestBody.removeLabelIds?.includes("UNREAD")) {
                removeUnreadCalled = true;
              }
              return { data: {} };
            },
            send: async () => {
              messageSendCalled = true;
              return { data: { id: "sent_should_not_happen" } };
            }
          },
          drafts: {
            create: async () => {
              draftCreateCalled = true;
              return { data: { id: "draft_should_not_happen" } };
            }
          }
        }
      };

      // Mock Ollama to simulate classification and strict RAG failure
      global.fetch = async (url, options) => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                label: "Billing",
                summary: "Customer asking about unfamiliar charge."
              })
            }
          })
        };
      };

      // Set RAG_MAX_DISTANCE extremely low so strict fails
      process.env.RAG_MAX_DISTANCE = "0.0001";

      ProcessedEmail.findOne = async () => null;
      ProcessedEmail.create = async (doc) => {
        savedProcessedEmail = { ...doc, save: async function () { return this; } };
        return savedProcessedEmail;
      };

      EmailAction.findOne = async () => null;
      EmailAction.create = async (doc) => {
        savedEmailAction = doc;
        return doc;
      };

      const result = await processThreadGroup({
        user,
        threadId: "thread_nm_100",
        items: [{ id: "msg_nm_100" }],
        gmail: mockGmail
      });

      // Verify outcomes:
      assert.equal(result.outcome, "needs_manual");
      assert.equal(result.reason, "no_knowledge_match");

      // Verify NO Gmail calls for draft or send:
      assert.equal(draftCreateCalled, false, "Must NOT create a Gmail draft on needs_manual");
      assert.equal(messageSendCalled, false, "Must NOT send a Gmail message on needs_manual");

      // Verify Category label WAS applied:
      assert.equal(labelModifyCalled, true, "Category label MUST still be applied to message in Gmail");

      // Verify email STAYS UNREAD:
      assert.equal(removeUnreadCalled, false, "Must NOT remove UNREAD label on needs_manual");

      // Verify ProcessedEmail record:
      assert.ok(savedProcessedEmail, "ProcessedEmail claim doc must be saved");
      assert.equal(savedProcessedEmail.outcome, "needs_manual");
      assert.equal(savedProcessedEmail.failureReason, "no_knowledge_match");
      assert.equal(savedProcessedEmail.markAsRead, false);

      // Verify EmailAction record:
      assert.ok(savedEmailAction, "EmailAction doc must be created");
      assert.equal(savedEmailAction.status, "failed");
      assert.equal(savedEmailAction.turns?.[0]?.outcome, "needs_manual");
      assert.equal(savedEmailAction.turns?.[0]?.failureReason, "no_knowledge_match");
      assert.equal(savedEmailAction.turns?.[0]?.outgoing, undefined);
    });
  });

  describe("5. Calibration tool: rag-distance-report", () => {
    it("generateRagDistanceReport summarizes min/max and suggests threshold without modifying anything", async () => {
      global.fetch = async (url) => {
        const urlStr = String(url || "");
        if (urlStr.includes("/api/embed")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              embeddings: [new Array(768).fill(0.01)]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      setSearchKnowledgeMock(async () => [
        {
          _distance: 0.28,
          text: "Returns are accepted within 30 days.",
          fileName: "faq.txt",
          chunkIndex: 0
        }
      ]);

      // Mock User in DB
      const originalUserFind = User.find;
      const originalUserFindById = User.findById;

      User.find = () => ({
        lean: async () => [
          {
            _id: "user_calib_1",
            email: "admin@test.com",
            labels: [
              {
                id: "label_support_calib",
                name: "CustomerSupport",
                knowledgeDocumentIds: ["doc_calib_faq"]
              }
            ]
          }
        ]
      });

      const dataset = [
        { subject: "Return question", body: "How do I return item?", expected: "match" },
        { subject: "Return timeline", body: "30 days window?", expected: "match" },
        { subject: "Football scores", body: "Who won the match yesterday?", expected: "no_match" }
      ];

      const logs = [];
      const report = await generateRagDistanceReport({
        dataset,
        labelIdOrName: "CustomerSupport",
        logFn: (msg) => logs.push(msg)
      });

      assert.equal(report.label, "CustomerSupport");
      assert.ok(report.matchStats);
      assert.ok(report.noMatchStats);
      assert.equal(typeof report.suggestedThreshold, "number");
      assert.equal(report.results.length, 3);

      User.find = originalUserFind;
      User.findById = originalUserFindById;
    });
  });

  describe("6. Typed errors: Ollama down or timeout is retryable, not needs_manual", () => {
    it("throws AITransientError on connection failure, and poll.job marks status='retry' instead of needs_manual", async () => {
      // Simulate Ollama connection failure (fetch throws ECONNREFUSED)
      global.fetch = async () => {
        const err = new TypeError("fetch failed");
        err.cause = { code: "ECONNREFUSED" };
        throw err;
      };

      const labels = [
        {
          id: "label_sup",
          name: "Support",
          action: { type: "reply" },
          grounding: "flexible"
        }
      ];

      const validUserId = "507f191e810c19729de860ea";

      // 1. Verify analyzeEmailAI throws AITransientError
      await assert.rejects(
        async () => {
          await analyzeEmailAI({
            userId: validUserId,
            subject: "Help",
            from: "Alice <alice@test.com>",
            labels
          });
        },
        (err) => {
          assert.ok(err instanceof AITransientError, "Must throw AITransientError");
          assert.equal(err.isTransient, true);
          return true;
        }
      );

      // 2. Verify processThreadGroup sets claimDoc.status = 'retry' and not 'needs_manual'
      let savedClaim = null;
      ProcessedEmail.findOne = async () => null;
      ProcessedEmail.create = async (doc) => {
        savedClaim = { ...doc, save: async function () { return this; } };
        return savedClaim;
      };
      EmailAction.findOne = async () => null;
      EmailAction.create = async (doc) => doc;

      const user = {
        _id: validUserId,
        email: "support@test.com",
        labels
      };

      const mockGmail = {
        users: {
          messages: {
            get: async () => ({
              data: {
                id: "msg_down_1",
                threadId: "thread_down_1",
                internalDate: String(Date.now()),
                snippet: "Need help",
                payload: {
                  headers: [
                    { name: "From", value: "Alice <alice@test.com>" },
                    { name: "Subject", value: "Help" }
                  ],
                  body: { data: Buffer.from("System down").toString("base64") }
                }
              }
            })
          }
        }
      };

      const result = await processThreadGroup({
        user,
        threadId: "thread_down_1",
        items: [{ id: "msg_down_1" }],
        gmail: mockGmail
      });

      assert.equal(result.processed, false);
      assert.equal(result.outcome, "retry");
      assert.notEqual(result.outcome, "needs_manual");
      assert.ok(savedClaim, "Claim doc must be saved");
      assert.equal(savedClaim.status, "retry");
      assert.notEqual(savedClaim.outcome, "needs_manual");
      assert.ok(savedClaim.nextRetryAt instanceof Date, "Must schedule backoff retry timestamp");
    });
  });
});
