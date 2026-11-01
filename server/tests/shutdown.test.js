// tests/shutdown.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { initiateShutdown, _resetShutdownState } from "../services/shutdown.service.js";

test("Graceful Shutdown Sequence", async (t) => {
  t.beforeEach(() => {
    _resetShutdownState();
  });

  await t.test("executes shutdown steps in the strict order: cron -> sse -> waitInFlight -> server -> db -> exit", async () => {
    const executionOrder = [];

    const mockStopCron = () => {
      executionOrder.push("stopCron");
    };

    const mockCloseSSE = () => {
      executionOrder.push("closeSSE");
    };

    const mockWaitInFlight = async () => {
      executionOrder.push("waitInFlight");
    };

    const mockServer = {
      close: (cb) => {
        executionOrder.push("closeServer");
        cb();
      }
    };

    const mockCloseDB = async () => {
      executionOrder.push("closeDB");
    };

    let exitCodeCalled = null;
    const mockExit = (code) => {
      executionOrder.push("exit");
      exitCodeCalled = code;
    };

    const dummyLogger = {
      log: () => {},
      warn: () => {},
      error: () => {}
    };

    await initiateShutdown({
      signal: "SIGINT",
      exitCode: 0,
      server: mockServer,
      stopCron: mockStopCron,
      closeSSE: mockCloseSSE,
      waitInFlight: mockWaitInFlight,
      closeDB: mockCloseDB,
      exitFn: mockExit,
      logger: dummyLogger
    });

    assert.deepEqual(executionOrder, [
      "stopCron",
      "closeSSE",
      "waitInFlight",
      "closeServer",
      "closeDB",
      "exit"
    ]);
    assert.equal(exitCodeCalled, 0);
  });

  await t.test("second signal immediately forces exit with code 1", async () => {
    const events = [];
    const mockExit = (code) => {
      events.push(`exit:${code}`);
    };

    const dummyLogger = {
      log: () => {},
      warn: (msg) => { events.push(`warn:${msg}`); },
      error: () => {}
    };

    // First signal initiates shutdown
    let finishInFlight;
    const pendingWait = new Promise((resolve) => {
      finishInFlight = resolve;
    });

    const firstShutdownPromise = initiateShutdown({
      signal: "SIGINT",
      exitCode: 0,
      waitInFlight: () => pendingWait,
      exitFn: mockExit,
      logger: dummyLogger
    });

    // Second signal arrives while first is in-flight
    await initiateShutdown({
      signal: "SIGTERM",
      exitFn: mockExit,
      logger: dummyLogger
    });

    assert.ok(events.includes("exit:1"), "Second signal must force exit with code 1");

    // Clean up first promise
    finishInFlight();
    await firstShutdownPromise;
  });

  await t.test("fake timers simulate 10s timeout when in-flight poll is stuck", async () => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      let waitCalled = false;
      const stuckWaitInFlight = async (timeoutMs) => {
        waitCalled = true;
        // Advance time past timeout
        t.mock.timers.tick(timeoutMs + 100);
      };

      let exitCode = null;
      await initiateShutdown({
        signal: "SIGTERM",
        exitCode: 0,
        waitInFlight: stuckWaitInFlight,
        timeoutMs: 10000,
        exitFn: (code) => { exitCode = code; },
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      assert.equal(waitCalled, true);
      assert.equal(exitCode, 0);
    } finally {
      t.mock.timers.reset();
    }
  });

  await t.test("fatal signal passes non-zero exit code to exitFn", async () => {
    let exitCode = null;
    await initiateShutdown({
      signal: "uncaughtException",
      exitCode: 1,
      exitFn: (code) => { exitCode = code; },
      logger: { log: () => {}, warn: () => {}, error: () => {} }
    });

    assert.equal(exitCode, 1);
  });
});
