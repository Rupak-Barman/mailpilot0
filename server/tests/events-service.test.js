import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  publishUserEvent,
  subscribeUserEvents,
  getSubscriberCount
} from "../services/events.service.js";

describe("BATCH 5.5: Event Bus (events.service.js)", () => {
  it("publishes events to subscribed user and isolates by userId", () => {
    const userA = "user_alpha_" + Date.now();
    const userB = "user_beta_" + Date.now();

    const receivedA = [];
    const receivedB = [];

    const unsubA = subscribeUserEvents(userA, (evt) => receivedA.push(evt));
    const unsubB = subscribeUserEvents(userB, (evt) => receivedB.push(evt));

    assert.equal(getSubscriberCount(userA), 1);
    assert.equal(getSubscriberCount(userB), 1);

    // Publish to userA
    publishUserEvent(userA, {
      type: "emailAction.changed",
      threadId: "thread123",
      at: 1000
    });

    assert.equal(receivedA.length, 1);
    assert.equal(receivedA[0].type, "emailAction.changed");
    assert.equal(receivedA[0].threadId, "thread123");
    assert.equal(receivedA[0].at, 1000);
    // User B should not receive User A's event
    assert.equal(receivedB.length, 0);

    // Publish to userB
    publishUserEvent(userB, {
      type: "sync.changed",
      at: 2000
    });

    assert.equal(receivedB.length, 1);
    assert.equal(receivedB[0].type, "sync.changed");
    assert.equal(receivedA.length, 1);

    // Cleanup / unsubscribe
    unsubA();
    unsubB();

    assert.equal(getSubscriberCount(userA), 0);
    assert.equal(getSubscriberCount(userB), 0);

    // Publishing after unsubscribe should not deliver
    publishUserEvent(userA, { type: "analytics.changed" });
    assert.equal(receivedA.length, 1);
  });

  it("handles multiple subscribers for the same user and cleans up individually", () => {
    const user = "multi_user_" + Date.now();

    let count1 = 0;
    let count2 = 0;

    const unsub1 = subscribeUserEvents(user, () => { count1++; });
    const unsub2 = subscribeUserEvents(user, () => { count2++; });

    assert.equal(getSubscriberCount(user), 2);

    publishUserEvent(user, { type: "emailAction.changed" });
    assert.equal(count1, 1);
    assert.equal(count2, 1);

    // Clean up first subscriber
    unsub1();
    assert.equal(getSubscriberCount(user), 1);

    publishUserEvent(user, { type: "emailAction.changed" });
    assert.equal(count1, 1);
    assert.equal(count2, 2);

    // Clean up second subscriber
    unsub2();
    assert.equal(getSubscriberCount(user), 0);
  });
});

