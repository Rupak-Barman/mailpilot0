import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DebouncedInvalidator } from "../../frontend/src/utils/realtimeInvalidator.js";

describe("BATCH 5.5: Debounce Logic for Realtime Invalidations", () => {
  it("coalesces bursts within 500ms into a single invalidation flush", async () => {
    const invalidatedKeys = [];
    const mockQueryClient = {
      invalidateQueries: ({ queryKey }) => {
        invalidatedKeys.push(queryKey);
      }
    };

    let flushCallCount = 0;
    const flushedBatches = [];

    const invalidator = new DebouncedInvalidator(mockQueryClient, {
      debounceMs: 50, // fast timer for testing
      onFlush: (types) => {
        flushCallCount++;
        flushedBatches.push(types);
      }
    });

    // Fire a rapid burst of 5 events
    invalidator.schedule("emailAction.changed");
    invalidator.schedule("emailAction.changed");
    invalidator.schedule("analytics.changed");
    invalidator.schedule("emailAction.changed");
    invalidator.schedule("sync.changed");

    // Before timer elapses, no flushes have happened
    assert.equal(flushCallCount, 0);
    assert.equal(invalidatedKeys.length, 0);

    // Wait for debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, 80));

    // After timer, exactly 1 flush happened
    assert.equal(flushCallCount, 1);
    assert.equal(flushedBatches[0].length, 3);
    assert.ok(flushedBatches[0].includes("emailAction.changed"));
    assert.ok(flushedBatches[0].includes("analytics.changed"));
    assert.ok(flushedBatches[0].includes("sync.changed"));

    // Verify correct TanStack query keys were invalidated
    const keysFlat = invalidatedKeys.map((k) => k[0]);
    assert.ok(keysFlat.includes("email-actions"));
    assert.ok(keysFlat.includes("email-action-summary"));
    assert.ok(keysFlat.includes("email-action"));
    assert.ok(keysFlat.includes("analytics"));
    assert.ok(keysFlat.includes("sync-status"));
  });

  it("cancel prevents scheduled flush from executing", async () => {
    let flushCalled = false;
    const invalidator = new DebouncedInvalidator(null, {
      debounceMs: 50,
      onFlush: () => {
        flushCalled = true;
      }
    });

    invalidator.schedule("emailAction.changed");
    invalidator.cancel();

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(flushCalled, false);
  });
});

