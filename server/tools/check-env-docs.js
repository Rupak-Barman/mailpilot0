import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directories
export const SERVER_DIR = path.resolve(__dirname, "..");
export const ROOT_DIR = path.resolve(SERVER_DIR, "..");
export const FRONTEND_DIR = path.resolve(ROOT_DIR, "frontend");

export const SERVER_ENV_EXAMPLE = path.join(SERVER_DIR, ".env.example");
export const FRONTEND_ENV_EXAMPLE = path.join(FRONTEND_DIR, ".env.example");

// System and internal test harness environment variables that should not be in .env.example
export const IGNORED_SERVER_VARS = new Set([
  "PATH",
  "SystemRoot",
  "DOTENV_CONFIG_PATH",
  "SKIP_ENV_VALIDATION"
]);

/**
 * Recursively scan directory for files matching extension.
 */
export function walkFiles(dir, extensions = [".js", ".jsx"], ignoreDirs = ["node_modules", ".git", "dist", "tests"]) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoreDirs.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, extensions, ignoreDirs));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Extract process.env variables from JavaScript code string.
 */
export function extractProcessEnvVars(code) {
  const vars = new Set();
  // Match process.env.VAR_NAME or process.env?.VAR_NAME
  const dotRegex = /process\.env(?:\.|\?\.)([A-Z0-9_]+)/g;
  let match;
  while ((match = dotRegex.exec(code)) !== null) {
    vars.add(match[1]);
  }
  // Match process.env['VAR_NAME'] or process.env["VAR_NAME"]
  const bracketRegex = /process\.env\[['"]([A-Z0-9_]+)['"]\]/g;
  while ((match = bracketRegex.exec(code)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

/**
 * Extract import.meta.env variables from JavaScript/JSX code string.
 */
export function extractImportMetaEnvVars(code) {
  const vars = new Set();
  const regex = /import\.meta\.env(?:\.|\?\.)([A-Za-z0-9_]+)/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    vars.add(match[1]);
  }
  const bracketRegex = /import\.meta\.env\[['"]([A-Za-z0-9_]+)['"]\]/g;
  while ((match = bracketRegex.exec(code)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

/**
 * Parse an .env.example file into variable names.
 * Matches lines with KEY=... (ignoring comments and blanks).
 */
export function parseEnvExample(content) {
  const vars = new Set();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      vars.add(match[1]);
    }
  }
  return Array.from(vars);
}

/**
 * Scan server codebase for used process.env variables.
 */
export function scanServerEnvVars(serverDir = SERVER_DIR) {
  const files = walkFiles(serverDir, [".js"], ["node_modules", ".git", "dist", "tests"]);
  const found = new Set();

  for (const file of files) {
    // Skip this checker tool itself so regexes do not self-match
    if (path.basename(file) === "check-env-docs.js") continue;
    const content = fs.readFileSync(file, "utf8");
    for (const v of extractProcessEnvVars(content)) {
      if (!IGNORED_SERVER_VARS.has(v)) {
        found.add(v);
      }
    }
  }

  return Array.from(found).sort();
}

/**
 * Scan frontend codebase for used import.meta.env variables.
 */
export function scanFrontendEnvVars(frontendSrcDir = path.join(FRONTEND_DIR, "src")) {
  const files = walkFiles(frontendSrcDir, [".js", ".jsx"], ["node_modules", ".git", "dist"]);
  const found = new Set();

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const v of extractImportMetaEnvVars(content)) {
      found.add(v);
    }
  }

  return Array.from(found).sort();
}

/**
 * Perform verification between code and example files.
 */
export function verifyEnvDocs() {
  const errors = [];

  // 1. Check Server
  if (!fs.existsSync(SERVER_ENV_EXAMPLE)) {
    errors.push(`Missing server env example file: ${SERVER_ENV_EXAMPLE}`);
  } else {
    const serverExampleContent = fs.readFileSync(SERVER_ENV_EXAMPLE, "utf8");
    const serverDocumentedVars = parseEnvExample(serverExampleContent);
    const serverUsedVars = scanServerEnvVars();

    const documentedSet = new Set(serverDocumentedVars);
    const usedSet = new Set(serverUsedVars);

    const missingInExample = serverUsedVars.filter((v) => !documentedSet.has(v));
    const unusedInExample = serverDocumentedVars.filter((v) => !usedSet.has(v));

    if (missingInExample.length > 0) {
      errors.push(
        `Server variables used in code but missing from server/.env.example:\n` +
        missingInExample.map((v) => `  - ${v}`).join("\n")
      );
    }

    if (unusedInExample.length > 0) {
      errors.push(
        `Server variables in server/.env.example not read by any server code:\n` +
        unusedInExample.map((v) => `  - ${v}`).join("\n")
      );
    }
  }

  // 2. Check Frontend
  if (!fs.existsSync(FRONTEND_ENV_EXAMPLE)) {
    errors.push(`Missing frontend env example file: ${FRONTEND_ENV_EXAMPLE}`);
  } else {
    const frontendExampleContent = fs.readFileSync(FRONTEND_ENV_EXAMPLE, "utf8");
    const frontendDocumentedVars = parseEnvExample(frontendExampleContent);
    const frontendUsedVars = scanFrontendEnvVars();

    const documentedSet = new Set(frontendDocumentedVars);
    const usedSet = new Set(frontendUsedVars);

    const missingInExample = frontendUsedVars.filter((v) => !documentedSet.has(v));
    const unusedInExample = frontendDocumentedVars.filter((v) => !usedSet.has(v));

    if (missingInExample.length > 0) {
      errors.push(
        `Frontend variables used in code but missing from frontend/.env.example:\n` +
        missingInExample.map((v) => `  - ${v}`).join("\n")
      );
    }

    if (unusedInExample.length > 0) {
      errors.push(
        `Frontend variables in frontend/.env.example not read by frontend/src code:\n` +
        unusedInExample.map((v) => `  - ${v}`).join("\n")
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * CLI Runner.
 */
export function run() {
  console.log("Checking environment variable documentation sync...");
  const result = verifyEnvDocs();

  if (!result.valid) {
    console.error("\n[check:env] FAILED: Environment documentation mismatch detected!\n");
    for (const err of result.errors) {
      console.error(err + "\n");
    }
    process.exit(1);
  }

  console.log("[check:env] SUCCESS: All server and frontend environment variables match .env.example files.");
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}

