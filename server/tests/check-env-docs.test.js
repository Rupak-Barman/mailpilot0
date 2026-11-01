import test from "node:test";
import assert from "node:assert/strict";
import {
  extractProcessEnvVars,
  extractImportMetaEnvVars,
  parseEnvExample,
  verifyEnvDocs
} from "../tools/check-env-docs.js";

test("extractProcessEnvVars parses dot and bracket notation correctly", () => {
  const sampleCode = `
    const host = process.env.HOST || "127.0.0.1";
    const port = process.env?.PORT || 3000;
    const db = process.env['MONGO_URI'];
    const secret = process.env["JWT_SECRET"];
    // Repeated access
    const hostAgain = process.env.HOST;
  `;

  const vars = extractProcessEnvVars(sampleCode).sort();
  assert.deepEqual(vars, ["HOST", "JWT_SECRET", "MONGO_URI", "PORT"]);
});

test("extractImportMetaEnvVars parses Vite environment variables", () => {
  const sampleCode = `
    const apiUrl = import.meta.env.VITE_API_URL;
    const optionalUrl = import.meta.env?.VITE_BACKEND_URL;
    const bracketUrl = import.meta.env['VITE_CUSTOM_KEY'];
  `;

  const vars = extractImportMetaEnvVars(sampleCode).sort();
  assert.deepEqual(vars, ["VITE_API_URL", "VITE_BACKEND_URL", "VITE_CUSTOM_KEY"]);
});

test("parseEnvExample correctly extracts variable names, ignoring comments and blanks", () => {
  const sampleEnv = `
    # Section Header
    # Purpose: Something
    FOO=bar
    BAZ=
    QUX = spaced_value

    # Another comment
    ANOTHER_VAR="test"
  `;

  const vars = parseEnvExample(sampleEnv).sort();
  assert.deepEqual(vars, ["ANOTHER_VAR", "BAZ", "FOO", "QUX"]);
});

test("verifyEnvDocs passes on current project codebase", () => {
  const result = verifyEnvDocs();
  assert.equal(result.valid, true, `Expected valid env docs, got errors: ${result.errors.join("; ")}`);
  assert.equal(result.errors.length, 0);
});
