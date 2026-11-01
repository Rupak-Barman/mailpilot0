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
git clone <repository-url>
cd mailpilot-email-agent-main

# Run automated idempotent setup (installs server & frontend dependencies and creates .env files)
npm run setup
```

### 2. Configure Environment Files

The setup script automatically copies `.env.example` templates to `server/.env` and `frontend/.env` if missing. Ensure your credentials are populated:
- `server/.env`: Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `MONGO_URI`.
- `frontend/.env`: Defaults to `VITE_API_URL=http://localhost:3000`.

### 3. Pull Required Ollama Models

Ensure Ollama is installed and running (`ollama serve`), then pull the exact models configured in `.env.example`:

```bash
ollama pull qwen2.5:7b
ollama pull embeddinggemma-2:270m
```

### 4. Configure Google Cloud Credentials

Follow the [Google OAuth Setup](#google-oauth-setup) guide below, then fill in your credentials in `server/.env`:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `MONGO_URI` (default: `mongodb://127.0.0.1:27017/mailpilot`)

### 5. Start MongoDB

Start MongoDB locally or spin it up via Docker Compose:
```bash
# Using Docker Compose (recommended)
npm run db:up

# Or via local system services:
# Windows: net start MongoDB
# macOS:   brew services start mongodb-community
# Linux:   sudo systemctl start mongod
```

### 6. Verify System Health (Doctor)

Run the automated diagnostic doctor to verify Node version, MongoDB reachability, Ollama models, and ports:
```bash
npm run doctor
```

### 7. Start Application

Start both backend and frontend development servers concurrently with live reload:
```bash
npm run dev
```

Or run in production mode (automatically builds the frontend if needed and runs the server with frontend preview):
```bash
npm start
```

Open your browser at **`http://localhost:5173`** and click **Sign in with Google**.

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
     - `http://localhost:3000/auth/google/callback` *(Ensure this matches the redirect URI printed by the server on startup: `<BASE_URL>/auth/google/callback`)*.
   - Click **Create** and copy your **Client ID** and **Client Secret**.
6. **Save Credentials**:
   - Paste the values into `server/.env`:
     ```env
     GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret_here
     ```

### Scopes Explained in Plain Words

Mailpilot requests only the minimal permissions required for operation:
- `profile` and `email`: Identifies your account and displays your user email address.
- `https://www.googleapis.com/auth/gmail.modify`: Allows reading incoming emails, applying labels, and marking processed messages as read.
- `https://www.googleapis.com/auth/gmail.compose`: Creates, updates, and deletes draft replies in your Gmail Drafts folder.
- `https://www.googleapis.com/auth/gmail.send`: Sends automated replies or manual responses when you click "Send" in the app.

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

1. **Scheduled Polling**: Every minute (`*/1 * * * *`), the background sync worker runs for all connected users.
2. **History Checkpoint**:
   - On the initial run, Mailpilot scans emails received within the lookback window (`CATCHUP_HOURS`, default: 48h).
   - On subsequent runs, it queries `gmail.users.history.list` using the stored `gmailHistoryId` checkpoint.
3. **Primary Category Only**: Mailpilot only inspects emails categorized under Gmail's **Primary** inbox (`category:primary`). Promotions, Social, Forums, and Updates tabs are bypassed.
4. **Oldest-First Processing**: Unread messages are sorted chronologically ascending so conversation context builds naturally.
5. **Batch Constraints**: Each poll cycle processes up to `MAX_PER_RUN` (default: 25) messages per user to maintain low memory usage and avoid API quota exhaustion.
6. **Safety & Loop Protection**:
   - Messages sent from the user's own email address are skipped immediately.
   - Reply chains are tracked: if Mailpilot detects potential loop storms, processing is aborted.
   - Daily limit: Up to `DAILY_REPLY_CAP` (default: 50) automated replies per UTC day.
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

When a routing rule is set to **Strict** grounding, Mailpilot embeds the incoming email text and searches the assigned knowledge base in LanceDB. If the best passage distance exceeds `RAG_MAX_DISTANCE` (default: `0.5`), the retrieval engine determines that the documents do not contain reliable source material. Rather than inventing facts or hallucinating specifics, Mailpilot safely flags the email as `needs_manual`.

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
| `LANCEDB_PATH` | Server | Optional | `./data/lancedb` | Local directory for storing LanceDB vector tables. |
| `RAG_MAX_DISTANCE` | Server | Optional | `0.5` | Maximum L2 distance cutoff for knowledge document chunk matches. |
| `DAILY_REPLY_CAP` | Server | Optional | `50` | Maximum number of automated replies per user per UTC day. |
| `GROUP_WINDOW_DAYS` | Server | Optional | `14` | Lookback window (in days) to group follow-ups from the same sender. |
| `CATCHUP_HOURS` | Server | Optional | `48` | Lookback window (in hours) for initial mailbox synchronization. |
| `MAX_PER_RUN` | Server | Optional | `25` | Maximum unread emails processed per user in one sync cycle. |
| `PREFER_IPV4` | Server | Optional | `true` | Forces Node DNS resolution to prefer IPv4 over IPv6 to prevent ECONNRESET. |
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
> **Manual CC & BCC Policy**: In earlier versions, `alwaysCc` on labels and `defaultCc` on user accounts existed. These were intentionally **removed in Batch 5.9** to prevent unintended data exposure. CC and BCC recipients are added manually in the draft editor or composer.

### User Settings

- **Group by Sender**: When enabled, incoming emails that lack explicit RFC threading headers (`In-Reply-To` / `References`) but share the same sender within `GROUP_WINDOW_DAYS` (default: 14 days) are automatically grouped into the same conversation thread timeline.

---

## Calibrating RAG_MAX_DISTANCE

The vector search threshold `RAG_MAX_DISTANCE` controls how closely a document passage must match an email before Mailpilot accepts it as valid knowledge.

Mailpilot includes an offline calibration report tool: `server/tools/rag-distance-report.js`.

### 1. Create Evaluation Dataset

Create a JSON file (e.g. `eval-dataset.json`) containing representative test cases:

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

Execute the tool against a target label:

```bash
node server/tools/rag-distance-report.js eval-dataset.json "Support"
```

### 3. Interpreting Output

The report runs queries against the documents attached to the specified rule and outputs:
- **Per-email distance**: The L2 distance of the closest document chunk.
- **Match range**: The highest distance observed for queries marked `"expected": "match"`.
- **No-match range**: The lowest distance observed for queries marked `"expected": "no_match"`.
- **Suggested Threshold**: A calculated cutoff separating valid answers from irrelevant noise.

Update `RAG_MAX_DISTANCE` in `server/.env` based on the suggested threshold (typically between `0.40` and `0.55`).

---

## Data Management & Upgrades

### Where Data Lives

- **MongoDB Database** (`mailpilot`):
  - `users`: User profiles, Google OAuth refresh tokens (encrypted), routing rules, personas, sync state.
  - `emailactions`: Conversation threads, message turns, generated drafts, AI revision history.
  - `processedemails`: Processed message audit logs, delivery status, outcomes, failure reasons.
  - `knowledgedocuments`: Metadata and chunk counts for uploaded PDFs.
- **LanceDB Vector Store** (`./data/lancedb/`):
  - `knowledge_chunks.lance`: Local vector tables containing embeddings for semantic search.

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
Simply copy or restore the `./data/lancedb` directory while the server is stopped.

### Upgrade Procedure

When upgrading from previous versions:
1. **Back up** your MongoDB database and `./data/lancedb` directory.
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
6. **Clean up legacy CC fields** (optional database hygiene):
   ```bash
   node server/tools/remove-always-cc.js
   ```

### Safe Reset Procedure

To clear synchronization history and re-sync mail without losing your routing rules or uploaded knowledge documents:
1. Connect to MongoDB shell: `mongosh mailpilot`
2. Drop transaction collections:
   ```javascript
   db.emailactions.drop();
   db.processedemails.drop();
   ```
3. Re-create unique indexes by running the migration script:
   ```bash
   node server/tools/migrate-email-actions.js
   ```
4. Reset your user account's sync checkpoint:
   ```javascript
   db.users.updateOne({}, { $set: { gmailHistoryId: null, syncStatus: "idle", syncError: null } });
   ```
5. On the next poll cycle, Mailpilot will perform a fresh catchup sync spanning `CATCHUP_HOURS` (default: 48h).

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
| `ECONNRESET` or `ETIMEDOUT` to Google APIs | Node.js attempted IPv6 connection to Google endpoints that fail or reset on local network | Set `PREFER_IPV4=true` in `server/.env` and ensure Node is started with `--dns-result-order=ipv4first` (included in `npm run dev` and `npm start`). |
| Ollama not reachable / model error | Ollama service is not running or required models were not pulled | Start Ollama (`ollama serve`) and run `ollama pull qwen2.5:7b` and `ollama pull embeddinggemma-2:270m`. |
| MongoDB connection failed | MongoDB daemon is stopped or `MONGO_URI` is incorrect | Verify MongoDB is active (`127.0.0.1:27017`) and check `MONGO_URI` in `server/.env`. |
| `invalid_grant` / "Re-login required" | OAuth refresh token was revoked or expired | Click **Re-login required** in the Topbar to authenticate with Google again. |
| Sync stops after exactly 7 days | OAuth app is in "Testing" mode in Google Cloud Console | In Google Cloud Console > OAuth consent screen, set Publishing Status to **In production**. |
| `EADDRINUSE` (Port already in use) | Another process is occupying port 3000 or 5173 | Stop the conflicting process or change `PORT` / `VITE_API_URL` in `.env` files. |
| Emails not being processed | Emails are not in `category:primary`, are older than `CATCHUP_HOURS`, or loop protection engaged | Check that emails arrive in the **Primary** tab of Gmail. Check `CATCHUP_HOURS` in `server/.env`. |
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
mailpilot-email-agent-main/
|-- data/
|   `-- lancedb/                  # LanceDB vector tables
|-- frontend/
|   |-- src/
|   |   |-- api/                  # Axios HTTP client & interceptors
|   |   |-- components/           # Reusable UI components & layouts
|   |   |-- context/              # Authentication & theme context providers
|   |   |-- features/
|   |   |   |-- emailActions/     # Draft editor, AI assist panel, timeline
|   |   |   |-- labels/           # Rule drawer, rules table, delete modal
|   |   |   |-- knowledge/        # PDF upload, document list
|   |   |   `-- analytics/        # Performance charts & stats cards
|   |   |-- hooks/                # Realtime SSE hook, query hooks
|   |   |-- pages/                # App pages (Inbox, Rules, Knowledge, Analytics)
|   |   `-- utils/                # Text helpers & formatters
|   |-- .env.example              # Frontend environment template
|   |-- package.json
|   `-- vite.config.js
|-- server/
|   |-- config/                   # Database, environment, security, passport
|   |-- jobs/                     # Background poll & sync worker (poll.job.js)
|   |-- middleware/               # JWT authentication middleware
|   |-- models/                   # Mongoose schemas (User, EmailAction, etc.)
|   |-- routes/                   # Express API endpoints
|   |-- services/                 # AI engine, RAG, Gmail, Reconcile, SSE bus
|   |-- tests/                    # Node test runner unit & integration suites
|   |-- tools/                    # Migration, backfill, calibration & env check scripts
|   |-- utils/                    # MIME builders, crypto, emailBody formatters
|   |-- .env.example              # Backend environment template
|   |-- app.js                    # Express application entrypoint
|   `-- package.json
|-- CHANGELOG.md                  # Detailed version history by batch
|-- fix-plan.md                   # Comprehensive architectural plan and batch tracker
`-- README.md                     # Main documentation guide
```

### Running Tests & Verification

Run the full backend test suite:
```bash
npm test
# Or: npm --prefix server test
```

Verify that environment variables match code and documentation:
```bash
npm run check:env
# Or: npm --prefix server run check:env
```

Build the frontend client for production:
```bash
npm run build
# Or: npm --prefix frontend run build
```

Run environment and service diagnostics:
```bash
npm run doctor
```

### Commit & Branch Conventions

- Feature and maintenance work follows the batch plan outlined in [`fix-plan.md`](file:///c:/Users/barma/Desktop/sem%207/sendora-email-agent-main%20-%20Copy/mailpilot-email-agent-main/fix-plan.md).
- Commits are scoped per batch with clear test verification steps before closing.
