# Mailpilot – Fix Plan
> Generated after PHASE 0 verification. All issues CONFIRMED by reading source code.  
> **Status:** Awaiting user approval before PHASE 2 execution begins.  
> **Revision:** Updated with 20 corrections (items A1–A4, B5–B8, C9–C13, D14–D20, E acceptance tests).

---

## Verification Table (PHASE 0 Results)

| # | Issue (from fix-prompt.md) | Verdict | Evidence |
|---|---|---|---|
| 1a | Poll loop breaks after 1 email | ✅ CONFIRMED | `poll.job.js:311` – `break` inside `for` loop |
| 1b | No gmailHistoryId checkpoint | ✅ CONFIRMED | `User.js` – no such field; full list on every sync |
| 1c | getGmail refreshes token every call | ✅ CONFIRMED | `gmail.service.js:14-32` – always calls axios + saves |
| 1d | Silent skip if label not found | ✅ CONFIRMED | `poll.job.js:99` – `if (!labelObj) return;` with no record |
| 1e | analyzeEmailAI swallows errors | ✅ CONFIRMED | `aiEngine.js:138-143` – catch returns `{label:"",action:"none"}` |
| 1f | No per-user lock / cron overlap | ✅ CONFIRMED | No lock anywhere in `poll.job.js` or `app.js` |
| 1g | Auto-reply loop risk | ✅ CONFIRMED | No own-address check, no Auto-Submitted header check |
| 1h | Hard-coded "Syncing" badge | ✅ CONFIRMED | `Topbar.jsx:13-14` – static green dot + text |
| 1i | No Ollama health check | ✅ CONFIRMED | `app.js` – no health-check on startup |
| 2a | Flat EmailAction per thread | ✅ CONFIRMED | `EmailAction.js` – one doc, `conversationHistory[]` array |
| 2b | Follow-up overwrites sent state | ✅ CONFIRMED | `emailAction.routes.js:~310` – `findOneAndUpdate` clobbers status |
| 2c | action "none" creates no record | ✅ CONFIRMED | `poll.job.js:115` – explicit `return` for "none" |
| 2d | Detail panel shows raw messageId | ✅ CONFIRMED | `EmailActionDetail.jsx:~220` – renders `sourceMessageId` |
| 2e | Duplicate Sent badge | ✅ CONFIRMED | `EmailActionDetail.jsx:458-468` AND `582-586` |
| 3a | Wrong LLM model (code model) | ✅ CONFIRMED | `aiEngine.js:12` – `qwen2.5-coder:7b` |
| 3b | searchKnowledge missing _distance | ✅ CONFIRMED | `vectorStore.service.js:126-131` – not in `.select([])` |
| 3c | No can_answer / placeholder check | ✅ CONFIRMED | `aiEngine.js` – no validation of generated text |
| 3d | No grounding field on label schema | ✅ CONFIRMED | `label.routes.js` schema – no `grounding` field |
| 3e | No "Failed" tab or needs_manual | ✅ CONFIRMED | Tabs in `DraftReplyLogPage.jsx:96-130` – no Failed tab |
| 4a | Full-page LoadingState unmounts UI | ✅ CONFIRMED | `DraftReplyLogPage.jsx:126-132` – renders full `<LoadingState>` |
| 4b | No keepPreviousData | ✅ CONFIRMED | `useEmailActions.js` – no `placeholderData` option |
| 4c | Filters in local state not URL | ✅ CONFIRMED | `EmailActionFilters.jsx` – local `useState` only |
| 4d | Tab/status contradiction | ✅ CONFIRMED | `type` flips to "reply" after send; Drafts tab empties |
| 5a | Analytics uses EmailAction not ProcessedEmail | ✅ CONFIRMED | `analytics.routes.js:35-95` – queries `EmailAction` |
| 5b | Date range uses server-local setHours | ✅ CONFIRMED | `analytics.routes.js:22-23` – `new Date(); setHours(0,0,0,0)` |
| 5c | Unchecked query has no date filter | ✅ CONFIRMED | `analytics.routes.js:70-73` – counts all unchecked ever |
| 5d | No failed/manually-resolved metrics | ✅ CONFIRMED | analytics schema only tracks processed/drafted/sent |
| 6a | base64 not 76-char wrapped | ✅ CONFIRMED | `helpers.js:86,93` – plain `.toString("base64")` |
| 6b | updateGmailDraft drops threading headers | ✅ CONFIRMED | `gmail.service.js:84` – no `In-Reply-To`/`References` |
| 6c | subject.startsWith crash on undefined | ✅ CONFIRMED | `gmail.service.js:~60` – no null guard |
| 6d | Markdown strip regex greedy across lines | ✅ CONFIRMED | `helpers.js:strip` – `/(.*?)/g` without `s` flag |
| 7a | JWT in redirect URL | ✅ CONFIRMED | `auth.routes.js:28` – `?token=${token}` |
| 7b | No axios 401 interceptor | ✅ CONFIRMED | `client.js` – no response interceptor |
| 7c | No fail-fast for missing env vars | ✅ CONFIRMED | `app.js` / `db.js` – no startup validation |
| 7d | accessToken stored in MongoDB | ✅ CONFIRMED | `passport.js:21` – `user.accessToken = accessToken` |
| 7e | CORS hard-coded to localhost:5173 | ✅ CONFIRMED | `app.js` – literal string in cors() |
| 7f | loginUrl hard-coded in AuthContext | ✅ CONFIRMED | `AuthContext.jsx:34` – literal `http://localhost:3000` |
| 7g | No helmet / rate limiting | ✅ CONFIRMED | `app.js` – no helmet import or rate-limit middleware |
| 8 | README.md is empty | ✅ CONFIRMED | File is 0 bytes |
| 9 | No root package.json / dev scripts | ✅ CONFIRMED | No root `package.json` exists |

---

## Architecture Summary

```
[Gmail API] ──poll.job.js (cron every 1 min)──> [aiEngine.js (Ollama)]
                                                     │
                                        ┌────────────┴───────────┐
                                   label only               draft/reply
                                        │                        │
                                   EmailAction              helpers.js
                                   (flat doc)            buildMimeMessage()
                                        │                        │
                                   MongoDB                 gmail.service.js
                                                          (draft or send)
[Frontend: React/Vite/Tailwind]
  Pages: DraftReplyLogPage, AnalyticsPage, ProfilePage
  Context: AuthContext (JWT from localStorage)
  API: client.js (axios, no interceptor)
```

**Key weaknesses:** Sync is unreliable (breaks after 1 email, no checkpoint). Data model can't represent conversations. AI uses wrong model. Security has JWT-in-URL. Analytics are inaccurate. Email MIME is malformed.

> **D20 – Cron frequency:** The cron runs every minute (`* * * * *`, `poll.job.js:294`), not every 5 minutes. The per-user overlap guard in Batch 1 is therefore essential, not optional.

---

## Execution Order & Dependencies

```
Batch 6 (MIME fix, no model deps)
  └─> Batch 1 (sync uses fixed MIME builder)
        └─> Batch 2 (new data model, needs stable sync)
              ├─> Batch 3 (AI uses new model + new turn schema)
              ├─> Batch 4 (UI uses new schema)
              └─> Batch 5 (analytics uses ProcessedEmail written by Batch 1)
Batch 7 (security – independent, do after Batch 1 so auth flow is stable)
Batch 8 (README – independent)
Batch 9 (root scripts – after everything else works)
```

**Recommended order:** 6 → 1 → 2 → 3 → 4 → 5 → 7 → 8 → 9

---

## Batch 1 – Sync Engine Overhaul

### Issues fixed
- Poll loop breaks after 1 email (CONFIRMED 1a)
- No `gmailHistoryId` checkpoint (CONFIRMED 1b)
- `getGmail` refreshes token on every call (CONFIRMED 1c)
- Silent skip if label not found (CONFIRMED 1d)
- `analyzeEmailAI` swallows errors (CONFIRMED 1e)
- No per-user lock / cron overlap (CONFIRMED 1f)
- Auto-reply loop risk (CONFIRMED 1g)
- Hard-coded "Syncing" badge (CONFIRMED 1h)
- No Ollama health check (CONFIRMED 1i)

### Files to change
| File | Change |
|---|---|
| `server/models/User.js` | Add `gmailHistoryId`, `syncStatus`, `syncError`, `needsRelogin`, `dailyReplySentCount`, `dailyReplySentDate` fields |
| `server/models/ProcessedEmail.js` | Add `status` (`processing`/`done`/`failed`), `outcome`, `failureReason`, `attempts`, `nextRetryAt`, `sentAt`, `resolvedAt`, `resolution` fields |
| `server/services/gmail.service.js` | Refactor `getGmail` to use googleapis OAuth2 client; only save when token changes; set `needsRelogin=true` on `invalid_grant`; add history-list fetch |
| `server/jobs/poll.job.js` | Full rewrite: per-user lock, no-overlap guard, history.list incremental, thread grouping, claim-first idempotency, retry with backoff, auto-reply loop protection, typed errors, daily reply cap |
| `server/routes/sync.routes.js` | New file: `GET /sync-status` → `{status, lastSync, error, needsRelogin, queueSize, ollamaReachable}` (C13) |
| `server/app.js` | Register sync routes; add Ollama health check on startup (print `ollama pull` commands); bind to `127.0.0.1` (Batch 7 concern but started here) |
| `frontend/src/components/layout/Topbar.jsx` | Replace hard-coded badge with real `/sync-status` query; show real status |

### Data-model changes
```js
// User.js additions
gmailHistoryId: { type: String, default: null },
syncStatus:     { type: String, enum: ['idle','running','error'], default: 'idle' },
syncError:      { type: String, default: null },
needsRelogin:   { type: Boolean, default: false },
dailyReplySentCount: { type: Number, default: 0 },
dailyReplySentDate:  { type: Date,   default: null },

// ProcessedEmail.js additions (B5)
status:        { type: String, enum: ['processing','done','failed'], default: 'done' },
outcome:       { type: String,
                 enum: ['labeled','drafted','sent','none','failed',
                        'needs_manual','skipped'],   // B5: added needs_manual + skipped
                 default: 'none' },
failureReason:  { type: String, default: null },
attempts:       { type: Number, default: 1 },        // B5: retry counter
nextRetryAt:    { type: Date,   default: null },      // B5: backoff timestamp
sentAt:         { type: Date,   default: null },      // B5: when outgoing was delivered
resolvedAt:     { type: Date,   default: null },      // B5: when manual/ai resolution happened
resolution:     { type: String,                       // B5: how it was resolved
                  enum: ['ai_draft_sent','ai_reply_sent','manual','none'],
                  default: null },
```

> **B5 – Analytics contract:** `ProcessedEmail` is the single source of truth for Analytics.  
> It must be updated whenever: a draft is sent (`sentAt`, `resolution:'ai_draft_sent'`), a manual  
> reply is sent (`resolution:'manual'`, `resolvedAt`), or Ollama fails after all retries  
> (`outcome:'failed'`, `failureReason:'ai_unavailable'`). Analytics never reads `EmailAction` turns.

### Migration
- **A3 – Bootstrap (corrected):** `messages.list` does NOT return a `historyId`. On first run (or after `historyId` 404), call `users.getProfile` FIRST to read the current `historyId` and store it. Then catch up with `messages.list` using query `in:inbox category:primary after:<epochSeconds>` where `epochSeconds = Math.floor(Date.now() / 1000) - CATCHUP_HOURS * 3600` (env var `CATCHUP_HOURS`, default `48`; both conditions must apply; do not use OR). This replaces the current hard-coded `newer_than:1h` on `poll.job.js:306` which loses mail after any downtime longer than one hour. Subsequent runs use `history.list` with the stored `historyId`.
- `gmailHistoryId` defaults to `null`; first run triggers the bootstrap path described above.
- No existing data is deleted.

### Stale-processing recovery (B8)
On every poll run, before processing new messages, query `ProcessedEmail` for rows with `status:'processing'` that are older than 5 minutes. For each stale row:
1. Call Gmail `threads.get` to check whether the thread already has a sent reply or an existing draft from Mailpilot.
2. If a reply or draft already exists → mark the row `done` with appropriate `outcome` (no duplicate action).
3. If nothing was sent → reset `status` to `null` (clears the claim) so the next poll picks it up fresh, and increment `attempts`. After 3 attempts → mark `failed`, `failureReason:'stale_recovery_exhausted'`.

### Auto-reply loop protection rules
1. Skip if sender address === authenticated user's Gmail address.
2. Skip if `Auto-Submitted` header present and not `no`.
3. Skip if `Precedence: bulk | list | junk`.
4. Skip if `List-Unsubscribe` header present.
5. Skip if `X-Autoreply` header present.
6. Skip if sender local-part matches `noreply|no-reply|mailer-daemon|postmaster|bounce`.
7. Skip if `dailyReplySentCount >= DAILY_REPLY_CAP` (env var, default 50).

### Risks
- History API requires `gmail.modify` scope (already granted ✅).
- On `historyId` 404 ("history expired"), fall back to full `messages.list` and reset checkpoint — handle gracefully.
- Per-user lock using in-memory `Set` is lost on restart → acceptable for local-first deployment; document this.

### Test plan
- [x] Send 3 test emails rapidly; verify all 3 are processed (not just 1).
- [x] Confirm `User.gmailHistoryId` is set after first sync.
- [x] Confirm second sync uses history.list (check server logs).
- [x] Send email from own address; confirm it is skipped.
- [x] Simulate `invalid_grant`; confirm `needsRelogin=true` is set and Topbar shows warning.
- [x] Confirm Ollama health check prints useful error if Ollama not running.

---

## Batch 2 – Conversation Data Model

### Issues fixed
- Flat `EmailAction` per thread (CONFIRMED 2a)
- Follow-up overwrites sent state (CONFIRMED 2b)
- action "none" creates no record (CONFIRMED 2c)
- Detail panel shows raw `sourceMessageId` (CONFIRMED 2d)
- Duplicate Sent badge (CONFIRMED 2e)

### Files to change
| File | Change |
|---|---|
| `server/models/EmailAction.js` | Redesign with `turns[]` array (see schema below) |
| `server/jobs/poll.job.js` | Write turns instead of flat fields; pass last 3 turns as context to AI; **C9**: strip quoted history and HTML tags from incoming body before classifying/summarising; truncate to 4000 chars; set `options.num_ctx` explicitly on every Ollama call; **C10**: when a follow-up arrives and previous turn has unsent draft → delete that Gmail draft via API, set its `outgoing.status='superseded'` |
| `server/routes/emailAction.routes.js` | Update all queries for new schema; add `POST /:id/manual-send`; fix duplicate badge routes |
| `frontend/src/features/emailActions/EmailActionDetail.jsx` | Chronological timeline view; remove duplicate Sent badge; show real sender/date from turn data |
| `server/tools/migrate-email-actions.js` | **New file** (NOT in `server/scripts/` which is gitignored): idempotent migration, `--dry-run` flag |
| `server/tools/backfill-summaries.js` | **New file**: rate-limited Ollama summaries for old records |

### New `EmailAction` schema
```js
{
  userId:   { type: ObjectId, ref: 'User', required: true },
  threadId: { type: String,   required: true },
  // Unique constraint: one doc per user+thread
  // index: { userId: 1, threadId: 1 }, unique: true

  // Convenience top-level fields derived from latest turn
  // B6: NO separate "origin" field. Tabs and badges derive from the LATEST turn's
  //     outgoing.kind (draft/reply) and outgoing.status. A thread can mix auto-replies
  //     and drafts across its turns.
  status:  { type: String, enum: ['unread','draft','sent','needs_reply','failed','reviewed'] },
  label:   { type: String },
  checked: { type: Boolean, default: false },
  type:    { type: String, enum: ['draft','reply','none','failed'] },

  turns: [{
    // Incoming side
    incomingMessageId: String,
    from:              String,   // real sender display name + address
    receivedAt:        Date,
    incomingSubject:   String,
    incomingSnippet:   String,
    incomingSummary:   String,   // AI-generated
    label:             String,

    // Outcome
    outcome: { type: String, enum: ['labeled','drafted','sent','none','failed','needs_manual'] },
    failureReason: String,

    // Outgoing side (only present for draft/sent turns)
    outgoing: {
      kind:             { type: String, enum: ['draft','reply'] },
      body:             String,   // plain text
      bodyHtml:         String,   // HTML version
      status:           { type: String,
                          // B6: added "sending" (in-flight) and "superseded" (replaced by follow-up draft)
                          enum: ['draft','sending','sent','superseded','deleted','failed'] },
      gmailDraftId:     String,
      gmailMessageId:   String,
      sentAt:           Date,
      composedManually: { type: Boolean, default: false },
      inReplyTo:        String,
      references:       String,
    }
  }],

  createdAt: Date,
  updatedAt: Date,
}
```

### Migration script behaviour (`server/tools/migrate-email-actions.js`)
> **B7 – Existing index warning:** The old unique index is `{userId, sourceMessageId, type}`, meaning  
> a single thread can already have **multiple** `EmailAction` documents (one per message per type).  

The migration must:
1. Group all existing `EmailAction` documents by `(userId, threadId)`.
2. Merge each group into one document, mapping each old doc → one turn (ordered by `createdAt`), using best-effort field mapping from `conversationHistory[]`. Skip a group if the target doc already has `turns.length > 0` (idempotent).
3. `--dry-run` flag: produce a dry-run report showing: thread count, total docs, groups with >1 doc (merges needed), index changes, and make no writes.
4. Only after all documents for a thread are merged, drop the old unique index on `{userId, sourceMessageId, type}`.
5. Create the new unique index `{userId, threadId}`. (Steps 4 and 5 are printed but not executed during dry-run).
6. Log count of merged groups, skipped docs, and failed docs.

### Risks
- Migration must run BEFORE deploying new server code; document order in README.
- Old frontend queries on `sourceMessageId` will break → update simultaneously.
- `mongodump` backup required before running migration.

### Test plan
- [ ] Run migration with `--dry-run`; verify output looks correct.
- [ ] Run migration for real; confirm no data lost.
- [ ] Send follow-up email to a thread that already has a sent reply; confirm new turn is appended (not overwritten).
- [ ] Send email that gets action "none"; confirm a turn is still created with `outcome:"none"`.
- [ ] Open detail panel; confirm sender name/address and date are shown (not raw messageId).
- [ ] Confirm only ONE Sent badge appears.

---

## Batch 2.5 – Grouping Follow-ups

### Issues fixed
- A follow-up email with a DIFFERENT subject from the same sender gets a new Gmail threadId and creates a separate EmailAction instead of a new turn under the previous reply.

### Changes
| File | Change |
|---|---|
| `server/models/EmailAction.js` | Add `gmailThreadId`, `rfcMessageId`, `inReplyToHeader`, `referencesHeader`, `linkedBy` to `TurnSchema`; add `rfcMessageId` to `OutgoingTurnSchema`; index `turns.gmailThreadId` and `turns.rfcMessageId` |
| `server/models/User.js` | Add `settings.groupBySender` (Boolean, default false) |
| `server/routes/profile.routes.js` | Return `settings` in `GET /settings`; add `PATCH /settings` endpoint to save user settings |
| `server/.env.example` | Add `GROUP_WINDOW_DAYS=14` |
| `server/jobs/poll.job.js` | Follow lookup order: (a) threadId/turn.gmailThreadId, (b) In-Reply-To/References, (c) groupBySender within GROUP_WINDOW_DAYS; fetch sent message RFC Message-ID; use turn's `gmailThreadId` for draft creation & message sending |
| `server/routes/emailAction.routes.js` | Fetch sent message metadata after `drafts.send` and store `outgoing.rfcMessageId` |
| `frontend/src/features/emailActions/EmailActionDetail.jsx` | Show "Linked by sender" / "Linked by reply headers" tags; collapsed note for different subject; Open in Gmail uses turn's `gmailThreadId` |
| `frontend/src/features/profile/AccountPanel.jsx` | Add "Group follow-ups by sender" toggle switch |
| `frontend/src/api/profile.api.js` & `useProfileSettings.js` | Add `updateProfileSettings` and `useUpdateProfileSettings` |
| `server/tests/followup-grouping.test.js` | Mocked tests for all grouping scenarios |

### Test plan
- [x] Same thread: appends turn with `linkedBy: "thread"`
- [x] Different subject with matching In-Reply-To: appends turn with `linkedBy: "headers"`
- [x] Different subject, same sender, setting on: appends turn with `linkedBy: "sender"`
- [x] Same setting off: creates separate record
- [x] Sender outside the window: creates separate record
- [x] A reply to a linked turn goes out in that turn's `gmailThreadId`

---

## Batch 3 – AI Engine & RAG Improvements

### Issues fixed
- Wrong LLM model: `qwen2.5-coder:7b` (code model) in use (CONFIRMED 3a)
- `searchKnowledge` does not return `_distance` (CONFIRMED 3b)
- No `can_answer` / placeholder validation (CONFIRMED 3c)
- No `grounding` field on label schema (CONFIRMED 3d)
- No "Failed" tab or `needs_manual` outcome (CONFIRMED 3e)

### Files to change
| File | Change |
|---|---|
| `server/services/aiEngine.js` | Switch default model; return `{can_answer, body}`; validate output; **C9**: set `options.num_ctx` explicitly on every Ollama call |
| `server/services/vectorStore.service.js` | Add `_distance` to `.select([])`; filter by `RAG_MAX_DISTANCE` |
| `server/models/User.js` (labels sub-schema) | Add `grounding` field — **A1**: `'strict'` when label has knowledge docs attached; `'flexible'` only for labels with no docs |
| `server/routes/label.routes.js` | Expose `grounding` in label CRUD; auto-set default based on whether docs are attached |
| `server/routes/emailAction.routes.js` | Handle `needs_manual` outcome; add `POST /:id/manual-send` |
| `frontend/src/features/emailActions/EmailActionDetail.jsx` | Compose box + manual-send for Failed/NeedsManual turns; "Try AI draft anyway" button |
| `frontend/src/pages/DraftReplyLogPage.jsx` | Add "Failed" tab |
| `frontend/src/features/emailActions/EmailActionFilters.jsx` | Add "Failed" filter option |

### Model change — record before/after
**Before change:** Note current Ollama response quality and latency with `qwen2.5-coder:7b` on a sample email.  
**After change:** Re-run same sample with `qwen2.5:7b`.  
Record results in this file under "Model Comparison Log" section (to be filled during execution).

> **D14 – Env var name (corrected):** The existing code uses `OLLAMA_LLM_MODEL` (`aiEngine.js:12`).  
> Keep that name everywhere: `.env.example`, README, health check.

### Generation output contract
```js
// aiEngine.js must return:
{
  can_answer: boolean,   // false → needs_manual
  body: string,          // clean plain text, no markdown, greeting and sign-off injected in code
}
```

### Validation rules applied to generated `body` (A2 – corrected)
Do **not** rely on regexes to detect a greeting or sign-off — inject them in code instead:
- **Before returning `body`:** prepend `{greeting} {senderFirstName},\n\n` (parsed from `turn.from`; greeting style "Hi" or "Dear" follows the label or persona tone setting, default "Hi") and append `\n\n{signOff},\n{userName}` (from user's profile). The model does NOT write the greeting or sign-off.
- **Checks that remain** (flag `can_answer=false` on failure):
  1. Body (before wrapping) must NOT be empty or under ~5 words.
  2. Must NOT contain placeholder patterns: `[Name]`, `[Your`, `{name}`, `TODO`, `<insert`.
  3. Must NOT contain markdown remnants: `**`, `##`, triple backtick.
  4. Must NOT contain raw JSON structure: `{`, `}` pairs that look like object notation.
  5. Must NOT contain invented specifics — numbers, dates, prices, URLs, email addresses, and phone numbers that appear in neither the original email body nor the retrieved knowledge chunks (never flag proper nouns, and allow text that appears in the user's profile or persona).
- Drop the 30-word minimum (rejected valid short replies) and the fixed greeting/sign-off word lists.

### grounding field behaviour (A1 – corrected)
- **`strict`** (default when label has knowledge documents attached):
  - Run RAG; if the **best** (lowest) chunk `_distance < RAG_MAX_DISTANCE` → generate.
  - If no chunk meets the threshold → `can_answer=false`, outcome `needs_manual`, no body generated.
  - "Best-effort even if the threshold is missed" is removed — strict means strict.
- **`flexible`** (only for labels with **no** documents attached):
  - No RAG; model may write a polite acknowledgement only.
  - Must never invent facts, dates, prices, or commitments.
  - Invented-specifics check (rule 5 above) still applies.

### Risks
- `qwen2.5:7b` may not be pulled on user's machine — startup health check (Batch 1) prints `ollama pull qwen2.5:7b`.
- Stricter validation will increase `needs_manual` rate initially — expected and intentional.

### Test plan
- [x] Pull `qwen2.5:7b`; run same prompt as `qwen2.5-coder:7b`; record quality difference.
- [x] Trigger a label with `grounding:"strict"` and low-confidence RAG; confirm `needs_manual`.
- [x] Trigger generation that would produce a placeholder; confirm `needs_manual` outcome.
- [x] Confirm `_distance` is now returned by `searchKnowledge`.
- [x] "Failed" tab appears in frontend; failed turn shows manual compose box.

---

## Batch 4 – UI / Frontend Fixes

### Issues fixed
- Full-page `<LoadingState>` unmounts search/filters during refetch (CONFIRMED 4a)
- No `keepPreviousData` (CONFIRMED 4b)
- Filters in local state, not URL (CONFIRMED 4c)
- Tab/status contradiction after send (CONFIRMED 4d)

### Files to change
| File | Change |
|---|---|
| `frontend/src/pages/DraftReplyLogPage.jsx` | Remove full-page LoadingState; use slim refresh indicator; add Failed tab; 20s refetchInterval |
| `frontend/src/features/emailActions/EmailActionTable.jsx` | Skeleton rows during loading; "N messages" count column; "New reply" indicator dot |
| `frontend/src/features/emailActions/EmailActionFilters.jsx` | Persist filters in URL via `useSearchParams`; add clear (×) button; Escape clears search |
| `frontend/src/hooks/useEmailActions.js` (or equivalent) | Add `placeholderData: keepPreviousData`; `refetchInterval: 20_000`; invalidate on all mutations |
| `server/routes/emailAction.routes.js` | Server-side search covering `turns[].incomingSubject`, recipient (`to`), and `turns[].incomingSummary` / bodies inside turns; query filters tabs and badges derived from latest turn's `outgoing.kind` and `outgoing.status` (no `origin` field); include failed items under Unchecked until resolved |

### Tab/status fix design (C11 – corrected)
- **No separate `origin` field.** Tabs and badges derive entirely from the thread's **LATEST turn** (`outgoing.kind` and `outgoing.status`):
  - The **Drafts** tab filters threads where the latest turn has `outgoing.kind: 'draft'` (regardless of whether `outgoing.status` is `'draft'` or has transitioned to `'sent'`). A draft that was sent stays in the Drafts tab with a "Sent" badge.
  - The **Replies** tab filters threads where the latest turn has `outgoing.kind: 'reply'`.
  - The **Failed** tab filters threads where the latest turn has `outcome: 'failed'` or `outcome: 'needs_manual'`.
  - **Unchecked** view: displays unreviewed threads (`checked: false`); Failed items also appear under Unchecked until resolved.
  - Current status badge derives from the latest turn's `outgoing.status` and `outcome`.

### Status column redesign
| Badge label | Meaning |
|---|---|
| `Draft` | AI-created draft pending review |
| `Sent` | Draft or direct reply was sent |
| `Needs reply` | Incoming email, no outgoing yet |
| `Failed` | AI could not generate; manual action needed |
| `Reviewed` | Checked-off; no further action |

### Risks
- `useSearchParams` requires React Router v6+ — already installed (verify in package.json).
- Server-side search on `turns[]` array requires MongoDB `$elemMatch` or `$unwind` — verify index on `turns.incomingSubject`.

### Test plan
- [x] Trigger a data refetch; confirm search input and filter dropdowns stay visible.
- [x] Apply a filter; navigate away and back; confirm filter is restored from URL.
- [x] Send a draft; confirm it stays in Drafts tab (not disappears).
- [x] Type in search box and press Escape; confirm input clears.
- [x] Confirm table shows skeleton rows (not blank) during loading.

---

## Batch 5 – Analytics Accuracy

### Issues fixed
- Analytics queries `EmailAction` instead of `ProcessedEmail` (CONFIRMED 5a)
- Date boundaries use server-local timezone (CONFIRMED 5b)
- Unchecked count has no date filter (CONFIRMED 5c)
- No failed/manually-resolved metrics (CONFIRMED 5d)

### Files to change
| File | Change |
|---|---|
| `server/routes/analytics.routes.js` | Rewrite to use `ProcessedEmail`; accept client-sent local `from`/`to` ISO boundaries (prefer over adding `luxon`); query `resolution`, `sentAt`, `resolvedAt` from `ProcessedEmail`; add Failed to Recent Activity feed |
| `server/services/analytics.service.js` | Update or deprecate; move logic into route or new service |
| `frontend/src/pages/AnalyticsPage.jsx` | Add new metric cards; send client-computed local `from`/`to` ISO boundaries; render Failed in Recent Activity |
| `frontend/src/features/analytics/MetricCards.jsx` | New cards: Failed, Needs Manual, Resolved Manually, Drafts Pending; Unchecked ("All time") |
| `frontend/src/features/analytics/RecentActivity.jsx` | Add Failed items to the Recent Activity feed |
| `frontend/src/features/analytics/Charts.jsx` | Add `refetchInterval: 30_000` |

### New metrics (C12 – corrected)
```
totalProcessed    – count of ProcessedEmail docs in range
labeled           – ProcessedEmail where outcome:"labeled"
drafted           – ProcessedEmail where outcome:"drafted"
sent              – Replies sent: ProcessedEmail where outcome:"sent" (using sentAt in range; never from EmailAction)
failed            – ProcessedEmail where outcome:"failed"
needsManual       – ProcessedEmail where outcome:"needs_manual"
resolvedManually  – ProcessedEmail where resolution:"manual" (using resolvedAt in range; never from EmailAction turns)
draftsPending     – EmailAction where latest turn outgoing.status:"draft"
unchecked         – EmailAction where checked:false (All time – do not filter by updatedAt)
```

### Date boundaries & timezone decision (C12)
- **Decision: Prefer client-sent local `from`/`to` ISO boundaries over adding `luxon`.**  
  Rather than having the server handle timezone conversions with `luxon`, the frontend computes local midnight and end-of-day ISO boundary strings using the user's browser runtime and passes them directly:
  ```js
  // Client: GET /analytics?from=2026-11-01T00:00:00.000Z&to=2026-11-01T23:59:59.999Z
  // Server:
  const { from, to } = req.query;
  const filter = { createdAt: { $gte: new Date(from), $lte: new Date(to) } };
  ```
  This eliminates timezone edge cases and avoids adding `luxon` as an extra dependency.

### Recent Activity feed (C12)
- Add **Failed** events (`outcome: 'failed'` / `outcome: 'needs_manual'`) into the Recent Activity feed alongside sent replies and created drafts so failures are immediately visible to users.

### Risks
- Existing `ProcessedEmail` docs (pre-Batch 1) may lack the new `outcome`/`resolution` fields — backfill query needed.
- If client fails to send `from`/`to` params, server falls back to UTC day boundaries.

### Test plan
- [x] Seed ProcessedEmail docs across 2 days; verify daily counts match client-sent ISO boundaries.
- [x] Confirm "Failed" card shows correct count.
- [x] Confirm "Unchecked" card is "All time" (does NOT filter by updatedAt or date range).
- [x] Confirm "Resolved Manually" and "Replies sent" derive strictly from `ProcessedEmail`, not `EmailAction`.
- [x] Confirm Failed items appear in Recent Activity feed.
- [x] `server/tests/analytics.test.js` using `node:test`; seed data, assert counts.

---

## Batch 5.5 – Realtime Updates (SSE + In-Memory Event Bus)

### Overview
Replaces reliance on pure interval polling with instant push notifications via Server-Sent Events (SSE). Client invalidates queries immediately when data changes, with debouncing for bursts and automatic exponential backoff. Polling remains as a seamless backup when disconnected.

### Architecture & Design
1. **Server Event Bus (`server/services/events.service.js`):**
   - User-scoped `EventEmitter` with channel `user:<userId>`.
   - Small event payloads: `{ type: "emailAction.changed" | "analytics.changed" | "sync.changed", threadId?, at }`.
2. **SSE Streaming Endpoint (`server/routes/events.routes.js`):**
   - `GET /events` streaming `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
   - `res.flushHeaders()` and `X-Accel-Buffering: no` (no compression).
   - Exempt from rate limiters.
   - Heartbeat comment `: ping\n\n` every 25s.
   - Immediate listener unsubscribe and timer cleanup on `req.on("close")`.
   - Authenticated with standard `auth` middleware using `Authorization: Bearer <token>` (no token in query string).
3. **Data Mutation Publishers:**
   - `poll.job.js`: turn created or updated, needs_manual, failed, skipped, ProcessedEmail finished, and syncStatus changes.
   - `emailAction.routes.js`: send draft, manual-send, delete, check/uncheck, label change, and draft edits.
   - Read-only endpoints (`GET /`, `GET /summary`, `GET /analytics`) never emit events.
4. **Frontend Realtime Hook (`frontend/src/hooks/useRealtime.js`):**
   - Mounted once in `AppShell.jsx`.
   - Connects using `@microsoft/fetch-event-source` with `Authorization` header.
   - `DebouncedInvalidator`: coalesces bursts of events within 500 ms to a single queryClient invalidation batch.
   - Reconnect with exponential backoff; triggers a query refetch upon reconnection.
   - Exposes status (`live`, `reconnecting`, `disconnected`) to `Topbar.jsx` for a subtle indicator.
   - Keeps polling (20s on email actions, 30s on analytics) active as a failover.

### Files changed / created
| File | Role |
|---|---|
| `server/services/events.service.js` | In-memory event bus keyed by userId |
| `server/routes/events.routes.js` | SSE route handler with keepalive ping and close cleanup |
| `server/app.js` | Mounts `/events` and `/api/events` |
| `server/jobs/poll.job.js` | Emits `emailAction.changed`, `analytics.changed`, `sync.changed` |
| `server/routes/emailAction.routes.js` | Emits events on draft send, label update, delete, check toggle, manual reply |
| `server/services/gmail.service.js` | Emits `sync.changed` on invalid_grant |
| `frontend/src/utils/realtimeInvalidator.js` | 500ms debounced TanStack query invalidator |
| `frontend/src/hooks/useRealtime.js` | React hook managing SSE connection and reconnect backoff |
| `frontend/src/components/layout/AppShell.jsx` | Mounts `useRealtime` and provides realtime status |
| `frontend/src/components/layout/Topbar.jsx` | Renders "Live" / "Reconnecting..." badge |
| `server/tests/events-service.test.js` | Unit tests for event bus publish/subscribe and cleanup |
| `server/tests/sse-route.test.js` | Unit tests for SSE response headers, stream write, and close cleanup |
| `server/tests/debounce-invalidation.test.js` | Unit tests for 500ms burst coalescing and invalidations |

### Test plan
- [x] Event bus publish/subscribe and cleanup on close (`server/tests/events-service.test.js`).
- [x] SSE route test for headers, stream event write, and connection close cleanup (`server/tests/sse-route.test.js`).
- [x] Debounce bursts test (multiple events in <500ms produce single invalidation) (`server/tests/debounce-invalidation.test.js`).
- [x] Frontend production build compiles without errors.
- [x] All 132 server tests pass with 0 failures.

---

## Batch 5.6 – Gmail Reconcile

### Problem
Changes made directly in the Gmail app (editing, sending or deleting a draft, or replying by hand to an email the app could not answer) are not reflected in the app or in Analytics.

### Design & Architecture
1. **Reconciliation Service (`server/services/reconcile.service.js`):**
   - Called from the poll cycle (`syncUser`) after the sync with its own try/catch, never blocking the sync, per-user, using `withGmail`.
   - Rate-limited: each pending turn is checked at most once every 2 minutes (`outgoing.lastReconciledAt` / `turn.lastReconciledAt`) and at most 30 turns per run.
2. **Draft reconciliation (`outgoing.status === "draft"`):**
   - Calls `drafts.get(gmailDraftId)`.
   - Exists: compares subject, to, cc, bcc, and body with stored values. If they differ, updates the stored copy, sets `outgoing.editedInGmail = true`, `outgoing.editedAt = now`, and updates `outgoing.gmailMessageId` (which changes on every edit in Gmail).
   - 404: fetches the turn's `gmailThreadId` thread (`threads.get`, metadata format) and looks for a message with label `SENT` and `internalDate` after the draft's creation time.
     - Found: marks the turn sent (`status: "sent"`, `sentAt` from internalDate, `gmailMessageId`, `sentFrom: "gmail"`, `outcome: "sent"`) and updates `ProcessedEmail` (`sentAt`, `resolvedAt`, `resolution: "ai_draft_sent"`).
     - Not found: marks turn `outgoing.status = "deleted"` and `ProcessedEmail` `resolution: "none"`. Never marks sent on a guess.
3. **Manual / Failed reconciliation (`outcome: "needs_manual" | "failed"` or no outgoing yet):**
   - If the thread now has a `SENT` message after the turn's `receivedAt`, marks the turn resolved manually in Gmail (`resolution: "manual"`, `composedManually: true`, `sentFrom: "gmail"`, `outgoing.status: "sent"`, `outcome: "sent"`).
   - Failed tab empties by itself and Analytics "Resolved manually" counts it.
4. **Realtime Events:**
   - Emits `emailAction.changed` and `analytics.changed` events via the event bus on every reconciled state mutation. Polling fallback remains active.
5. **UI & Timeline Badges:**
   - Shows "Sent from Gmail", "Edited in Gmail", and "Deleted in Gmail" badges in the detail timeline.
   - Deleted drafts leave the Drafts tab counts (`type !== "draft"` and query exclusion) but stay visible under All.
6. **Graceful App Actions on 404:**
   - If `drafts.get`, `drafts.send`, or `drafts.delete` returns 404, runs reconcile for that turn and returns a clear descriptive message instead of 500.

### Files changed / created
| File | Role |
|---|---|
| `server/services/reconcile.service.js` | Core reconciliation service for draft and manual turn reconciliation |
| `server/services/gmail.service.js` | Added `getGmailDraft` helper |
| `server/utils/helpers.js` | Exported `decodeBase64Url` and `textFromPayload` |
| `server/models/EmailAction.js` | Added `to`, `cc`, `bcc`, `subject`, `editedInGmail`, `editedAt`, `sentFrom`, `lastReconciledAt`, `createdAt` to `OutgoingTurnSchema`; `lastReconciledAt` to `TurnSchema` |
| `server/jobs/poll.job.js` | Calls `reconcileUser` per-user after sync in `syncUser` with own try/catch |
| `server/routes/emailAction.routes.js` | Reconcile fallback on 404 in send/update/delete draft; excluded deleted drafts from Drafts tab |
| `frontend/src/features/emailActions/EmailActionDetail.jsx` | Added "Sent from Gmail", "Edited in Gmail", and "Deleted in Gmail" badges |
| `frontend/src/utils/filterRules.js` | Added "deleted" status config and badge styling |
| `server/tests/reconcile.test.js` | Tests with mocked Gmail for edits, sends, deletes, manual replies, sync isolation, rate limits, and 404 action handling |

### Test plan
- [x] Draft edited in Gmail updates stored fields, sets `editedInGmail=true`, and updates `gmailMessageId`.
- [x] Draft sent in Gmail (404 + SENT message in thread) marks turn sent and updates `ProcessedEmail` with `ai_draft_sent`.
- [x] Draft deleted in Gmail (404 + no SENT message) marks turn status deleted and `ProcessedEmail` resolution none.
- [x] Manual reply to failed item resolves manually in Gmail and empties Failed tab.
- [x] Reconcile failure does not break the sync.
- [x] Rate limiting: checks at most once every 2 minutes per turn, caps at 30 turns per run.
- [x] App send and delete actions handle 404 via reconcile and return clear messages.
- [x] Frontend production build compiles without errors.
- [x] All 140 server tests pass with 0 failures.

---

## Batch 5.7 – CC and BCC

### Problem
Email actions only supported single primary recipients (`to`), without CC or BCC headers, reply-all suggestion handling, user default CC settings, or per-label CC rules.

### Design & Architecture
1. **Data Model (`User.js`, `EmailAction.js`):**
   - Each `turn.outgoing` gets `to[]`, `cc[]`, `bcc[]` as arrays of `{ name, email }`.
   - Lazy migration for existing records: missing fields default to empty arrays `[]` via Mongoose subdocument schema and pre-init / setter normalization.
   - User settings get `settings.defaultCc[]` (array of email strings).
   - Label rules get per-label option `alwaysCc[]` (array of email strings).
   - Backwards-compatible with Batch 6 MIME builder when passing strings or recipient arrays.
2. **MIME Builder (`server/utils/helpers.js`):**
   - `buildMimeMessage` accepts `cc` and `bcc` and writes RFC 2822 `Cc` and `Bcc` headers.
   - Validates every address, deduplicates case-insensitively, removes user's own address from `cc` and `bcc`.
   - Strips CR/LF from all header values to prevent header injection.
   - Limits recipients to 20 per field. Subject and body formatting rules from Batch 6 remain unchanged.
3. **Reply-All Suggestions & Automation (`server/jobs/poll.job.js`):**
   - When a draft or auto-reply is generated from an incoming message with other recipients, stores them as suggestions only in `outgoing.suggestedCc`.
   - Never auto-sends to reply-all recipients without explicit user selection.
   - Always applies configured user default CC and matched label "always CC" automatically.
4. **API Endpoints (`emailAction.routes.js`, `profile.routes.js`, `label.routes.js`):**
   - `PATCH /email-actions/:id` accepts `to`, `cc`, `bcc`, `subject`, and `body`.
   - Draft send (`POST /:id/send`), update draft (`PATCH /:id`), and manual send (`POST /:id/manual-send`) pass them through to Gmail and update the stored record.
   - Reconcile service (`reconcile.service.js`) reads `Cc` and `Bcc` back from Gmail drafts.
   - Profile settings route (`PATCH /profile/settings`) accepts and saves `defaultCc`.
   - Label routes (`POST /labels`, `PATCH /labels/:labelId`) accept and save `alwaysCc`.
5. **Frontend UI:**
   - Reusable `EmailChipInput` with email format validation and multi-address paste support.
   - Latest turn reply editor displays To, Cc, and Bcc fields (with Cc and Bcc collapsed behind "Cc / Bcc" toggle links).
   - Displays "Add reply-all recipients" button when suggested recipients exist.
   - Displays CC recipients on sent turns in the timeline.
   - Failed compose box includes the same To, Cc, Bcc fields and "Add reply-all recipients".
   - Profile & Rules includes Default CC configuration in AccountPanel.
   - Routing Rules includes "Always CC" in LabelForm and LabelTable.

### Files changed / created
| File | Role |
|---|---|
| `server/models/User.js` | Added `settings.defaultCc` and `labels[].alwaysCc` |
| `server/models/EmailAction.js` | Defined `RecipientSchema`, `to[]`, `cc[]`, `bcc[]`, `suggestedCc[]` on `OutgoingTurnSchema` with lazy migration |
| `server/utils/helpers.js` | Updated `buildMimeMessage` for CC/BCC, validation, deduplication, injection prevention, recipient limits, and recipient helpers |
| `server/services/gmail.service.js` | `createGmailDraft` and `updateGmailDraft` pass through CC, BCC, and userEmail |
| `server/services/reconcile.service.js` | Reads `Cc` and `Bcc` from Gmail drafts and updates turn outgoing and action records |
| `server/jobs/poll.job.js` | Generates `suggestedCc`, applies default and label CC, passes CC/BCC to `buildMimeMessage` |
| `server/routes/emailAction.routes.js` | Updated draft update, send, and manual-send endpoints for CC and BCC |
| `server/routes/profile.routes.js` | Updated settings endpoint for `defaultCc` |
| `server/routes/label.routes.js` | Updated label create/patch endpoints for `alwaysCc` |
| `frontend/src/components/common/EmailChipInput.jsx` | Reusable email chip input component with validation and paste handling |
| `frontend/src/features/emailActions/EmailActionDetail.jsx` | Reply editor, Failed compose box, timeline CC display, and "Add reply-all recipients" |
| `frontend/src/features/profile/AccountPanel.jsx` | Added Default CC input in Profile & Rules |
| `frontend/src/features/labels/LabelForm.jsx` | Added Always CC field to label rule creation form |
| `frontend/src/features/labels/LabelTable.jsx` | Added Always CC display column in label rules table |
| `frontend/src/api/emailActions.api.js` | API client passes `cc` and `bcc` on update, send, and manual send |
| `server/tests/cc-bcc.test.js` | Comprehensive unit tests for headers, own-address removal, invalid address rejection, header injection, chips, and CC application |

### Test plan
- [x] Header output: writes `Cc` and `Bcc` headers when provided, omits when empty, preserves Batch 6 string compatibility.
- [x] Own-address removal: strips user email from `cc` and `bcc` case-insensitively, retains in `to`.
- [x] Invalid addresses rejected: malformed emails rejected with errors in `to`, `cc`, and `bcc`.
- [x] Header injection stripped: CR/LF in subject, name, and address sanitized or rejected.
- [x] Recipient parsing, deduplication, and 20-recipient limit enforced.
- [x] Default CC and label always CC applied in poll cycle; other recipients saved as `suggestedCc`.
- [x] Reconcile reads CC and BCC from Gmail drafts.
- [x] Frontend production build compiles without errors.
- [x] All 160 server tests pass with 0 failures.

---

## Batch 5.8 – AI-Assisted Drafting

### Goal
Replace the "Try AI draft anyway" button in the Failed view with a collapsible AI assist panel, and add the same panel for revising an existing draft in the Draft view. The user tells the AI what to write or change, chooses whether the AI must use the label's knowledge base (RAG) or not, and every revision starts from the CURRENT draft text.

### Architecture & Endpoints
- `POST /email-actions/:id/ai-assist`: Operates on latest turn only. Validates turn is latest and not sent, instruction <= 1000 chars, currentBody <= 20000 chars, mode matches turn. Checks concurrency (429) and stale turn (409). Supports client cancellation via `AbortController`.
- `server/services/aiAssist.service.js`: Prompt design treating email, thread, and knowledge passages as untrusted data. Isolated user instruction block. JSON mode `{"body": string}`.
- RAG: If `useKnowledge=true`, queries only knowledge documents attached to the turn's label with top-4 and `RAG_MAX_DISTANCE`. In compose mode, if no chunk passes, returns 200 `status: "no_knowledge"`. In revise mode, proceeds with notice. If `useKnowledge=false`, marks ungrounded and skips vector search.
- Greeting and sign-off framing: In revise mode, strips framing before sending to model only when matching generated framing; re-adds framing afterwards. If edited by user, sends full text and skips injection.
- Output validation: Batch 3 rules extended with user instruction and current draft in trusted context. Rejects invented specifics with 422 `invalid_output`.
- Pure preview: assist endpoint never creates or sends Gmail drafts.
- Saving ("Use this"): Uses existing draft endpoints (`PATCH /email-actions/:id`). Creates Gmail draft in turn's `gmailThreadId` if failed/needs_manual; updates draft if existing. Stores `outgoing.generation` metadata and manages `outgoing.versions[]` (capped at 10).
- Analytics: `ProcessedEmail.resolution` supports `"ai_assisted"`, counted inside `resolvedManually` and returned separately as `aiAssisted`.
- UI: Collapsible `AiAssistPanel` in Failed view and Draft view with quick chips, knowledge base toggle, preview banner with notices, ungrounded warning, sources badge, Use this, Discard, Revise again, Undo, and Versions menu. Details header derives from latest turn ("Draft details", "Reply details", "Needs your reply", never "None Details").

### Test plan
- [x] Revise sends current draft AND instruction to model with unsaved editor text.
- [x] `useKnowledge=false` never calls searchKnowledge; `useKnowledge=true` retrieves from label's documents only.
- [x] Compose + useKnowledge + no passing chunk returns `no_knowledge`; revise + no passing chunk proceeds with notice.
- [x] Facts in user instruction pass validation; invented specifics return 422.
- [x] Greeting/sign-off stripped and re-added when matching; preserved when customized.
- [x] Prompt injection in email does not alter instructions.
- [x] Stale turn returns 409; concurrent request returns 429; client cancel aborts.
- [x] Assist call makes zero Gmail calls; "Use this" creates/updates draft in correct thread.
- [x] Versions capped at 10, undo restores previous body.
- [x] Analytics counts AI-assisted resolutions in `resolvedManually` and `aiAssisted`.

---

### Investigation: AI Draft Paragraph Formatting & Model Framing Issue (Batch 5.8 & Batch 3)

#### 1. Stage-by-Stage Trace Table

Sample tested:
`"Dear Rupak, My career goals are to excel in CSE engineering and build a successful business. I aim to leverage technology to innovate and solve complex problems. Sincerely, Rupak Barman"`

| Stage | Case (a): Run-on (no newlines) | Case (b): Literal `\n` sequences | Case (c): Real `\n` newlines |
|---|---|---|---|
| **1. Raw Ollama Response** | `{"body": "Dear Rupak, My career goals... Sincerely, Rupak Barman"}` | `{"body": "Dear Rupak,\n\nMy career goals...\n\nSincerely,\nRupak Barman"}` | `{"body": "Dear Rupak,\n\nMy career goals...\n\nSincerely,\nRupak Barman"}` |
| **2. After JSON Parsing** | One long string, 0 newline characters | String containing literal `\n` characters | String containing actual `\n` newlines |
| **3. After Cleaning/Normalising** | Unchanged (no `\n` to convert) | `\n` converted to real newline `\n` | Real newlines normalized (`\r\n` -> `\n`) |
| **4. Greeting / Sign-Off Stripping & Injection** | **STRUCTURE LOST:** `stripGreetingsAndSignOffs` regex strictly required `\n+` before sign-off closings (`/\n+(?:sincerely...)/`). In Case (a), `Sincerely, Rupak Barman` was preceded by a space, not `\n+`, so it was **NOT stripped**. Code then injected `Best regards,\nRupak Barman`, creating a double sign-off. Furthermore, in revise mode, `framingMatched` failed to match `Hi Rupak,`, misidentifying the model's `Dear Rupak` as a user edit and leaving the model framing completely untouched! | Model greeting stripped; model sign-off stripped (if preceded by `\n+`). Code greeting and sign-off injected. | Model greeting and sign-off stripped if preceded by `\n+`. Code greeting and sign-off injected. |
| **5. API Response Body** | Body had 0 paragraph breaks; model sign-off remained embedded inside body text. | Preserved whatever paragraphs were emitted, but prompt contract `{"body": string}` rarely yielded multi-paragraph structure. | Preserved `\n\n` if model emitted them, but still lacked paragraph enforcement. |
| **6. Frontend State & Textarea / Preview** | Textarea and read-only div display a single run-on block with no paragraph breaks. | Textarea rendered lines matching `\n`. | Textarea rendered lines matching `\n`. |
| **7. Saved outgoing.body & Gmail MIME** | Plain text part lacked blank lines between body sentences. HTML part split on `/\n\s*\n/` resulted in length 1, creating a **single `<p>` tag** for the entire body text. | Plain text kept `\n\n`; HTML split into `<p>` elements. | Plain text kept `\n\n`; HTML split into `<p>` elements. |

#### 2. Root Cause Analysis
1. **Model Framing Regex Fragility:** `stripGreetingsAndSignOffs` in `aiValidation.js` required `\n+` before closings (`Sincerely`, `Best regards`, etc.). On run-on outputs without newlines, the sign-off regex failed completely.
2. **Revise Framing Misdetection:** In revise mode, `framingMatched` only checked `startsWith(targetGreeting)` ("Hi Rupak,"). When the previous turn wrote `"Dear Rupak,"`, it evaluated to `false`, treating the model-written greeting as an intentional user customization and skipping stripping and injection.
3. **Prompt Contract Shape:** Asking the model for `{"body": string}` allowed local LLMs (`qwen2.5:7b`) to collapse all text into a single paragraph.
4. **Auto-Generation (Batch 3) Impact:** The Batch 3 auto-generation path (`aiEngine.js`) used the exact same prompt shape `{"body": string}` and same `stripGreetingsAndSignOffs` regex, suffering from the exact same single-paragraph collapse and unstripped sign-offs.

#### 3. Shared Solution (`server/utils/emailBody.js`)
- **Shared Module:** Exported `buildEmailBody({ greeting, paragraphs, signOff, name })` and `normalizeParagraphs(input)`.
- **Structure:** Greeting line, blank line (`\n\n`), each paragraph separated by a blank line, blank line, sign-off line, newline, name line. Internal newlines use `\n`; MIME uses `\r\n`.
- **Prompt Contract:** Both auto-generation (`aiEngine.js`) and AI assist (`aiAssist.service.js`) ask for JSON `{"paragraphs": ["...", "..."]}` (2 to 4 short paragraphs, plain text, no greeting, no sign-off, no name), with an example and `{"body": "..."}` fallback.
- **Robust Normalization:** `normalizeParagraphs` converts literal `\n`/`\r\n` to real newlines, normalizes CRLF, splits on blank lines, trims each paragraph, collapses intra-paragraph spaces, and splits single paragraphs > ~240 chars (or 2-sentence run-ons) at sentence boundaries into 2 to 3 sentences without breaking abbreviations (`e.g.`, `Dr.`) or numbers (`3.5`).
- **Framing Detection:** Model greetings and sign-offs are stripped even without newlines, while genuine user custom framing (e.g. "Good morning team," / "Cheers, Al") in revise mode is strictly preserved.
- **Frontend & MIME:** Textareas and `whitespace-pre-wrap` divs preserve line breaks; MIME plain text preserves blank lines and HTML wraps each paragraph in `<p>` with HTML escaping.

---

## Batch 6 – Email MIME / Formatting Fixes

### Issues fixed
- `base64` output not 76-char wrapped (RFC 2045) (CONFIRMED 6a)
- `updateGmailDraft` drops `In-Reply-To` / `References` (CONFIRMED 6b)
- `subject.startsWith` crash on undefined subject (CONFIRMED 6c)
- Markdown stripping regex greedy across lines (CONFIRMED 6d)

### Files to change
| File | Change |
|---|---|
| `server/utils/helpers.js` | 76-char base64 wrapping; fix markdown strip regex; fix double-`\n` replacement |
| `server/services/gmail.service.js` | `updateGmailDraft` accepts and passes `inReplyTo`/`references`; guard `subject?.startsWith`; honour `Reply-To` header |
| `server/tests/helpers.test.js` | **New file**: `node:test` unit tests for `buildMimeMessage`, base64 wrapping, markdown stripping |
| `.gitignore` | Un-ignore `server/tests/` (remove or negate the line); un-ignore `server/tools/` |

### Specific code fixes

**76-char base64 wrapping (`helpers.js`):**
```js
// Before:
Buffer.from(rawEmail).toString('base64')

// After:
const b64 = Buffer.from(rawEmail).toString('base64');
b64.replace(/(.{76})/g, '$1\r\n').trimEnd();
```

**Markdown stripping (`helpers.js` – A4 corrected):**
```js
// Remove generic regex. Rules:
// 1. Only strip a marker pair when the opening marker is followed by a non-space
//    and the closing marker is preceded by a non-space on the same line.
// 2. Never touch "_".
// 3. Do not remove lone "*".
// 4. Leave a literal "\n" alone unless it is an obvious model artefact (e.g. \n{3,}).

function stripMarkdown(text) {
  if (!text) return '';
  return text
    // Strip bold/italic asterisks (*word* or **word**) only when non-space bounded on same line:
    .replace(/(?<=^|[^\w*])(\*{1,2})(?!\s)([^\r\n*]+?)(?<!\s)\1(?=[^\w*]|$)/gm, '$2')
    // Strip header hashes at line start:
    .replace(/^#{1,6}\s+/gm, '')
    // Collapse 3+ consecutive newlines to 2 (model artefact), but leave standard \n alone:
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

**Threading headers in `updateGmailDraft`:**
```js
// Accept inReplyTo and references params; inject into MIME headers before encoding
if (inReplyTo)  rawEmail += `In-Reply-To: ${inReplyTo}\r\n`;
if (references) rawEmail += `References: ${references}\r\n`;
```

**Subject guard:**
```js
// Before:
subject.startsWith('Re:')

// After:
(subject ?? '').startsWith('Re:')
```

### `.gitignore` changes
```
# Remove this line:
server/scripts/

# Add:
!server/tests/
!server/tools/
```

### Test plan
- [x] `node:test server/tests/helpers.test.js` passes with 0 failures.
- [x] Markdown stripping unit tests include:
  - `"5 * 3 and 2 * 4"` (lone `*` untouched)
  - `"snake_case_name"` (`_` never touched)
  - `"john_smith_2@x.com"` (`_` in emails untouched)
  - `"**bold** text"` (stripped to `"bold text"`)
- [x] Verify produced MIME message has 76-char base64 lines.
- [x] Verify `In-Reply-To` header appears in draft uploaded to Gmail.
- [x] Send email with subject `undefined`; confirm no crash.

---

## Batch 7 – Security Hardening

### Issues fixed
- JWT in redirect URL (CONFIRMED 7a)
- No axios 401 interceptor (CONFIRMED 7b)
- No fail-fast for missing env vars (CONFIRMED 7c)
- `accessToken` stored in MongoDB (CONFIRMED 7d)
- CORS hard-coded (CONFIRMED 7e)
- `loginUrl` hard-coded in `AuthContext` (CONFIRMED 7f)
- No helmet / rate limiting (CONFIRMED 7g)

> **OAuth scopes analysis (D18):**  
> Show, per scope, which API call requires it, and report whether `gmail.modify` alone is enough. No scope changes yet.  
> - `gmail.modify`: Required for listing messages/threads (`messages.list`, `threads.get`), history changes (`history.list`), and modifying labels (`messages.modify`).  
> - `gmail.send`: Currently used for sending automated replies (`messages.send`).  
> - `gmail.compose`: Currently used for creating and updating drafts (`drafts.create`, `drafts.update`).  
> - *Audit task:* Document and test whether `gmail.modify` alone provides sufficient privileges to compose drafts and send messages in Google APIs, reporting findings before modifying registered scopes.

### Files to change
| File | Change |
|---|---|
| `server/routes/auth.routes.js` | One-time code exchange: redirect to frontend with short-lived `code`; exchange code for JWT on `/auth/exchange`; no token in URL; strict rate limiting |
| `server/config/passport.js` | Remove `user.accessToken = accessToken`; encrypt `refreshToken` at rest with AES-256-GCM; encrypt existing unencrypted refresh tokens on first boot (no forced re-login) |
| `server/app.js` | Add `helmet()`; add `express-rate-limit` (generous ~300 req/min general, strict on `/auth`); bind to `127.0.0.1`; read `CLIENT_URL` from env; fail-fast validation; auto-generate secrets using `import crypto from "node:crypto"` |
| `server/config/db.js` | Fail-fast if `MONGO_URI` not set |
| `frontend/src/context/AuthContext.jsx` | Read `VITE_API_URL` from env; use code-exchange flow; 401 → logout |
| `frontend/src/api/client.js` | Add axios 401 response interceptor → logout + redirect to login |
| `server/.env.example` | Add `CLIENT_URL`, `DAILY_REPLY_CAP`, `RAG_MAX_DISTANCE`, `OLLAMA_LLM_MODEL` |
| `frontend/.env.example` | Add `VITE_API_URL` |

### Fail-fast env check (`app.js` – D15 corrected)
```js
// Server is ES modules: no require(), use import crypto from "node:crypto"
// Fail-fast list is ONLY truly external, non-auto-generable configuration:
const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MONGO_URI'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}
// JWT_SECRET and TOKEN_ENCRYPTION_KEY are auto-generated on first run if missing and saved to .env.
// Tokens are encrypted at rest via TOKEN_ENCRYPTION_KEY.
```

### Rate limiting policy (D17)
- General rate limiter: ~300 requests/minute across API routes to accommodate UI polling intervals (every 20–30s).
- Strict rate limiter: 15 requests per 15 minutes on `/auth/*` routes to safeguard authentication endpoints.

### Code-exchange OAuth flow
```
1. User clicks Login → frontend redirects to GET /auth/google
2. Google → GET /auth/google/callback → server generates short-lived (60s) one-time code
3. server redirects to ${CLIENT_URL}/auth/callback?code=<one-time-code>
4. frontend calls POST /auth/exchange { code } → server responds { token } (JWT in JSON body)
5. frontend stores JWT in localStorage (same as before, but never in URL)
```

> **⚠️ CAUTION:** The old `GEMINI_API_KEY` was present in `server/.env` (now removed). Revoke it in the Google Cloud Console if not already done.

### Packages to install
```sh
npm install helmet express-rate-limit --prefix server
```

### Risks
- Code-exchange changes the login flow — frontend `AuthContext` and backend must be updated atomically.
- Encrypting `refreshToken` at rest: on first boot, existing plaintext refresh tokens in MongoDB are encrypted in place using the auto-generated encryption key and saved back; users do NOT need to re-login.
- `127.0.0.1` binding means the app is no longer reachable from other machines on the LAN — document this as intentional for local-first deployment.

### Test plan
- [ ] Complete login flow; confirm no token appears in browser URL bar.
- [ ] Expire/invalidate JWT; confirm frontend redirects to login (not hangs).
- [ ] Start server with `GOOGLE_CLIENT_ID` unset; confirm immediate exit with clear error.
- [ ] Confirm `accessToken` no longer stored in MongoDB user document.
- [ ] Existing users with plaintext `refreshToken` are encrypted on boot without forced re-login.
- [ ] `curl http://localhost:3000/api/labels` without token → 401 (not data).
- [ ] Strict rate limit: 20 rapid requests to `/auth/google` triggers 429; general polling endpoints remain responsive up to 300 requests/min.

---

## Batch 8 – README

### Issue fixed
- README.md is empty (CONFIRMED 8)

### File to create/overwrite
`README.md` — written from scratch with these 13 sections:

1. **Project overview** — what Mailpilot does
2. **Architecture diagram** (ASCII)
3. **Hardware requirements** — Ollama CPU/RAM minimums; GPU optional
4. **Prerequisites** — Node 20+, MongoDB, Ollama
5. **Ollama setup** — `ollama pull qwen2.5:7b`; model selection via `OLLAMA_LLM_MODEL`
6. **Google OAuth setup** — step-by-step: create project, enable Gmail API, configure consent screen, create OAuth credentials, add redirect URI, download credentials
7. **Environment variables** — table of all vars for server and frontend with descriptions and defaults (including `OLLAMA_LLM_MODEL`)
8. **Installation** — `npm install` in server + frontend; run migration if upgrading
9. **Running the app** — dev and production modes
10. **First-time setup** — login flow, adding labels and rules, knowledge documents
11. **Important limitations** — 7-day refresh-token expiry applies to apps in "Testing" publishing status, not "unverified" apps (instruct users to set OAuth consent screen to "In production" for personal use); local-only server binding; daily reply cap
12. **Troubleshooting** — Ollama not running, MongoDB connection, Gmail auth errors; ECONNRESET when talking to Google: the network may reset IPv6; the app prefers IPv4 by default (PREFER_IPV4); test with node --dns-result-order=ipv4first
13. **Contributing** — branch naming, PR checklist

### Risks
- None (additive only).

### Test plan
- [ ] README renders correctly in GitHub.
- [ ] All env vars in the table match `.env.example`.
- [ ] OAuth step-by-step tested against a fresh Google Cloud project.

---

## Batch 9 – Root Package & Dev Scripts

### Issues fixed
- No root `package.json` with setup / dev scripts (CONFIRMED 9)

### Files to create / update (D16)
| File | Content |
|---|---|
| `server/package.json` | Add `"dev": "node --watch app.js"`, `"start": "node app.js"`, and `"test": "node --test tests/"` (replacing placeholder) |
| `package.json` (root) | Workspace scripts using `concurrently` |
| `docker-compose.yml` | MongoDB-only container (no app containers) |

### `server/package.json` scripts (D16)
```json
{
  "scripts": {
    "dev": "node --watch app.js",
    "start": "node app.js",
    "test": "node --test tests/"
  }
}
```

### Root `package.json` scripts
```json
{
  "scripts": {
    "install:all": "npm install --prefix server && npm install --prefix frontend",
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix frontend\"",
    "build": "npm run build --prefix frontend",
    "test": "npm test --prefix server",
    "migrate": "node server/tools/migrate-email-actions.js",
    "migrate:dry": "node server/tools/migrate-email-actions.js --dry-run"
  },
  "devDependencies": {
    "concurrently": "^8.0.0"
  }
}
```

### `docker-compose.yml`
```yaml
version: '3.9'
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
volumes:
  mongo_data:
```

### Secrets auto-generation on first run (`server/app.js` – D15 corrected)
The server uses ES modules (`"type": "module"`), so `require()` is forbidden; use `import crypto from "node:crypto"` and `import fs from "node:fs"`.  
On startup, `server/app.js` checks for `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY`:
```js
import crypto from "node:crypto";
import fs from "node:fs";

// Auto-generate JWT_SECRET if missing:
if (!process.env.JWT_SECRET) {
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = jwtSecret;
  fs.appendFileSync('.env', `\nJWT_SECRET=${jwtSecret}\n`);
  console.warn('[SECURITY] Generated fresh JWT_SECRET and appended to .env');
}

// Auto-generate TOKEN_ENCRYPTION_KEY (32-byte hex for AES-256-GCM) if missing:
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const encKey = crypto.randomBytes(32).toString('hex');
  process.env.TOKEN_ENCRYPTION_KEY = encKey;
  fs.appendFileSync('.env', `\nTOKEN_ENCRYPTION_KEY=${encKey}\n`);
  console.warn('[SECURITY] Generated fresh TOKEN_ENCRYPTION_KEY and appended to .env');
}
```

### Risks
- `concurrently` adds a root-level dev dependency — keep it in `devDependencies`.
- `docker-compose.yml` assumes MongoDB port 27017 is free; document port conflict resolution.

### Test plan
- [ ] `npm run install:all` from root installs all packages.
- [ ] `npm run dev` from root starts both server and frontend.
- [ ] `npm run test` runs server tests.
- [ ] `docker-compose up -d` starts MongoDB; server connects to it.

---

## Batch E – Items Needing a Decision (DO NOT TOUCH)

These items require a product/architecture decision before any action is taken. They are listed here for visibility only.

| Item | Location | Risk | Notes |
|---|---|---|---|
| `@types/react`, `@types/react-dom` | `frontend/package.json` devDependencies | Medium | May be needed by IDE tooling even if not imported directly |
| `server/models/Knowledge.js` | `server/models/` | Medium | Still referenced by migration logic in `vectorStore.service.js`; do not delete |
| `LANCEDB_PATH` | `server/.env` | Low | LanceDB is actively used for RAG; this var sets the storage path |
| `frontend/dist/` | `frontend/dist/` | Informational | Build output; fine to gitignore (already is) |
| Parent folder name | `sendora-email-agent-main - Copy/` | Informational | Rename on filesystem is safe but cosmetic; no code changes needed |

---

## Model Comparison Log (to be filled during Batch 3 execution)

| Metric | `qwen2.5-coder:7b` | `qwen2.5:7b` |
|---|---|---|
| Sample email response quality | Functional but rigid; frequently appends unsolicited full signatures directly into text | Conversational, natural phrasing, clean interpersonal tone |
| Avg. generation time (seconds) | 5.10s | 4.23s (~17% faster) |
| Greeting present | 5/5 | 5/5 |
| Sign-off present | 5/5 | 4/5 (supports code injection) |
| Markdown artifacts | 0/5 (clean plain text) | 0/5 (clean plain text) |
| Placeholder text | 0/5 | 0/5 |

---

## End-to-End Acceptance Tests

These tests must pass before marking the fix plan complete.

| # | Test | Expected result |
|---|---|---|
| a | Receive 5 emails simultaneously | All 5 processed; `gmailHistoryId` updated; no duplicates |
| b | Send email from own Gmail address | Skipped; loop protection log entry |
| c | Label with `grounding:"strict"` + low-confidence RAG | `needs_manual` outcome; Failed tab shows entry |
| d | Draft created; send it from UI | Draft moves to Sent; stays in Drafts tab with "Sent" badge |
| e | Follow-up email to existing thread | New turn appended; not overwritten; previous sent turn intact |
| f | Apply date filter in Analytics | Only emails in date range counted; timezone correct |
| g | Login flow | No token in URL; JWT returned in JSON body only |
| h | Start server with `MONGO_URI` unset | Immediate exit with clear error message |
| 1 | Server stopped for hours, 5 emails arrive | All 5 emails processed oldest first via bootstrap query `after:<epochSeconds>` |
| 2 | Two follow-ups in one thread arrive together | Exactly one reply generated; both incoming turns properly summarised in conversation history |
| 3 | Ollama stopped during processing | Retries with backoff, marks row `failed` with reason `ai_unavailable`; recovers automatically when Ollama service returns |
| 4 | Server killed mid-processing | Stale-processing recovery detects in-flight row, checks Gmail state, prevents duplicate sends |
| 5 | Manual send from the Failed tab | Draft/send succeeds; Analytics reflects both failed and resolved manually from `ProcessedEmail` |
| 6 | Typing in the search box during background polling/refetch | Search input never unmounts and never loses focus |
| 7 | Fresh clone verification | Follow only README instructions; app starts and runs with zero code edits |

---

## Checklist Summary

### Batch 1 – Sync Engine
- [x] 1.1 Add `gmailHistoryId` + sync fields to `User.js`
- [x] 1.2 Add `status`/`outcome`/`failureReason` to `ProcessedEmail.js`
- [x] 1.3 Refactor `gmail.service.js` to googleapis OAuth2 client
- [x] 1.4 Rewrite `poll.job.js` (history.list, lock, retry, loop protection)
- [x] 1.5 Add `/sync-status` route
- [x] 1.6 Ollama health check on startup
- [x] 1.7 Real sync status in `Topbar.jsx`

### Batch 2 – Conversation Model
- [x] 2.1 Redesign `EmailAction.js` with `turns[]`
- [x] 2.2 Update `poll.job.js` to write turns
- [x] 2.3 Update `emailAction.routes.js` for new schema
- [x] 2.4 Write `server/tools/migrate-email-actions.js`
- [x] 2.5 Write `server/tools/backfill-summaries.js`
- [x] 2.6 Update `EmailActionDetail.jsx` (timeline, no duplicate badge, real sender)

### Batch 2.5 – Grouping Follow-ups
- [x] 2.5.1 Schema updates (gmailThreadId, rfcMessageId, inReplyToHeader, referencesHeader, linkedBy, indexes)
- [x] 2.5.2 Poll lookup order ((a) threadId/turn.gmailThreadId, (b) In-Reply-To/References, (c) groupBySender within GROUP_WINDOW_DAYS)
- [x] 2.5.3 Fetch sent RFC Message-ID and use turn's gmailThreadId for draft/send
- [x] 2.5.4 User.settings.groupBySender setting & profile settings route & .env.example
- [x] 2.5.5 UI timeline linked tags, subject difference note, Open in Gmail with turn's threadId
- [x] 2.5.6 Mocked tests for all grouping scenarios

### Batch 3 – AI Engine
- [x] 3.1 Switch model to `qwen2.5:7b`; record comparison
- [x] 3.2 Return `_distance` from `searchKnowledge`; add `RAG_MAX_DISTANCE`
- [x] 3.3 `{can_answer, body}` contract + validation
- [x] 3.4 `grounding` field on label schema
- [x] 3.5 `needs_manual` outcome wired through
- [x] 3.6 "Failed" tab in frontend

### Batch 4 – UI
- [x] 4.1 Remove full-page LoadingState; add skeleton rows
- [x] 4.2 `placeholderData: keepPreviousData`; 20s refetch
- [x] 4.3 Filters persisted in URL
- [x] 4.4 Fix tab/status contradiction (derive tabs & badges from latest turn's outgoing.kind/status; no origin field)
- [x] 4.5 Status badge redesign

### Batch 5 – Analytics
- [x] 5.1 Switch source of truth to `ProcessedEmail`
- [x] 5.2 Client-sent local from/to ISO boundaries (prefer over luxon)
- [x] 5.3 Verify Unchecked metric is All-time (checked:false, not filtered by updatedAt)
- [x] 5.4 New metrics (failed, needsManual, etc.)
- [x] 5.5 Write `server/tests/analytics.test.js`

### Batch 5.5 – Realtime Updates
- [x] 5.5.1 In-memory event bus (EventEmitter) keyed by userId (`server/services/events.service.js`)
- [x] 5.5.2 SSE route `GET /events` with ping, no compression, rate limit exemption, client close cleanup (`server/routes/events.routes.js`)
- [x] 5.5.3 Publish events on state changes in `poll.job.js`, `emailAction.routes.js`, and sync status transitions
- [x] 5.5.4 Frontend `useRealtime` hook with `@microsoft/fetch-event-source` using Authorization header
- [x] 5.5.5 Debounced invalidation (<= 1 flush per 500ms) for emailActions, analytics, and sync-status
- [x] 5.5.6 Reconnect backoff with refetch on reconnect & Topbar "Live" / "Reconnecting..." indicator
- [x] 5.5.7 Fallback to polling (20s on emailActions, 30s on analytics)
- [x] 5.5.8 Unit & integration tests for event bus, SSE route, and debounce invalidation logic

### Batch 5.6 – Gmail Reconcile
- [x] 5.6.1 Create `server/services/reconcile.service.js` called from poll cycle per-user after sync with own try/catch and `withGmail`
- [x] 5.6.2 Rate limit reconcile checks to at most once per 2 minutes per turn (`outgoing.lastReconciledAt`) and at most 30 turns per run
- [x] 5.6.3 Draft reconcile: compare subject, to, cc, bcc, body; update stored copy, set `editedInGmail=true` and update `gmailMessageId`
- [x] 5.6.4 Draft 404: search thread for SENT message after draft creation time; mark sent (`ai_draft_sent`) or deleted (`resolution: "none"`)
- [x] 5.6.5 Manual/failed reconcile: search thread for SENT message after turn receivedAt; mark resolved manually in Gmail (`manual`)
- [x] 5.6.6 Emit realtime events (`emailAction.changed`, `analytics.changed`) on reconciled changes
- [x] 5.6.7 UI detail timeline badges ("Sent from Gmail", "Edited in Gmail", "Deleted in Gmail")
- [x] 5.6.8 Deleted drafts leave Drafts tab counts but stay visible under All
- [x] 5.6.9 App Send/Delete routes handle 404 via reconcile and return clear messages
- [x] 5.6.10 Write mocked Gmail unit tests in `server/tests/reconcile.test.js`

### Batch 5.7 – CC and BCC
- [x] 5.7.1 Update `OutgoingTurnSchema` with `to[]`, `cc[]`, `bcc[]`, `suggestedCc[]` (`{ name, email }`) and lazy migration
- [x] 5.7.2 Add `settings.defaultCc[]` and label `alwaysCc[]` to `User.js`
- [x] 5.7.3 Extend `buildMimeMessage` with `cc` & `bcc` headers, email validation, case-insensitive deduplication, own-address removal, CR/LF injection stripping, and 20-recipient limit
- [x] 5.7.4 Incoming messages with other recipients store `outgoing.suggestedCc` (not sent automatically); default and label CC applied automatically
- [x] 5.7.5 API endpoints: draft PATCH accepts `to, cc, bcc, subject, body`; send, update-draft and manual-send pass them through; reconcile reads CC and BCC from Gmail drafts
- [x] 5.7.6 Frontend: reply editor shows To, Cc, Bcc (Cc/Bcc collapsed), email chips with validation & multi-address paste, "Add reply-all recipients", and sent-turn CC display
- [x] 5.7.7 Frontend: Failed compose box includes To, Cc, Bcc, and "Add reply-all recipients"; Profile & Rules includes default CC; label form includes always CC
- [x] 5.7.8 Comprehensive tests for headers, own-address removal, invalid address rejection, header injection, chips validation, and CC application in `server/tests/cc-bcc.test.js`

### Batch 5.8 – AI-Assisted Drafting
- [x] 5.8.1 Add `turnId`, `generation`, and `versions[]` to `EmailAction.js`; add `ai_assisted` to `ProcessedEmail.js` resolution enum
- [x] 5.8.2 Create `server/services/aiAssist.service.js` with untrusted data isolation, RAG handling, JSON mode, framing stripping/re-adding, and validation
- [x] 5.8.3 Implement `POST /email-actions/:id/ai-assist` with stale checks (409), concurrency guard (429), validation (422), cancel handling via AbortController, and no-knowledge status
- [x] 5.8.4 Update `PATCH /email-actions/:id` to create drafts for failed turns via `withGmail` in turn's threadId, save `generation` metadata, and track versions (max 10)
- [x] 5.8.5 Update `handleSendDraft` and `handleManualSend` to resolve as `ai_assisted` when appropriate; update `analytics.routes.js` to return `aiAssisted` and include in `resolvedManually`
- [x] 5.8.6 Create `frontend/src/features/emailActions/AiAssistPanel.jsx` with quick chips, instruction input, knowledge base radio toggle, loading spinner, and cancel button
- [x] 5.8.7 Update `EmailActionDetail.jsx` with preview banner (notices, ungrounded warning, sources, Use this, Discard, Revise again), Undo & Versions menu, and fix header title bug ("None Details" -> "Needs your reply" / "Draft details")
- [x] 5.8.8 Write comprehensive mocked tests in `server/tests/ai-assist.test.js` covering all 10 requirements and update analytics tests
- [x] 5.8.9 Fix AI draft paragraph formatting and model framing (`server/utils/emailBody.js`, prompt JSON `{"paragraphs": [...]}`, normalizeParagraphs sentence splitting & abbreviation protection, shared with Batch 3 auto-generation and AI assist)
- [x] 5.8.10 Add comprehensive unit tests in `server/tests/email-body.test.js` covering normalizeParagraphs, abbreviations, revise framing, MIME decoded parts, and frontend line-break preservation

### Batch 6 – MIME / Formatting
- [x] 6.1 76-char base64 wrapping
- [x] 6.2 Threading headers in `updateGmailDraft`
- [x] 6.3 Subject null guard
- [x] 6.4 Fix markdown strip regex
- [x] 6.5 Un-ignore `server/tests/` in `.gitignore`
- [x] 6.6 Write `server/tests/helpers.test.js`

### Batch 7 – Security
- [ ] 7.1 One-time code OAuth exchange (no JWT in URL)
- [ ] 7.2 Remove `accessToken` from MongoDB; encrypt `refreshToken`
- [ ] 7.3 Fail-fast env var validation
- [ ] 7.4 `helmet` + `express-rate-limit`
- [ ] 7.5 `CLIENT_URL` + `VITE_API_URL` env vars
- [ ] 7.6 Axios 401 interceptor
- [ ] 7.7 Update `.env.example` files

### Batch 8 – README
- [ ] 8.1 Write complete README.md (13 sections)

### Batch 9 – Root Package & Scripts
- [ ] 9.1 Add `dev` (`node --watch app.js`), `start` (`node app.js`), and `test` (`node --test tests/`) scripts to `server/package.json`
- [ ] 9.2 Root `package.json` with dev/test/migrate scripts using `concurrently`
- [ ] 9.3 `docker-compose.yml` (MongoDB only)
- [ ] 9.4 Secrets (`JWT_SECRET` and `TOKEN_ENCRYPTION_KEY`) auto-generation on first run in `server/app.js` using ES modules

---

*fix-plan.md written: awaiting user approval before PHASE 2 execution begins.*



