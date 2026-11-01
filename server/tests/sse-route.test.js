import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleEventsStream } from "../routes/events.routes.js";
import { publishUserEvent, getSubscriberCount } from "../services/events.service.js";

describe("BATCH 5.5: SSE Route (events.routes.js)", () => {
  it("sets correct SSE headers, streams events, and cleans up on close", async () => {
    const userId = "sse_user_" + Date.now();

    const headers = {};
    const chunks = [];
    let flushedHeaders = false;

    // Mock Express Request
    const req = new EventEmitter();
    req.user = { id: userId };

    // Mock Express Response
    const res = new EventEmitter();
    res.setHeader = (key, val) => {
      headers[key] = val;
    };
    res.flushHeaders = () => {
      flushedHeaders = true;
    };
    res.write = (chunk) => {
      chunks.push(chunk);
    };
    res.flush = () => {};

    // Call the SSE handler
    handleEventsStream(req, res);

    // Verify headers
    assert.equal(headers["Content-Type"], "text/event-stream");
    assert.equal(headers["Cache-Control"], "no-cache");
    assert.equal(headers["Connection"], "keep-alive");
    assert.equal(headers["X-Accel-Buffering"], "no");
    assert.equal(flushedHeaders, true);

    // Initial handshake comment should be sent
    assert.ok(chunks.some((c) => c.includes(": connected")));

    // Verify subscriber was registered
    assert.equal(getSubscriberCount(userId), 1);

    // Publish an event to this user
    publishUserEvent(userId, {
      type: "emailAction.changed",
      threadId: "thread_abc_123",
      at: 1700000000000
    });

    // Check that event data was written to response
    const eventChunk = chunks.find((c) => c.startsWith("data: "));
    assert.ok(eventChunk, "Should write data: event chunk to response");
    const parsed = JSON.parse(eventChunk.replace("data: ", "").trim());
    assert.equal(parsed.type, "emailAction.changed");
    assert.equal(parsed.threadId, "thread_abc_123");
    assert.equal(parsed.at, 1700000000000);

    // Simulate client closing connection
    req.emit("close");

    // Verify cleanup: subscriber count drops to 0
    assert.equal(getSubscriberCount(userId), 0);
  });
});
