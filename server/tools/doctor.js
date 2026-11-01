#!/usr/bin/env node
// tools/doctor.js
import net from "node:net";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { sanitizeMongoUri } from "../config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables directly from server/.env without triggering side-effects
const serverDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverDir, ".env"), override: false });

const isPlaceholder = (val) => {
  if (!val || typeof val !== "string") return true;
  const lower = val.trim().toLowerCase();
  return (
    lower === "" ||
    lower.includes("your_google_client_id_here") ||
    lower.includes("your_google_client_secret_here")
  );
};

const checkPortFree = (port, host = "127.0.0.1") => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ free: false, error: "Port already in use" });
      } else {
        resolve({ free: true, error: null });
      }
    });
    server.once("listening", () => {
      server.close(() => resolve({ free: true, error: null }));
    });
    server.listen(port, host);
  });
};

const checkGmailOrder = async (order = "verbatim") => {
  const prevOrder = dns.getDefaultResultOrder ? dns.getDefaultResultOrder() : "verbatim";
  try {
    if (dns.setDefaultResultOrder) {
      dns.setDefaultResultOrder(order);
    }
    const res = await fetch("https://gmail.googleapis.com", {
      method: "HEAD",
      signal: AbortSignal.timeout(3000)
    });
    return { ok: true, status: res.status };
  } catch (err) {
    const code = err.code || err.cause?.code || err.name || err.message;
    return { ok: false, error: code };
  } finally {
    if (dns.setDefaultResultOrder) {
      dns.setDefaultResultOrder(prevOrder);
    }
  }
};

const checkNodeVersion = () => {
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major >= 20) {
    return {
      check: "Node.js Version",
      status: "PASS",
      details: `v${nodeVersion} (meets requirement >= 20.0.0)`
    };
  }
  return {
    check: "Node.js Version",
    status: "FAIL",
    details: `v${nodeVersion} is outdated. Please upgrade to Node 20+ LTS.`
  };
};

const checkMongoReachability = async () => {
  const rawMongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/mailpilot";
  const displayMongoUri = sanitizeMongoUri ? sanitizeMongoUri(rawMongoUri) : rawMongoUri;

  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Connection timed out after 5000ms")), 5000);
    });

    const connectPromise = mongoose.connect(rawMongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });

    await Promise.race([connectPromise, timeoutPromise]);
    clearTimeout(timer);
    await mongoose.disconnect().catch(() => {});

    return {
      check: "MongoDB Reachability",
      status: "PASS",
      details: `Connected to ${displayMongoUri}`
    };
  } catch {
    clearTimeout(timer);
    return {
      check: "MongoDB Reachability",
      status: "FAIL",
      details: `Cannot connect to ${displayMongoUri}. Hint: run 'npm run db:up'`
    };
  }
};

const checkOllamaModels = async () => {
  const ollamaUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const llmModel = process.env.OLLAMA_LLM_MODEL || "qwen2.5:7b";
  const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "embeddinggemma-2:270m";

  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      const available = (data.models || []).map((m) => m.name || m.model || "");

      const modelExists = (target) => {
        if (!target) return true;
        const targetWithLatest = target.includes(":") ? target : `${target}:latest`;
        return available.some((name) => {
          const nameWithLatest = name.includes(":") ? name : `${name}:latest`;
          return (
            name === target ||
            nameWithLatest === targetWithLatest ||
            name.startsWith(`${target}:`)
          );
        });
      };

      const missing = [];
      if (!modelExists(llmModel)) missing.push(llmModel);
      if (!modelExists(embeddingModel)) missing.push(embeddingModel);

      if (missing.length === 0) {
        return {
          check: "Ollama & AI Models",
          status: "PASS",
          details: `Reachable at ${ollamaUrl}; installed: ${llmModel}, ${embeddingModel}`
        };
      }
      const pullCmds = missing.map((m) => `ollama pull ${m}`).join("; ");
      return {
        check: "Ollama & AI Models",
        status: "FAIL",
        details: `Missing model(s): ${missing.join(", ")}. Run: ${pullCmds}`
      };
    }
    return {
      check: "Ollama & AI Models",
      status: "FAIL",
      details: `Ollama returned HTTP ${res.status}. Run: ollama pull ${llmModel}; ollama pull ${embeddingModel}`
    };
  } catch {
    return {
      check: "Ollama & AI Models",
      status: "FAIL",
      details: `Not running at ${ollamaUrl}. Required: 'ollama pull ${llmModel}', 'ollama pull ${embeddingModel}'`
    };
  }
};

const checkGoogleCredentials = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const hasClientId = !isPlaceholder(clientId);
  const hasClientSecret = !isPlaceholder(clientSecret);

  if (hasClientId && hasClientSecret) {
    return {
      check: "Google OAuth Credentials",
      status: "PASS",
      details: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured"
    };
  }
  const missing = [];
  if (!hasClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!hasClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  return {
    check: "Google OAuth Credentials",
    status: "FAIL",
    details: `Missing credentials in server/.env: ${missing.join(", ")}`
  };
};

const checkRedirectUri = () => {
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const redirectUri = `${baseUrl}/auth/google/callback`;
  return {
    check: "OAuth Redirect URI",
    status: "PASS",
    details: `Register in Google Cloud Console: ${redirectUri}`
  };
};

const checkPorts = async () => {
  const port3000 = parseInt(process.env.PORT, 10) || 3000;
  const port5173 = 5173;

  const [p3000Res, p5173Res] = await Promise.all([
    checkPortFree(port3000),
    checkPortFree(port5173)
  ]);

  if (p3000Res.free && p5173Res.free) {
    return {
      check: "Port Availability",
      status: "PASS",
      details: `Ports ${port3000} (Server) and ${port5173} (Frontend) are free`
    };
  }
  const busy = [];
  if (!p3000Res.free) busy.push(`${port3000} (Server)`);
  if (!p5173Res.free) busy.push(`${port5173} (Frontend)`);
  return {
    check: "Port Availability",
    status: "WARN",
    details: `Port(s) in use: ${busy.join(", ")} (is Mailpilot already running?)`
  };
};

const checkNetworkDns = async () => {
  const [defaultRes, ipv4Res] = await Promise.all([
    checkGmailOrder("verbatim"),
    checkGmailOrder("ipv4first")
  ]);

  if (ipv4Res.ok && defaultRes.ok) {
    return {
      check: "Gmail API (IPv4/IPv6)",
      status: "PASS",
      details: "Both IPv4 and default DNS order connect to gmail.googleapis.com"
    };
  }
  if (ipv4Res.ok && !defaultRes.ok) {
    return {
      check: "Gmail API (IPv4/IPv6)",
      status: "WARN",
      details: `IPv4 works, but default order failed (${defaultRes.error}). App PREFER_IPV4=true protects connections.`
    };
  }
  if (!ipv4Res.ok && defaultRes.ok) {
    return {
      check: "Gmail API (IPv4/IPv6)",
      status: "PASS",
      details: "Default DNS connects successfully"
    };
  }
  return {
    check: "Gmail API (IPv4/IPv6)",
    status: "WARN",
    details: `Unable to reach gmail.googleapis.com (IPv4: ${ipv4Res.error}; Default: ${defaultRes.error})`
  };
};

export async function runDoctor({ exitOnError = true, logger = console } = {}) {
  // Execute checks in parallel with hard timeouts
  const [
    nodeRes,
    mongoRes,
    ollamaRes,
    googleRes,
    redirectRes,
    portsRes,
    networkRes
  ] = await Promise.all([
    Promise.resolve(checkNodeVersion()),
    checkMongoReachability(),
    checkOllamaModels(),
    Promise.resolve(checkGoogleCredentials()),
    Promise.resolve(checkRedirectUri()),
    checkPorts(),
    checkNetworkDns()
  ]);

  const results = [
    nodeRes,
    mongoRes,
    ollamaRes,
    googleRes,
    redirectRes,
    portsRes,
    networkRes
  ];

  // Print Formatted Output Table
  logger.log("\n==================================================================================");
  logger.log("                     Mailpilot System Doctor (Diagnostics)                        ");
  logger.log("==================================================================================");

  const colWidths = { check: 26, status: 8, details: 46 };
  logger.log(
    "Check".padEnd(colWidths.check) +
    "Status".padEnd(colWidths.status) +
    "Details"
  );
  logger.log("-".repeat(82));

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.status === "PASS") passCount++;
    else if (r.status === "WARN") warnCount++;
    else if (r.status === "FAIL") failCount++;

    const statusTag = `[${r.status}]`.padEnd(colWidths.status);
    logger.log(`${r.check.padEnd(colWidths.check)}${statusTag}${r.details}`);
  }

  logger.log("=".repeat(82));
  logger.log(`Summary: ${passCount} Passed, ${warnCount} Warnings, ${failCount} Failed\n`);

  if (failCount > 0) {
    logger.log("Result: DOCTOR FAILED. Resolve the [FAIL] items above before starting Mailpilot.\n");
    if (exitOnError) process.exit(1);
    return false;
  }

  logger.log("Result: DOCTOR PASSED. Environment is ready for Mailpilot.\n");
  if (exitOnError) process.exit(0);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDoctor();
}
