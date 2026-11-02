# Mailpilot Manual End-to-End Release Checklist

This document contains the step-by-step manual verification checklist to execute before cutting a release.  
Because automated tests cannot send live Gmail emails or interact with third-party Google OAuth servers, these manual test scenarios verify the complete production workflow.

---

## Pre-Requisites

1. **Prerequisites Check**: Run `npm run doctor` and ensure all required items pass.
2. **MongoDB**: Running at `127.0.0.1:27017` (e.g. `npm run db:up`).
3. **Ollama**: Running at `http://127.0.0.1:11434` with `qwen2.5:7b` and `embeddinggemma-2:270m` pulled.
4. **Google Cloud**: Valid OAuth Web Client credentials set in `server/.env`.
5. **App Started**: Run `npm run dev` or `npm start`.

---

## Verification Test Cases

### 1. Offline Catch-Up
- **Procedure**:
  1. Stop the backend server process.
  2. Send 2 to 3 emails to your Gmail inbox from an external address while the server is down.
  3. Wait 5 minutes, then restart the server (`npm run dev`).
  4. Observe server console logs during the first polling cycle.
- **Pass Condition**:
  - The poll job executes the catch-up query `after:<timestamp>` based on `CATCHUP_HOURS`.
  - All missed emails are fetched and processed in chronological order (oldest first).
  - `gmailHistoryId` is updated to the latest checkpoint.

---

### 2. Multi-Account Data Isolation
- **Procedure**:
  1. Log in with Google Account A. Create a custom routing label "Billing" and upload a test document.
  2. Log out via the Profile page.
  3. Log in with Google Account B.
  4. Check the Inbox, Rules, Knowledge, and Analytics pages.
- **Pass Condition**:
  - Account B sees zero emails, rules, or knowledge documents belonging to Account A.
  - No cross-account data leakage occurs across SSE streams, localStorage, or API queries.

---

### 3. Own-Address Loop Protection Skip
- **Procedure**:
  1. Using your connected Gmail account, compose and send an email to yourself (From: your address, To: your address) with a subject matching an active rule.
  2. Wait for the next poll cycle (within 60 seconds).
- **Pass Condition**:
  - The server log prints `[poll] Skipping message from own email address: ... (loop protection)`.
  - No new draft or reply is created; no automated loop is triggered.

---

### 4. Follow-up Grouping
- **Procedure**:
  1. Send an initial email to your mailbox and wait for Mailpilot to create a conversation.
  2. Send a reply to that email from the external client (producing matching `In-Reply-To` and `References` headers in the same Gmail thread).
  3. Send an additional follow-up with a slightly altered subject from the same sender within `GROUP_WINDOW_DAYS` (14 days).
- **Pass Condition**:
  - Mailpilot does not create separate disjoint cards in the Inbox.
  - The conversation timeline in `EmailActionDetail` displays all turns in sequential order.
  - Sent states and outgoing draft bodies from earlier turns remain completely intact.

---

### 5. Strict Grounding Failure & Manual Resolution
- **Procedure**:
  1. In Rules, set a label's Grounding to **Strict** with an empty or non-matching knowledge base document.
  2. Send an incoming email that matches this rule asking a specific question (e.g., "What is our corporate discount code?").
  3. Wait for the poll job to process the email.
  4. Open the **Failed** tab in the Mailpilot web UI.
  5. Click the failed item, type a manual response in the compose box, and click **Send Reply**.
- **Pass Condition**:
  - AI engine rejects ungrounded generation and flags the turn with outcome `needs_manual` and reason `no_knowledge`.
  - The conversation appears in the **Failed** tab.
  - Manual send delivers the email via Gmail API and updates the card to "Sent".
  - Analytics increments `resolvedManually`.

---

### 6. AI Assist: Compose and Revise
- **Procedure**:
  1. In a draft or failed turn, open the **AI Assist** panel.
  2. Test **Compose**:
     - Toggle Knowledge Base **On**: Enter instruction "Draft an invitation to Tuesday's product demo".
     - Toggle Knowledge Base **Off**: Enter instruction "Draft a polite decline".
  3. Test **Revise**:
     - Type a draft in the editor: "Hi, let's meet tomorrow."
     - In AI Assist, prompt: "Make it more formal and ask for an agenda."
- **Pass Condition**:
  - When Knowledge Base is On, verified facts from uploaded PDFs are cited.
  - When Knowledge Base is Off, the model does not hallucinate false document details.
  - Model framing text (e.g. "Here is a revised draft:") is stripped automatically.
  - Greetings and sign-offs match user profile settings.

---

### 7. Editor: Save Without "Use This"
- **Procedure**:
  1. Click **AI Assist** and generate a draft preview.
  2. Notice the preview banner ("Previewing AI Draft" with buttons: *Use this*, *Discard*, *Revise again*).
  3. Instead of clicking *Use this*, directly edit the text in the draft textarea, then click **Save draft**.
- **Pass Condition**:
  - The manual changes in the textarea are preserved and saved directly to MongoDB.
  - The preview banner dismisses.
  - The unsaved AI preview does not overwrite the user's manual text.

---

### 8. CC and BCC Header Validation
- **Procedure**:
  1. In a draft turn, click **+ Cc** and **+ Bcc**.
  2. Paste multiple emails separated by commas or semicolons: `team@example.com, finance@example.com`.
  3. Try adding an invalid address `bad-email-without-at` (confirm chip turns red or displays error).
  4. Click **Save draft** and check the draft in Gmail webmail.
- **Pass Condition**:
  - Valid recipients are saved in `turn.outgoing.cc` and `turn.outgoing.bcc`.
  - The user's own address is filtered out automatically.
  - In Gmail webmail, the draft displays the exact CC and BCC recipients.

---

### 9. Gmail Reconcile (Edits, Sends, Deletes in Webmail)
- **Procedure**:
  1. Generate a draft in Mailpilot.
  2. Open Gmail in your web browser:
     - **Test 9a (Edit)**: Change the draft's body in Gmail and save. Wait up to 2 minutes.
     - **Test 9b (Send)**: Click "Send" inside Gmail. Wait up to 2 minutes.
     - **Test 9c (Delete)**: Trash the draft in Gmail. Wait up to 2 minutes.
- **Pass Condition**:
  - **9a**: Mailpilot detects the edit, displays "Edited in Gmail" badge, and syncs the body.
  - **9b**: Mailpilot detects message was sent, updates turn status to "Sent", displays "Sent from Gmail".
  - **9c**: Mailpilot detects draft was discarded, removes item from Drafts count, and updates badge.

---

### 10. Realtime Updates via SSE
- **Procedure**:
  1. Open Mailpilot in your browser on the Inbox page.
  2. Send a new email to your Gmail account from your phone or secondary address.
  3. Keep the browser open without clicking refresh or pressing F5.
- **Pass Condition**:
  - The Topbar displays the green **Live** status dot.
  - When the background poll cycle finishes, the new conversation card appears in the list automatically.

---

### 11. Analytics Accuracy
- **Procedure**:
  1. Navigate to the **Analytics** page.
  2. Change date presets: Today, Last 7 Days, Last 30 Days.
- **Pass Condition**:
  - "Total Processed", "Drafted", "Sent", and "Resolved Manually" match actual email operations.
  - "Unchecked" reflects all-time unchecked conversations across all dates.
  - No negative numbers or NaN values appear in chart cards.

---

### 12. OAuth Token Encryption at Rest
- **Procedure**:
  1. Open a MongoDB shell (`mongosh` or MongoDB Compass).
  2. Query the users collection: `db.users.findOne({}, { refreshToken: 1, accessToken: 1 })`.
- **Pass Condition**:
  - `refreshToken` contains an encrypted object with `iv`, `tag`, and `ciphertext` (or AES-256-GCM hex representation).
  - The plaintext OAuth token is NOT stored anywhere in the database.
  - The legacy `accessToken` field is absent (`null` or undefined).

---

### 13. Login and Logout Flow
- **Procedure**:
  1. Click **Sign out** on the Profile page.
  2. Click **Sign in with Google** and complete the OAuth consent.
  3. Observe the browser URL bar immediately after redirection.
- **Pass Condition**:
  - The browser URL bar never displays `?token=eyJ...`.
  - Authentication uses the one-time code exchange (`/auth/exchange`) in the background.
  - Redirect lands cleanly on `/` with valid session state.

---

### 14. Session Expiry & 401 Interceptor
- **Procedure**:
  1. In the browser Developer Tools, open **Application** > **Local Storage**.
  2. Edit or corrupt the value of `mailpilot_token`.
  3. Click any navigation link or trigger an API request.
- **Pass Condition**:
  - Axios interceptor catches the 401 response, clears the invalid token, and redirects the user to `/login`.
  - The application does not freeze, hang, or enter an infinite loop.

---

### 15. Server Restart Mid-Processing
- **Procedure**:
  1. Trigger a large synchronization run with several unread emails.
  2. Force-kill the server process mid-run (`Ctrl+C` twice or `taskkill`).
  3. Restart the server (`npm start` or `npm run dev`).
- **Pass Condition**:
  - The server recovers gracefully without crashing.
  - Stale processing recovery detects in-flight items older than 5 minutes.
  - Claim-first deduplication prevents duplicate emails or duplicate Gmail drafts.

