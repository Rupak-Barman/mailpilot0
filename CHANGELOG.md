# Changelog

All notable changes to Mailpilot are documented in this file, organized chronologically by architectural implementation batch.

---

## [Batch 9] – Local Install Experience, Root Scripts & Process Hygiene

### Added
- **Root `package.json`**: Private package with Node >= 20 engine constraint orchestrating server and frontend workflows via `concurrently`.
- **Automated Idempotent Setup (`npm run setup`)**: Cross-platform script `scripts/setup.js` creating `server/.env` and `frontend/.env` without overwriting existing configurations, executing `npm ci`/`npm install` appropriately, and outputting onboarding checklists.
- **System Doctor Diagnostic CLI (`npm run doctor`)**: Implemented `server/tools/doctor.js` running non-destructive checks for Node version, MongoDB reachability (5s timeout), Ollama reachability and required models with exact pull commands, Google OAuth credentials, redirect URI registration, port availability (3000 & 5173), and Gmail API DNS resolution (verbatim vs ipv4first). Outputs structured PASS/WARN/FAIL status table without leaking secrets.
- **Graceful Shutdown**: Added signal handling (SIGINT, SIGTERM) in `server/services/shutdown.service.js` that halts the cron scheduler, terminates active SSE streams, drains in-flight email processing (up to 10s with claim-first deduplication safety), closes the MongoDB connection, and supports immediate forced termination on repeat signals. Added unhandled rejection and uncaught exception handlers that log a single line and exit non-zero after resource cleanup.
- **Startup Banner & Database Timeout**: Added clean terminal banner showing version, URLs, models, and sync state. Added 5s connection timeout to MongoDB with actionable hints (`npm run db:up`).
- **Production Startup Coordinator (`npm start`)**: Created `scripts/start.js` verifying the frontend production bundle before launching Vite preview and the API server concurrently.
- **Docker Compose (`docker-compose.yml`)**: MongoDB container (`mongo:7`) bound strictly to `127.0.0.1:27017` with named volume `mongo_data` and healthcheck. Root commands `npm run db:up` and `npm run db:down`.
- **Repo Hygiene & Tooling**: Added `.gitattributes` (`* text=auto`), `.editorconfig`, `.nvmrc` (Node 22), `start-mailpilot.bat`, and `start-mailpilot.sh`.
- **GitHub Actions CI (`.github/workflows/ci.yml`)**: Automated CI pipeline running tests, environment checks (`check:env`), and frontend production build on Node 22 without requiring live MongoDB.

---

## [Batch 8] – Documentation, Calibration & Environment Tooling

### Added
- **Environment Documentation Checker (`check:env`)**: Created `server/tools/check-env-docs.js` and npm script `npm --prefix server run check:env`. Scans server and frontend codebases for environment variable usage and validates 100% parity against `.env.example` templates.
- **Unit Test Suite for Env Parsing**: Added `server/tests/check-env-docs.test.js` covering dot notation, bracket notation, and example file parsing.
- **Outcome Backfill Tool**: Created `server/tools/backfill-processed-outcome.js` and test suite `server/tests/backfill-outcome.test.js` to migrate legacy `ProcessedEmail` records to the new outcome schema.
- **Comprehensive Documentation**: Complete `README.md` rewrite covering architecture, synchronization lifecycle, OAuth setup, troubleshooting, calibration, data management, and development guidelines.

### Changed
- Replaced legacy `sendora_token` reference in `frontend/src/hooks/useRealtime.js` with `mailpilot_token`.
- Fully documented all 21 server environment variables and frontend `VITE_API_URL` with purpose, default, example, and required status.

---

## [Batch 7] – Security Hardening

### Added
- **One-Time OAuth Code Exchange**: Replaced URL-based JWT transmission with ephemeral one-time authorization codes (`/auth/exchange`), eliminating token leakage in browser histories or server access logs.
- **Encryption at Rest**: Implemented AES-256-GCM encryption for Google OAuth refresh tokens using `TOKEN_ENCRYPTION_KEY`.
- **Fail-Fast Environment Validation**: Added startup validation in `server/config/env.js` that checks mandatory credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MONGO_URI`) before initializing services.
- **HTTP Security Headers & Rate Limiting**: Added `helmet` security headers and `express-rate-limit` across API routes.
- **CORS Hardening**: Scoped allowed origins to `CLIENT_URL` and `BASE_URL`.

### Upgrade Notes
- Ensure `TOKEN_ENCRYPTION_KEY` and `JWT_SECRET` are set in `server/.env` (the server auto-generates them on first launch if missing).

---

## [Batch 6] – MIME & Formatting

### Added
- **RFC 5322 MIME Builder**: Enforced 76-character line wrapping for base64-encoded messages to prevent mail transfer agent corruption.
- **Threading Headers in Drafts**: Injected `In-Reply-To` and `References` headers when creating or updating Gmail drafts.
- **Markdown Stripping**: Cleaned email output by removing Markdown artifacts (bold, italics, headers) while preserving arithmetic expressions, emails, and snake_case identifiers.

---

## [Batch 5.9] – Routing Rules Redesign & Always-CC Removal

### Added
- **Routing Rules Drawer**: Replaced inline rule forms with a dedicated 5-section side drawer (Rule Details, Action Selection, Writing Style, Grounding & Documents, Automation & Status).
- **Inline Quick Edits**: Allowed instant updates to rule action (None / Draft / Reply) and active status directly from the rules table.
- **Rule Deletion Confirmation**: Added explicit modal dialog explaining Gmail label removal behavior.
- **Database Cleanup Tool**: Created `server/tools/remove-always-cc.js` to strip legacy CC properties from MongoDB.

### Removed
- **Automatic CC / BCC**: Completely removed `alwaysCc` on labels and `defaultCc` on user settings to eliminate accidental data exposure. All CC/BCC is now explicitly added by the user.

---

## [Batch 5.8] – AI-Assisted Drafting

### Added
- **AI Assist Panel**: Added interactive panel in draft editor to generate or revise drafts with custom instructions and quick prompt chips.
- **Knowledge Base Toggle**: Choose whether to ground on-demand AI revisions using uploaded documents or rely solely on conversational context.
- **Version History & Undo**: Track up to 10 draft revisions with one-click restore.
- **Save-First Sync-Second Architecture**: Preserves user draft edits in MongoDB immediately before initiating Google API calls, preventing loss of unsaved text on network errors.

---

## [Batch 5.7] – CC & BCC Recipient Management

### Added
- **Recipient Chips Input**: Multi-address input field with validation, comma/space auto-splitting, and paste parsing.
- **Reply-All Assistant**: Extracted additional recipients on incoming threads into `suggestedCc` with a one-click "Add reply-all recipients" helper button.
- **Header Injection Defense**: Stripped CR/LF characters from recipient headers to prevent mail header injection.

---

## [Batch 5.6] – Gmail Reconcile

### Added
- **Bi-Directional State Reconcile**: Background sync detects edits made in Gmail webmail, drafts sent externally, and deleted drafts without causing 404 errors.
- **Timeline Badges**: Visual indicators showing "Edited in Gmail", "Sent from Gmail", and "Deleted in Gmail".

---

## [Batch 5.5] – Realtime Live Updates

### Added
- **Server-Sent Events (SSE)**: Realtime event bus publishing updates for emails, sync status, and analytics.
- **Topbar Live Indicator**: Real-time status indicator showing "Live" or "Reconnecting...".
- **Debounced Cache Invalidation**: Batched query invalidation to avoid UI thrashing during rapid poll cycles.

---

## [Batch 5] – Analytics Source of Truth

### Added
- **ProcessedEmail Grounding**: Shifted analytics queries to `ProcessedEmail` collection for verified event auditing.
- **Client-Side Timezone Boundaries**: Ensured date filter calculations align with the user's local timezone.
- **Expanded Metrics**: Added counts for failed emails, manual resolutions, and AI-assisted responses.

---

## [Batch 4] – UI & Loading States

### Added
- **Skeleton Rows**: Smooth table loading states replacing jarring full-page spinners.
- **URL Filter Persistence**: Retained search and filter parameters across page refreshes.
- **Truthful Status Badges**: Unified status badges derived strictly from the latest conversation turn.

---

## [Batch 3] – AI Engine & Grounding

### Added
- **Qwen 2.5 7B Model**: Upgraded local LLM to `qwen2.5:7b` for superior instruction following.
- **Distance Cutoff (`RAG_MAX_DISTANCE`)**: Added L2 distance threshold to LanceDB vector search.
- **Grounding Modes**: Added *Strict* (require document match) and *Flexible* modes.
- **Failed Queue**: Added "Failed" tab ("Needs your reply") for ungrounded or failed items.

---

## [Batch 2 & 2.5] – Conversation Model & Thread Grouping

### Added
- **Turn-Centric Schema**: Replaced flat email action rows with thread-centric conversation turns (`turns[]`).
- **Follow-up Grouping**: Automatically grouped follow-up emails by RFC Message-ID, `In-Reply-To`, `References`, and sender time windows.
- **Timeline View**: Visual chronological history of incoming and outgoing turns within each thread.
- **Migration Scripts**: Provided `server/tools/migrate-email-actions.js` and `server/tools/backfill-summaries.js`.

---

## [Batch 1] – Sync Engine

### Added
- **History Checkpointing**: Switched Gmail synchronization to `historyId` checkpoints.
- **Primary Category Filter**: Focused sync exclusively on `category:primary`.
- **Loop Protection & Daily Cap**: Added safety guards against automated reply loops.
- **Ollama Startup Health Check**: Validated local model availability upon server start.

