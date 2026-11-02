# Mailpilot

Mailpilot is an autonomous, privacy-focused email assistant and co-pilot for Gmail. It runs entirely on your local machine, categorizes incoming emails with custom routing rules, retrieves domain knowledge from your uploaded PDF documents (RAG via LanceDB and local embeddings), and generates contextual drafts or replies using a local Ollama LLM.

**Zero data is sent to cloud AI providers.** Your emails, credentials, embeddings, and generative AI inferences remain strictly within your local environment.

---

## Features

- **Routing Rules with Actions**: Categorize emails automatically into custom labels with designated actions:
  - `reply`: Generates a contextual reply and automatically sends it via Gmail.
  - `draft`: Generates a contextual reply and saves it directly to your Gmail Drafts folder for review.
  - `none`: Categorizes and labels the email without generating AI drafts or automated replies.
- **Local Knowledge Base & Grounded Replies**: Upload reference PDF documents. Mailpilot chunks and vectorizes them using local embeddings (`embeddinggemma-2:270m`) stored in LanceDB. Grounding modes prevent hallucinations:
  - *Strict*: Answers questions only when supported by matching passages within `RAG_MAX_DISTANCE`.
  - *Flexible*: Allows polite acknowledgements and general guidance when documents lack a direct match.
- **Writing Personas**: Define custom writing personas with distinct tones, instructions, and signatures, or use your default profile settings.
- **Failed Tab & Manual Replies**: Emails that fail grounding checks or encounter processing errors are routed to the **Failed** tab ("Needs your reply") where you can review them and send manual responses.
- **AI Assist (Write & Revise)**: In-app editor allows you to write or revise drafts using local AI on demand, with quick prompt chips, optional knowledge base scoping, and real-time generation previews.
- **Manual CC & BCC Controls**: Full recipient management with multi-address validation chips, RFC 5322 header protection, and a one-click "Add reply-all recipients" helper. Automatic CC has been completely eliminated to prevent accidental data leaks.
- **Follow-up Thread Grouping**: Automatically groups related emails into cohesive conversation turns using RFC Message-ID, `In-Reply-To`, `References` headers, and configurable sender time windows (`GROUP_WINDOW_DAYS`).
- **Gmail Reconcile**: Bi-directional state synchronization. Edits, sends, or deletions performed directly in the Gmail web interface are detected and reconciled without draft desynchronization or 404 errors.
- **Realtime Live Updates**: Server-Sent Events (SSE) stream state changes instantly to the frontend with debounced UI invalidation and live connection status indicators.
- **Thread Timelines**: Turn-by-turn conversation audit trail displaying incoming summaries, timestamps, outgoing drafts, review status, and Gmail action badges.
- **Analytics Dashboard**: Tracks processing volumes, automated replies, drafts created, manual resolutions, and error distributions based on verified event history.

---

## Design Decisions

- **Local-First for Privacy**: Emails, reference knowledge documents, vector embeddings, and generative AI inferences remain strictly on the user's computer. No email bodies, drafts, or prompts are transmitted to external third-party cloud AI vendors.
- **One-Command Setup**: A single command (`npm run setup`) bootstraps dependencies and configures environment files across both server and frontend packages, while `npm start` (or platform launcher scripts) builds production assets and launches all services concurrently.
- **Self-Hosted OAuth Credentials**: Every user creates and registers their own Google Cloud OAuth 2.0 Web Client credentials. This eliminates reliance on a shared multi-tenant SaaS application, avoids third-party access to user mailboxes, and gives users direct control over API quotas and consent revocation.

---

## Deployment Options

| Architecture / Option | Database | AI Inference (Ollama) | Google OAuth Status | Privacy & Operational Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Local Workstation (Default)** | Local MongoDB (`127.0.0.1:27017`) or Docker container | Local Ollama instance (`http://127.0.0.1:11434`) | Personal Google Cloud Project (OAuth consent screen set to **In production** for personal use) | **Recommended**. 100% private: emails, embeddings, and credentials never leave localhost. Setting status to In production prevents the 7-day token expiration. |
| **Docker Database Hybrid** | Containerized MongoDB via `docker-compose.yml` (`npm run db:up` / `npm run db:down`) | Local Ollama instance | Personal Google Cloud Project | Simplifies MongoDB database lifecycle without requiring a native system service installation. |
| **Hosted Demo / Staging** | MongoDB Atlas cloud cluster | Tunnelled Ollama machine (e.g. ngrok / Cloudflare Tunnel) or hosted model API | Google Cloud Project with named Test Users (up to 100 users) | Frontend hosted on static platform (Vercel, Netlify), server on cloud container (Railway, Render). **Privacy trade-off**: Transmitting email text across tunnels or using hosted model APIs sends email content to that external provider. While in "Testing" mode, Google expires refresh tokens after 7 days. |
| **Public Multi-User Release** | Managed MongoDB cluster (Atlas) | Scaled inference cluster or enterprise LLM endpoint | Verified Google OAuth 2.0 Application | **Requires Google OAuth Verification**: Gmail scopes (`gmail.modify`) are classified as **Restricted**. Without Google verification, access is capped at 100 manually added test users, and refresh tokens expire every 7 days. Public release requires annual third-party CASA security assessments. |

---

## Using Mailpilot (Walkthrough)

1. **Sign In**: Navigate to `http://localhost:5173` and click **Sign in with Google**. Select your account and grant mailbox permissions (if using a personal unverified Google Cloud project, click **Advanced** > **Go to Mailpilot (unsafe)**).
2. **Configure Writing Persona**: Navigate to **Profile & Rules**. In the **Writing Persona** section, choose your tone (e.g., Professional, Friendly, Direct), specify custom background instructions (your role, company guidelines, availability), and set your email signature.
3. **Upload Knowledge Documents**: In the **Knowledge Base** section of **Profile & Rules**, upload reference PDF documents (product documentation, company policies, FAQs). Mailpilot chunks and vectorizes the text into LanceDB.
4. **Create Routing Rules**: Open the **Routing Rules** drawer by clicking **Create Rule**:
   - Provide a unique rule name and color.
   - Choose the desired action: `reply` (auto-send reply), `draft` (create Gmail draft for review), or `none` (label only).
   - Select the grounding mode: `strict` (only answers when supported by document passages within `RAG_MAX_DISTANCE`) or `flexible` (allows polite general replies).
   - Attach the relevant uploaded PDF documents.
5. **Monitor Drafts & Replies**: Open the **Drafts & Replies** page (`/`). As new emails arrive in Gmail's Primary inbox, Mailpilot categorizes them, creates drafts, or sends replies. Click any conversation thread to inspect turn timelines, review generated text, add CC/BCC chips, or edit before sending.
6. **Handle the Failed Tab**: Any email that cannot be safely answered under Strict grounding or that encounters processing issues is routed to the **Failed** ("Needs your reply") tab. You can inspect the failure reason and compose a manual response directly from the interface.
7. **Use AI Assist**: When drafting or editing responses, click **AI Assist** (`Write with AI` or `Revise`). Select a quick prompt chip (e.g., "Make it more concise", "Softer tone", "Ask for clarification") or enter custom prompt instructions to generate or refine your draft with the local LLM.

---

## Requirements

- **Node.js**: `20.x` or higher
- **MongoDB**: `6.x` or `7.x` running locally (`mongodb://127.0.0.1:27017/mailpilot`) or via Docker container
- **Ollama**: Local AI runner ([ollama.com](https://ollama.com)) with the following models pulled:
  - `qwen2.5:7b` (Large Language Model)
  - `embeddinggemma-2:270m` (Embedding Model)
- **Hardware Resources**:
  - RAM: 8 GB minimum (16 GB recommended for running 7B models smoothly)
  - Disk: ~5 GB free space for Ollama model weights
  - GPU: Optional (CPU inference works but is slower)
- **Google Account**: A standard personal Gmail or Google Workspace account
- **Google Cloud Project**: To obtain OAuth 2.0 Web Client credentials

---

## Quick Start

### 1. Clone Repository & Install Dependencies

```bash
git clone https://github.com/Rupak-Barman/mailpilot0.git
cd mailpilot0

# Run automated idempotent setup (installs root, server, and frontend dependencies, and copies .env templates)
npm run setup
```

### 2. Configure Environment & Google OAuth

The setup script creates `server/.env` and `frontend/.env` from `.env.example` templates if missing. Configure your credentials:
1. Complete the [Google OAuth Setup](#google-oauth-setup) below to obtain your client ID and secret.
2. Update `server/.env`:
   - `GOOGLE_CLIENT_ID=your_client_id_here`
   - `GOOGLE_CLIENT_SECRET=your_client_secret_here`
   - `MONGO_URI=mongodb://127.0.0.1:27017/mailpilot`
3. Verify `frontend/.env` (defaults to `VITE_API_URL=http://localhost:3000`).

### 3. Pull Required Ollama Models

Ensure Ollama is installed and running (`ollama serve`), then pull the configured models:

```bash
ollama pull qwen2.5:7b
ollama pull embeddinggemma-2:270m
```

### 4. Start MongoDB

Start MongoDB locally or spin it up using Docker Compose:

```bash
# Start MongoDB container in background
npm run db:up

# Stop MongoDB container when finished
npm run db:down

# Or via local system services:
# Windows: net start MongoDB
# macOS:   brew services start mongodb-community
# Linux:   sudo systemctl start mongod
```

### 5. Verify System Health (Doctor)

Run the automated diagnostic tool to verify Node version, MongoDB reachability, Ollama models, and port availability:

```bash
npm run doctor
```

### 6. Start Application

You can launch Mailpilot in development mode or production mode:

- **Development Mode (`npm run dev`)**: Starts both backend (`node --watch app.js`) and frontend (`vite` with Hot Module Replacement) concurrently. Recommended for active development:
  ```bash
  npm run dev
  ```
- **Production Mode (`npm start`)**: Executes `scripts/start.js`. It automatically checks if the frontend production bundle (`frontend/dist`) exists, builds it if missing (`npm run build --prefix frontend`), and runs the backend server and Vite production preview concurrently:
  ```bash
  npm start
  ```
- **One-Click Launchers**:
  - Windows: Double-click or run `start-mailpilot.bat`
  - macOS / Linux: Run `./start-mailpilot.sh`

Open your browser at **`http://localhost:5173`** and click **Sign in with Google**. (The backend API listens on `http://127.0.0.1:3000`).

### Stopping the Application

To stop Mailpilot, press `Ctrl+C` in your terminal. Mailpilot initiates a graceful shutdown:
1. Stops the cron polling scheduler.
2. Closes active Server-Sent Events (SSE) connections.
3. Waits up to 10 seconds for any in-flight email processing to complete.
4. Closes the Express HTTP server and MongoDB database connections cleanly.

*(Pressing `Ctrl+C` a second time forces immediate process termination).*

---

## Google OAuth Setup

Mailpilot requires Google OAuth 2.0 credentials to interact with your Gmail mailbox.

### Step-by-Step Instructions

1. **Create Google Cloud Project**:
   - Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
   - Click **Select a project** > **New Project**, name it `Mailpilot`, and click **Create**.
2. **Enable Gmail API**:
   - Go to **APIs & Services** > **Library**.
   - Search for `Gmail API`, select it, and click **Enable**.
3. **Configure OAuth Consent Screen**:
   - Go to **APIs & Services** > **OAuth consent screen**.
   - Select User Type: **External** and click **Create**.
   - Provide an **App name** (e.g. `Mailpilot Local`), support email, and developer contact email.
   - Click **Save and Continue** through the Scopes step (scopes are requested at login).
   - Under **Test users**, click **Add Users** and enter your personal Gmail address.
4. **Publishing Status ("In production" Recommendation)**:
   > [!IMPORTANT]
   > While the OAuth app is in **Testing** status, Google automatically expires refresh tokens after **7 days**, which causes mailbox synchronization to halt until you sign in again.
   > For personal, single-user use, navigate to the OAuth consent screen and click **Publish App** to switch the status to **In production**.
   > When signing in, Google will display an *"Unverified app"* warning screen. This is expected, harmless, and safe because you are accessing your own private Google Cloud project. Click **Advanced** > **Go to Mailpilot (unsafe)** to continue.
5. **Create OAuth 2.0 Client ID**:
   - Go to **APIs & Services** > **Credentials**.
   - Click **Create Credentials** > **OAuth client ID**.
   - Select Application type: **Web application**.
   - Name: `Mailpilot Client`.
   - **Authorized JavaScript origins**:
     - `http://localhost:3000`
     - `http://localhost:5173`
   - **Authorized redirect URIs**:
     - `http://localhost:3000/auth/google/callback` *(Ensure this matches `<BASE_URL>/auth/google/callback`)*.
   - Click **Create** and copy your **Client ID** and **Client Secret** into `server/.env`.

### Scopes Explained Honestly (Batch 7 Scope Audit)

Under Google's API specifications, `https://www.googleapis.com/auth/gmail.modify` is a superset scope that grants read, label, compose, edit, draft management, and email sending permissions. 

A security scope audit evaluated Mailpilot's configured scopes:

| Scope Requested | Purpose in Mailpilot | Status & Redundancy Assessment |
| :--- | :--- | :--- |
| `profile` | Retrieves Google account display name and ID (`passport.js`). | **Required**: User account identification. |
| `email` | Retrieves authenticated user email address. | **Required**: Needed for user identity and auto-reply own-address loop check. |
| `https://www.googleapis.com/auth/gmail.modify` | Reads emails, manages labels, creates drafts, and sends replies. | **Required (Core Scope)**: Superset that covers all Gmail interactions. |
| `https://www.googleapis.com/auth/gmail.compose` | Creates and updates drafts in Gmail. | **Redundant**: Already fully covered by `gmail.modify`. Retained in configuration to avoid invalidating existing user refresh tokens and forcing re-consent. |
| `https://www.googleapis.com/auth/gmail.send` | Sends automated and manual email replies. | **Redundant**: Already fully covered by `gmail.modify`. Retained in configuration to avoid invalidating existing user refresh tokens and forcing re-consent. |

---

## How It Works

### Architecture Overview

```text
+-------------------------------------------------------------------------+
|                              Mailpilot                                  |
|                                                                         |
|  +--------------------+        HTTP / SSE        +-------------------+  |
|  |  React Frontend    | <=====================>  |  Express Server   |  |
|  |  (Vite, Tailwind)  |                          |  (Node.js 20+)    |  |
|  +--------------------+                          +---------+---------+  |
|                                                            |            |
|                   +-------------------+--------------------+            |
|                   |                   |                    |            |
|                   v                   v                    v            |
|          +-----------------+ +-----------------+ +------------------+   |
|          | MongoDB 6/7     | | LanceDB Vector  | | Ollama (Local)   |   |
|          | (User, Threads, | | (Knowledge Base | | - qwen2.5:7b     |   |
|          |  Turns, Audits) | |  Embeddings)    | | - embeddinggemma |   |
|          +-----------------+ +-----------------+ +------------------+   |
+------------------------------------------------------------|------------+
                                                             | HTTPS
                                                             v
                                                   +------------------+
                                                   | Google Gmail API |
                                                   | (OAuth 2.0 SSL)  |
                                                   +------------------+
```

### The Synchronization Cycle

1. **Scheduled Polling**: Every minute (`*/1 * * * *`), the background sync worker runs for all connected users (controlled by `SYNC_ENABLED`).
2. **History Checkpoint**:
   - On the initial run, Mailpilot scans emails received within the lookback window (`CATCHUP_HOURS`, default: 48h).
   - On subsequent runs, it queries `gmail.users.history.list` using the stored `gmailHistoryId` checkpoint.
3. **Primary Category Only**: Mailpilot only inspects emails categorized under Gmail's **Primary** inbox (`category:primary`). Promotions, Social, Forums, and Updates tabs are bypassed.
4. **Oldest-First Processing**: Unread messages are sorted chronologically ascending so conversation context builds naturally.
5. **Batch Constraints**: Each poll cycle processes up to `MAX_PER_RUN` (default: 25) messages per user to maintain low memory usage and avoid API quota exhaustion.
6. **Safety & Loop Protection**:
   Mailpilot implements eight strict loop and bounce protection rules in `server/jobs/poll.job.js`:
   - **Own Address Guard**: Messages sent from the authenticated user's own email address are skipped immediately (`loop_protection:own_address`).
   - **Auto-Submitted Header**: Messages containing an `Auto-Submitted` header with a value other than `no` (e.g. `auto-generated`, `auto-replied`) are skipped (`loop_protection:auto_submitted_*`).
   - **Precedence Header**: Messages with `Precedence` set to `bulk`, `list`, or `junk` are skipped (`loop_protection:precedence_*`).
   - **List-Unsubscribe Header**: Newsletter and mailing list emails containing `List-Unsubscribe` headers are skipped (`loop_protection:list_unsubscribe`).
   - **X-Autoreply Header**: Out-of-office and vacation responses with `X-Autoreply` are skipped (`loop_protection:x_autoreply`).
   - **Bot & Bounce Senders**: Senders whose local-part or From header matches `noreply`, `no-reply`, `mailer-daemon`, `postmaster`, or `bounce` are skipped (`loop_protection:bot_or_bounce_sender`).
   - **Daily Reply Cap**: Automated replies are capped at `DAILY_REPLY_CAP` (default: 50) per user per UTC day (`loop_protection:daily_reply_cap_exceeded`), tracked via `dailyReplySentCount` and reset daily.
   - **Stale-Processing Recovery**: If a processing worker crashes or stalls, rows in `status: 'processing'` older than 5 minutes are recovered. Mailpilot checks Gmail threads (`threads.get`) and `EmailAction` to verify whether a draft or sent message was already created. If found, it marks the record `done` to prevent duplicate replies; otherwise, it retries up to 3 times before setting `status: 'failed'` (`stale_recovery_exhausted`).
7. **Transient Retries**: Temporary network interruptions or Google API timeouts (`ECONNRESET`, `ETIMEDOUT`) are retried up to 3 times using exponential backoff.

### Processing Outcomes

Every incoming email evaluated by Mailpilot receives an explicit outcome:
- **`drafted`**: The routing rule specified `draft`. AI drafted a contextual reply and created a Gmail draft for review.
- **`replied` (`sent`)**: The routing rule specified `reply`. AI generated a reply and sent it immediately via Gmail.
- **`none` (`labeled`)**: The routing rule specified `none`. The email was assigned the Gmail label, marked as read if configured, and no AI generation occurred.
- **`skipped`**: The message was already processed, originated from the user, or triggered loop protection.
- **`needs_manual`**: Grounding check failed (no matching passages in knowledge docs within `RAG_MAX_DISTANCE`) or the AI flagged the query as unanswerable. Routed to the **Failed** tab.
- **`failed`**: An unrecoverable system or API error occurred during processing.

### Why "No Knowledge Match" Happens

When a routing rule is set to **Strict** grounding, Mailpilot embeds the incoming email text and searches the assigned knowledge base in LanceDB. If the closest passage distance exceeds `RAG_MAX_DISTANCE` (default: `0.5`), the retrieval engine determines that the documents do not contain reliable source material. Rather than inventing facts or hallucinating specifics, Mailpilot safely flags the email as `needs_manual`.

---

## Configuration

### Environment Variables

All variables used by Mailpilot are validated against `server/.env.example` and `frontend/.env.example`:

| Variable | Scope | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Server | Optional | `development` | Application runtime environment (`development`, `production`, `test`). |
| `HOST` | Server | Optional | `127.0.0.1` | Host address to bind the server. Defaults to `127.0.0.1` for local safety. |
| `PORT` | Server | Optional | `3000` | Port number for backend HTTP service. |
| `CLIENT_URL` | Server | Optional | `http://localhost:5173` | Allowed origin for CORS headers and OAuth redirects. |
| `BASE_URL` | Server | Optional | `http://localhost:3000` | Base server URL used to derive the OAuth callback URL. |
| `MONGO_URI` | Server | **Required** | None | MongoDB connection string (e.g. `mongodb://127.0.0.1:27017/mailpilot`). |
| `GOOGLE_CLIENT_ID` | Server | **Required** | None | Google OAuth 2.0 Web Client ID. |
| `GOOGLE_CLIENT_SECRET` | Server | **Required** | None | Google OAuth 2.0 Web Client Secret. |
| `JWT_SECRET` | Server | Optional | Auto-generated | 32-byte hex secret for signing session tokens. Generated on first run if missing. |
| `TOKEN_ENCRYPTION_KEY` | Server | Optional | Auto-generated | 32-byte hex key for AES-256-GCM encryption of refresh tokens at rest. |
| `OLLAMA_BASE_URL` | Server | Optional | `http://127.0.0.1:11434`| HTTP address of your local Ollama instance. |
| `OLLAMA_LLM_MODEL` | Server | Optional | `qwen2.5:7b` | Ollama model name used for email drafting and validation. |
| `OLLAMA_EMBEDDING_MODEL`| Server | Optional | `embeddinggemma-2:270m` | Model name for computing vector embeddings. |
| `OLLAMA_NUM_CTX` | Server | Optional | `4096` | Context window size in tokens for LLM generation. |
| `LANCEDB_PATH` | Server | Optional | `./data/lancedb` | Filesystem path for LanceDB tables (relative to server working directory). |
| `RAG_MAX_DISTANCE` | Server | Optional | `0.5` | Maximum distance threshold for vector search matches. |
| `SYNC_ENABLED` | Server | Optional | `true` | Master toggle to enable or disable background Gmail polling. |
| `DAILY_REPLY_CAP` | Server | Optional | `50` | Maximum number of automated replies per user per UTC day. |
| `GROUP_WINDOW_DAYS` | Server | Optional | `14` | Lookback window (in days) to group follow-ups from the same sender. |
| `CATCHUP_HOURS` | Server | Optional | `48` | Lookback window (in hours) for initial mailbox synchronization. |
| `MAX_PER_RUN` | Server | Optional | `25` | Maximum unread emails processed per user in one sync cycle. |
| `PREFER_IPV4` | Server | Optional | `true` | Programmatically configures Node DNS to prefer IPv4 over IPv6. |
| `VITE_API_URL` | Frontend | Optional | `http://localhost:3000` | Backend API base URL used by Vite frontend client. |

### Routing Rule & Label Settings

Routing rules are managed in **Profile & Rules > Routing Rules**:
- **Name**: 1–40 characters, case-insensitively unique, auto-trimmed.
- **Colour**: 8 accessible palette choices.
- **Action**:
  - `none`: Categorization only.
  - `draft`: Generates Gmail draft.
  - `reply`: Automatically sends reply.
- **Grounding Mode**:
  - `strict`: Requires verified knowledge match.
  - `flexible`: Permits general replies when documents lack answers.
- **Knowledge Bases**: Multi-select uploaded PDF documents attached to the rule.
- **Persona**: Assign a custom writing persona or use the default account style.
- **Status Toggle**: Enable or disable rule without deleting configuration.

> [!NOTE]
> **Manual CC & BCC Policy**: Automatic recipient forwarding has been eliminated to prevent unintended data exposure. CC and BCC recipients are added manually in the draft editor or composer.

### User Settings

- **Group by Sender**: When enabled, incoming emails that lack explicit RFC threading headers (`In-Reply-To` / `References`) but share the same sender within `GROUP_WINDOW_DAYS` (default: 14 days) are automatically grouped into the same conversation thread timeline.

---

## Calibrating RAG_MAX_DISTANCE

The vector search threshold `RAG_MAX_DISTANCE` controls how closely a document passage must match an email query before Mailpilot accepts it as valid grounded knowledge.

Mailpilot includes an offline calibration report tool: `server/tools/rag-distance-report.js`.

### 1. Create Evaluation Dataset

Create a JSON file (e.g. `eval-dataset.json`) containing test queries labeled with expected match outcomes:

```json
[
  {
    "subject": "Return Policy Inquiry",
    "body": "What is the return window for items purchased on sale?",
    "expected": "match"
  },
  {
    "subject": "Lunch Plans",
    "body": "Are we still meeting at the cafe down the street today at noon?",
    "expected": "no_match"
  }
]
```

### 2. Run Calibration Report

Command syntax:

```bash
# Positional syntax:
node server/tools/rag-distance-report.js <dataset.json> <labelIdOrName> [--user <userIdOrEmail>]

# Named option syntax:
node server/tools/rag-distance-report.js --file <dataset.json> --label <labelIdOrName> [--user <userIdOrEmail>]
```

Example:

```bash
node server/tools/rag-distance-report.js eval-dataset.json "Support"
```

### 3. Interpreting Output

The report runs queries against documents attached to the target rule and displays:
- Per-email best chunk distance (`_distance`) returned by LanceDB vector search.
- Summary statistics (min, max, average) for the `match` and `no_match` groups.
- A suggested cutoff threshold calculated from the observed separation.

Sample output:

```text
========================================================
RAG DISTANCE CALIBRATION REPORT
Label: "Support" (ID: 67123abc456def7890123456)
User: user@example.com (67123abc456def7890123456)
Attached Knowledge Document IDs: [67123def456abc7890123456]
Total Dataset Items: 2
========================================================

Email #1 | Expected: match    | Best Chunk Dist: 0.3142 (support_guide.pdf #0) | Subject: "Return Policy Inquiry"
Email #2 | Expected: no_match | Best Chunk Dist: 0.7821 (support_guide.pdf #2) | Subject: "Lunch Plans"

--------------------------------------------------------
SUMMARY STATISTICS
--------------------------------------------------------
MATCH group    (n=1): min=0.3142, max=0.3142, avg=0.3142
NO_MATCH group (n=1): min=0.7821, max=0.7821, avg=0.7821

Suggested Threshold: 0.5482 (Clean separation between max match and min no_match)
========================================================
```

Update `RAG_MAX_DISTANCE` in `server/.env` based on the suggested threshold for your specific corpus.

---

## Data Management & Upgrades

### Where Data Lives

- **MongoDB Database** (`mailpilot`):
  - `users`: User profiles, Google OAuth refresh tokens (AES-256-GCM encrypted), routing rules, writing personas, sync state.
  - `emailactions`: Conversation threads, message turns, generated drafts, AI revision history.
  - `processedemails`: Message processing logs, outcomes, delivery timestamps, failure reasons.
  - `knowledgedocuments`: Metadata and chunk counts for uploaded PDFs.
- **LanceDB Vector Store**:
  - Located at `./data/lancedb` relative to the server's working directory (`server/data/lancedb/` when running the server from `server/`, or the path specified by `LANCEDB_PATH` in `server/.env`).
  - Contains `knowledge_chunks.lance` vector tables with embeddings for semantic retrieval.

### Backup & Restore

**MongoDB Backup**:
```bash
mongodump --uri="mongodb://127.0.0.1:27017/mailpilot" --out=./backup
```

**MongoDB Restore**:
```bash
mongorestore --uri="mongodb://127.0.0.1:27017/mailpilot" ./backup/mailpilot
```

**LanceDB Backup & Restore**:
Stop the server, then back up the directory configured by `LANCEDB_PATH` (default relative to server: `server/data/lancedb`):

```bash
# Backup
cp -r server/data/lancedb ./backup/lancedb

# Restore
cp -r ./backup/lancedb server/data/lancedb
```

### Upgrade Procedure

When upgrading across major batches:
1. **Back up** your MongoDB database and `server/data/lancedb` directory.
2. **Preview thread migration** using dry-run mode:
   ```bash
   node server/tools/migrate-email-actions.js --dry-run
   ```
3. **Execute thread migration**:
   ```bash
   node server/tools/migrate-email-actions.js
   ```
4. **Backfill turn summaries** (uses local Ollama to generate summaries for older records):
   ```bash
   node server/tools/backfill-summaries.js
   ```
5. **Backfill processed email outcomes**:
   ```bash
   node server/tools/backfill-processed-outcome.js
   ```
6. **Clean up legacy CC fields** (database hygiene):
   ```bash
   node server/tools/remove-always-cc.js
   ```

### Safe Reset Procedure

> [!WARNING]
> **Duplicate Reply Warning**: Dropping `processedemails` and resetting `gmailHistoryId` causes the next synchronization cycle to treat all messages from the last `CATCHUP_HOURS` (default: 48 hours) as brand new. For any routing rules configured with the `reply` action, **Mailpilot will re-send automated replies, resulting in duplicate emails sent to external recipients.**
> 
> To prevent duplicate replies during a reset:
> 1. Set `CATCHUP_HOURS=1` in `server/.env` before resetting, OR
> 2. Open **Profile & Rules** in the UI and temporarily switch all rule actions from `reply` to `draft`.
> 3. **Never drop `processedemails`** unless you strictly need a complete historical wipe in a non-production test environment. To clear conversation threads and drafts while retaining duplicate-prevention history, drop only `db.emailactions.drop()`.

**Step-by-Step Reset Procedure**:

1. **Set Lookback Window**: In `server/.env`, set `CATCHUP_HOURS=1` (or change rule actions to `draft` in the UI).
2. **Connect to MongoDB**:
   ```bash
   mongosh mailpilot
   ```
3. **Clear Conversation History (Keeping Duplicate Guards)**:
   ```javascript
   // Clear timeline threads and drafts
   db.emailactions.drop();

   // Only drop processedemails if you intentionally want to re-process historical emails:
   // db.processedemails.drop();
   ```
4. **Re-create Unique Indexes**:
   ```bash
   node server/tools/migrate-email-actions.js
   ```
5. **Reset Checkpoint for Target User**:
   > [!NOTE]
   > Running `db.users.updateOne({}, ...)` targets only the first document in the collection. Always target explicitly by the user's email address:
   ```javascript
   db.users.updateOne(
     { email: "your.email@gmail.com" },
     { $set: { gmailHistoryId: null, syncStatus: "idle", syncError: null } }
   );
   ```
6. **Restart & Re-sync**: Start the server. Mailpilot will perform a fresh catchup sync limited to the last hour of mail. Once complete, restore your desired `CATCHUP_HOURS` in `server/.env`.

---

## Privacy & Security

- **100% Local AI**: All inferences and embeddings run on your local machine via Ollama. No email contents or prompts are sent to external cloud AI APIs.
- **Encryption at Rest**: Google OAuth refresh tokens are encrypted in MongoDB using AES-256-GCM with `TOKEN_ENCRYPTION_KEY`.
  > [!TIP]
  > Back up your `server/.env` file. If `TOKEN_ENCRYPTION_KEY` is lost, previously saved tokens cannot be decrypted; you simply sign in again with Google to issue a new token.
- **Localhost Binding**: The Express server binds strictly to `127.0.0.1` by default to prevent unauthorized network exposure.
- **Credential Hygiene**: `.env` files are ignored by git (`.gitignore`). Never commit environment files.
- **Revoking Access**: To revoke Mailpilot's access to your Google account at any time, visit [Google Account Permissions](https://myaccount.google.com/connections) and remove Mailpilot.

---

## Troubleshooting

| Symptom | Probable Cause | Resolution |
| :--- | :--- | :--- |
| `ECONNRESET` or `ETIMEDOUT` to Google APIs | Node.js attempted IPv6 connection to Google endpoints that reset or fail on local network | Set `PREFER_IPV4=true` in `server/.env`. Mailpilot imports `server/config/network.js` on startup which automatically configures Node DNS to prefer IPv4 (`dns.setDefaultResultOrder("ipv4first")`). You can also verify DNS behavior by running `npm run doctor`. |
| Ollama not reachable / model error | Ollama service is not running or required models were not pulled | Start Ollama (`ollama serve`) and run `ollama pull qwen2.5:7b` and `ollama pull embeddinggemma-2:270m`. |
| MongoDB connection failed | MongoDB daemon is stopped or `MONGO_URI` is incorrect | Verify MongoDB is active (`127.0.0.1:27017` or `npm run db:up`) and check `MONGO_URI` in `server/.env`. |
| `invalid_grant` / "Re-login required" | OAuth refresh token was revoked or expired | Click **Re-login required** in the Topbar to authenticate with Google again. |
| Sync stops after exactly 7 days | OAuth app is in "Testing" mode in Google Cloud Console | In Google Cloud Console > OAuth consent screen, set Publishing Status to **In production**. |
| `EADDRINUSE` (Port already in use) | Another process is occupying port 3000 or 5173 | Stop the conflicting process or change `PORT` / `VITE_API_URL` in `.env` files. |
| Emails not being processed | Emails are not in `category:primary`, are older than `CATCHUP_HOURS`, or loop protection engaged | Check that emails arrive in the **Primary** tab of Gmail. Check `CATCHUP_HOURS` in `server/.env`. Check `server/jobs/poll.job.js` loop protection reasons in console logs. |
| "Could not update the Gmail draft" | Draft was deleted or sent in Gmail webmail before Mailpilot saved | Mailpilot's save-first architecture preserves edits locally in MongoDB and offers a one-click "Retry Gmail sync" button. |
| AI outputs placeholders like `[Insert Name]` | Code-specialized model used (e.g. `qwen2.5-coder`) | Switch to standard instruct models like `qwen2.5:7b` via `OLLAMA_LLM_MODEL=qwen2.5:7b`. Mailpilot validation rejects unfilled placeholders. |
| Rate Limit 429 errors | Too many rapid API requests or parallel AI assist calls | Wait a few seconds between operations. AI assist requests enforce concurrency guards. |
| Blank Analytics dashboard | No processed email records or mismatched date boundaries | Select a broader date range in the dashboard picker and run `node server/tools/backfill-processed-outcome.js`. |

---

## Known Limitations

- **Primary Inbox Only**: Synchronization exclusively polls Gmail's `category:primary` inbox. Emails routed to Promotions, Social, Updates, or Spam are ignored.
- **Polling Sync**: Mailpilot operates on a 60-second polling schedule; it does not receive real-time push webhooks.
- **7B Model Quality**: Compact 7B parameter models require clear, direct reference PDF materials. For highly complex reasoning, manual review is recommended.
- **Email Attachments**: Mailpilot processes plain text and HTML email bodies only. Incoming email attachments (images, PDFs, documents) are not parsed, and outgoing drafts/replies do not support attaching files.
- **Single Google Account**: Each user session is linked to one Google account. To manage a different account, log out and sign in with the other address.

---

## Development

### Project Structure

```text
mailpilot0/
|-- data/                         # Root vector storage if tools run from repository root
|-- docs/
|   `-- RELEASE-CHECKLIST.md      # Manual release verification checklist
|-- frontend/
|   |-- src/
|   |   |-- api/                  # Axios HTTP client & auth interceptor
|   |   |-- components/           # Reusable UI components & layouts
|   |   |-- context/              # Authentication & theme context providers
|   |   |-- features/
|   |   |   |-- analytics/        # Performance charts & stats cards
|   |   |   |-- emailActions/     # Draft editor, AI assist modal, turn timeline
|   |   |   |-- knowledge/        # PDF upload, document list & deletion
|   |   |   `-- labels/           # Rule drawer, rules table, quick actions
|   |   |-- hooks/                # Realtime SSE hook, query hooks
|   |   |-- pages/                # Pages: DraftReplyLogPage (Drafts & Replies),
|   |   |                         #        ProfilePage (Profile & Rules),
|   |   |                         #        AnalyticsPage (Analytics),
|   |   |                         #        LoginPage, AuthCallbackPage
|   |   `-- utils/                # Text helpers & formatters
|   |-- .env.example              # Frontend environment template
|   |-- package.json
|   `-- vite.config.js
|-- scripts/
|   |-- setup.js                  # Automated multi-package setup script
|   `-- start.js                  # Production launcher (builds frontend & starts preview)
|-- server/
|   |-- config/                   # db, env validation, lancedb, network, passport, security
|   |-- data/
|   |   `-- lancedb/              # LanceDB vector tables (created relative to server runtime cwd)
|   |-- jobs/                     # Background Gmail sync worker (poll.job.js)
|   |-- middleware/               # JWT authentication middleware
|   |-- models/                   # Mongoose schemas (User, EmailAction, ProcessedEmail, etc.)
|   |-- routes/                   # Express API endpoints
|   |-- scripts/                  # Verification scripts (test-baseline.js, verify-email-format.js)
|   |-- services/                 # AI engine, vectorStore, embeddings, Gmail, reconcile, shutdown
|   |-- tests/                    # Unit and integration test suites
|   |-- tools/                    # Diagnostic & maintenance tools (doctor, check-env-docs,
|   |                             #  migrate-email-actions, backfill-summaries,
|   |                             #  backfill-processed-outcome, rag-distance-report, remove-always-cc)
|   |-- utils/                    # MIME builders, crypto, emailBody formatters
|   |-- .env.example              # Backend environment template
|   |-- app.js                    # Express application entrypoint
|   `-- package.json
|-- start-mailpilot.bat           # Windows one-click launcher (runs npm start)
|-- start-mailpilot.sh            # Linux/macOS launcher (runs npm start)
|-- docker-compose.yml            # MongoDB service container configuration
|-- CHANGELOG.md                  # Detailed version history by batch
|-- fix-plan.md                   # Comprehensive architectural plan and batch tracker
`-- README.md                     # Main documentation guide
```

### Running Tests & Verification

Run the backend test suite:
```bash
npm test
# Or: npm test --prefix server
```

Verify environment variable documentation parity:
```bash
npm run check:env
# Or: npm run check:env --prefix server
```

Run environment and system diagnostics:
```bash
npm run doctor
# Or: npm run doctor --prefix server
```

Build the frontend client for production:
```bash
npm run build
# Or: npm run build --prefix frontend
```

### Commit & Branch Conventions

- Feature and maintenance work follows the batch plan outlined in [`fix-plan.md`](fix-plan.md).
- Commits are scoped per batch with clear test verification steps before closing.
