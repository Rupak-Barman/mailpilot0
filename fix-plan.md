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
- [ ] Send 3 test emails rapidly; verify all 3 are processed (not just 1).
- [ ] Confirm `User.gmailHistoryId` is set after first sync.
- [ ] Confirm second sync uses history.list (check server logs).
- [ ] Send email from own address; confirm it is skipped.
- [ ] Simulate `invalid_grant`; confirm `needsRelogin=true` is set and Topbar shows warning.
- [ ] Confirm Ollama health check prints useful error if Ollama not running.

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
- [ ] Pull `qwen2.5:7b`; run same prompt as `qwen2.5-coder:7b`; record quality difference.
- [ ] Trigger a label with `grounding:"strict"` and low-confidence RAG; confirm `needs_manual`.
- [ ] Trigger generation that would produce a placeholder; confirm `needs_manual` outcome.
- [ ] Confirm `_distance` is now returned by `searchKnowledge`.
- [ ] "Failed" tab appears in frontend; failed turn shows manual compose box.

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
- [ ] Trigger a data refetch; confirm search input and filter dropdowns stay visible.
- [ ] Apply a filter; navigate away and back; confirm filter is restored from URL.
- [ ] Send a draft; confirm it stays in Drafts tab (not disappears).
- [ ] Type in search box and press Escape; confirm input clears.
- [ ] Confirm table shows skeleton rows (not blank) during loading.

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
- [ ] Seed ProcessedEmail docs across 2 days; verify daily counts match client-sent ISO boundaries.
- [ ] Confirm "Failed" card shows correct count.
- [ ] Confirm "Unchecked" card is "All time" (does NOT filter by updatedAt or date range).
- [ ] Confirm "Resolved Manually" and "Replies sent" derive strictly from `ProcessedEmail`, not `EmailAction`.
- [ ] Confirm Failed items appear in Recent Activity feed.
- [ ] `server/tests/analytics.test.js` using `node:test`; seed data, assert counts.

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
| Sample email response quality | TBD | TBD |
| Avg. generation time (seconds) | TBD | TBD |
| Greeting present | TBD | TBD |
| Sign-off present | TBD | TBD |
| Markdown artifacts | TBD | TBD |
| Placeholder text | TBD | TBD |

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
- [ ] 1.4 Rewrite `poll.job.js` (history.list, lock, retry, loop protection)
- [x] 1.5 Add `/sync-status` route
- [x] 1.6 Ollama health check on startup
- [x] 1.7 Real sync status in `Topbar.jsx`

### Batch 2 – Conversation Model
- [ ] 2.1 Redesign `EmailAction.js` with `turns[]`
- [ ] 2.2 Update `poll.job.js` to write turns
- [ ] 2.3 Update `emailAction.routes.js` for new schema
- [ ] 2.4 Write `server/tools/migrate-email-actions.js`
- [ ] 2.5 Write `server/tools/backfill-summaries.js`
- [ ] 2.6 Update `EmailActionDetail.jsx` (timeline, no duplicate badge, real sender)

### Batch 3 – AI Engine
- [ ] 3.1 Switch model to `qwen2.5:7b`; record comparison
- [ ] 3.2 Return `_distance` from `searchKnowledge`; add `RAG_MAX_DISTANCE`
- [ ] 3.3 `{can_answer, body}` contract + validation
- [ ] 3.4 `grounding` field on label schema
- [ ] 3.5 `needs_manual` outcome wired through
- [ ] 3.6 "Failed" tab in frontend

### Batch 4 – UI
- [ ] 4.1 Remove full-page LoadingState; add skeleton rows
- [ ] 4.2 `placeholderData: keepPreviousData`; 20s refetch
- [ ] 4.3 Filters persisted in URL
- [ ] 4.4 Fix tab/status contradiction (derive tabs & badges from latest turn's outgoing.kind/status; no origin field)
- [ ] 4.5 Status badge redesign

### Batch 5 – Analytics
- [ ] 5.1 Switch source of truth to `ProcessedEmail`
- [ ] 5.2 Client-sent local from/to ISO boundaries (prefer over luxon)
- [ ] 5.3 Verify Unchecked metric is All-time (checked:false, not filtered by updatedAt)
- [ ] 5.4 New metrics (failed, needsManual, etc.)
- [ ] 5.5 Write `server/tests/analytics.test.js`

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



