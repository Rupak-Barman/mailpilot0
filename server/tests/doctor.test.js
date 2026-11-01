// tests/doctor.test.js
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { runDoctor } from "../tools/doctor.js";

test("Mailpilot System Doctor", async (t) => {
  await t.test("runDoctor returns a boolean and does not throw", async () => {
    // Mock mongoose.connect to avoid waiting for 5s network timeout in unit tests
    t.mock.method(mongoose, "connect", async () => {
      throw new Error("Simulated connection failure for unit test");
    });

    const logs = [];
    const testLogger = {
      log: (msg) => logs.push(msg),
      warn: (msg) => logs.push(msg),
      error: (msg) => logs.push(msg)
    };

    const passed = await runDoctor({ exitOnError: false, logger: testLogger });
    assert.equal(typeof passed, "boolean");

    const fullOutput = logs.join("\n");
    assert.ok(fullOutput.includes("Mailpilot System Doctor (Diagnostics)"));
    assert.ok(fullOutput.includes("Node.js Version"));
    assert.ok(fullOutput.includes("MongoDB Reachability"));
    assert.ok(fullOutput.includes("Ollama & AI Models"));
    assert.ok(fullOutput.includes("Google OAuth Credentials"));
    assert.ok(fullOutput.includes("OAuth Redirect URI"));
    assert.ok(fullOutput.includes("Port Availability"));
    assert.ok(fullOutput.includes("Gmail API (IPv4/IPv6)"));

    // Verify secrets are never logged
    if (process.env.GOOGLE_CLIENT_SECRET) {
      assert.equal(
        fullOutput.includes(process.env.GOOGLE_CLIENT_SECRET),
        false,
        "Doctor must never print GOOGLE_CLIENT_SECRET"
      );
    }
  });
});
