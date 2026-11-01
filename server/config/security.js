import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { CLIENT_URL } from "./env.js";

/**
 * Compute allowed origins for CORS:
 * CLIENT_URL plus its localhost/127.0.0.1 twin on the same port.
 * No wildcard.
 */
export function getAllowedCorsOrigins(clientUrl = process.env.CLIENT_URL || CLIENT_URL || "http://localhost:5173") {
  try {
    const parsed = new URL(clientUrl);
    const origins = new Set([parsed.origin]);
    const portSuffix = parsed.port ? `:${parsed.port}` : "";

    if (parsed.hostname === "localhost") {
      origins.add(`${parsed.protocol}//127.0.0.1${portSuffix}`);
    } else if (parsed.hostname === "127.0.0.1") {
      origins.add(`${parsed.protocol}//localhost${portSuffix}`);
    }

    return Array.from(origins);
  } catch {
    return [clientUrl];
  }
}

/**
 * Configure CORS middleware.
 * Allows CLIENT_URL and twin on the same port, supports credentials and preflight for Authorization.
 */
export function createCorsMiddleware() {
  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, same-origin, mobile, internal)
      if (!origin) {
        return callback(null, true);
      }
      const allowed = getAllowedCorsOrigins();
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  });
}

/**
 * Helmet middleware configured for JSON API.
 */
export function createHelmetMiddleware() {
  return helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
}

/**
 * General rate limiter: ~300 requests/minute for API routes.
 * The UI polls and uses refetch-on-event.
 * Exempts SSE /events and /health.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => {
    const p = req.path || "";
    return p.startsWith("/events") || p.startsWith("/api/events") || p === "/health";
  }
});

/**
 * Strict rate limiter: 15 requests per 15 minutes on /auth/* routes.
 * Does not block normal login (callback + exchange).
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication requests, please try again later." },
  skip: (req) => {
    return req.path === "/logout";
  }
});

/**
 * Sanitize untrusted input objects at the Express boundary.
 * Recursively strips keys starting with "$" (query operator injection)
 * or containing "." (path traversal / mongo subdocument injection).
 * Imposes a recursion depth limit (default 10) to prevent ReDoS / call-stack overflow.
 */
export function sanitizeObject(target, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) return undefined;
  if (!target || typeof target !== "object") return target;

  // Preserve Date, RegExp, Buffer instances
  if (target instanceof Date || target instanceof RegExp || Buffer.isBuffer(target)) {
    return target;
  }

  if (Array.isArray(target)) {
    return target
      .map((item) => sanitizeObject(item, maxDepth, currentDepth + 1))
      .filter((item) => item !== undefined);
  }

  const clean = {};
  for (const [key, value] of Object.entries(target)) {
    // Drop keys starting with "$" or containing "."
    if (!key.startsWith("$") && !key.includes(".")) {
      const sanitizedVal = sanitizeObject(value, maxDepth, currentDepth + 1);
      if (sanitizedVal !== undefined) {
        clean[key] = sanitizedVal;
      }
    }
  }
  return clean;
}

/**
 * Express middleware to sanitize req.body, req.query, and req.params at the HTTP boundary.
 */
export function sanitizeRequestMiddleware(req, _res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }

  if (req.query && typeof req.query === "object") {
    try {
      const clean = sanitizeObject(req.query);
      for (const k of Object.keys(req.query)) {
        if (!Object.prototype.hasOwnProperty.call(clean, k)) {
          delete req.query[k];
        }
      }
      Object.assign(req.query, clean);
    } catch {}
  }

  if (req.params && typeof req.params === "object") {
    req.params = sanitizeObject(req.params);
  }

  next();
}
