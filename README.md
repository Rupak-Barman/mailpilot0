# Mailpilot – AI Email Agent

Mailpilot is an autonomous AI assistant and co-pilot for Gmail. It classifies incoming emails, retrieves domain knowledge from your uploaded PDF documents (RAG via LanceDB and embeddings), and generates contextual drafts or replies using local Ollama LLMs with human review and oversight.

---

## Routing Rules and Label Settings

Routing rules let you automate how incoming emails are classified, drafted, and answered.

### 1. Configuration & Rules Drawer
Rules are managed in **Profile & Rules > Routing Rules**. Instead of cumbersome inline tables, clicking **Add rule** or clicking **Edit** on an existing rule opens a streamlined side drawer with five logical sections:
- **Rule Details**:
  - **Name**: Required (1–40 characters), auto-trimmed, and strictly unique across your rules (case-insensitive).
  - **Colour**: Pick from an 8-swatch accessible color palette to easily recognize rules in your dashboard.
- **Action Selection**:
  - **None**: Only labels and categorizes the email. No AI drafting or automated sending takes place.
  - **Draft**: AI generates a contextual reply and saves it directly to your Gmail Drafts folder for your review.
  - **Reply**: AI generates a contextual reply and automatically sends it via Gmail.
- **Writing Style**:
  - **Tone**: Choose from *Friendly*, *Formal*, or *Casual*.
  - **Persona**: Select a custom writing persona (with unique instructions and signature) or use your account default persona.
- **Answer from My Documents**:
  - **Grounding Mode**:
    - *Strict*: The model will answer questions only when supported by matching passages from your uploaded documents. If no relevant information is found, the turn is flagged for manual reply.
    - *Flexible*: The model is permitted to generate polite acknowledgements and general guidance even if documents do not contain a match.
  - **Knowledge Bases**: Multi-select documents with instant search and checkboxes to scope retrieval to specific files.
- **Automation & Status**:
  - **Mark as read in Gmail**: Automatically marks matching incoming emails as read in your inbox.
  - **Active Status**: Enable or disable the rule at any time.

### 2. Smart Behavior & Safety Warnings
- **Action "None" Smart Disabling**: When a rule's action is set to **None**, writing style (tone, persona) and document grounding fields are automatically hidden or disabled, clearly marked with *"Writing style and document knowledge bases are not used when the action is None"*. Your previously configured selections are preserved in the background.
- **Grounding Defaults**: Defaults to *Strict* when one or more knowledge bases are attached, and *Flexible* when none are selected.
- **Inline Safety Warnings** (non-blocking):
  - *Strict without documents*: Warns that every incoming email will require a manual reply.
  - *Reply with Flexible*: Warns that automatic replies will go out without checking your documents.

### 3. Inline Quick Edits & Responsive Layout
- **Inline Edits**: In the desktop table, you can quickly change a rule's **Action** (None / Draft / Reply) and toggle its **Status** directly. All quick edits show a saving indicator and toast feedback, and automatically roll back on network or server errors.
- **Document Chips**: Knowledge bases are displayed as readable chips with document names and a `+N more` overflow badge.
- **Responsive Mobile Cards**: On mobile viewports down to 360px, rules display as self-contained cards with full actions and no horizontal page scroll.

### 4. Rule Deletion & Gmail Label Behavior
When deleting a routing rule:
- The routing rule is permanently removed from Mailpilot.
- The corresponding label is deleted from your Gmail account.
- Existing emails in your Gmail inbox are **not** deleted; they simply lose the label.
- Future incoming emails will no longer be classified or routed by this rule.

### 5. Manual CC & BCC Policy (No Automatic CC)
Mailpilot does **not** automatically CC any addresses on generated drafts or replies.
- All CC and BCC recipients are added manually by the user in the draft editor or composer.
- When an incoming thread contains additional recipients (reply-all), Mailpilot extracts them into `suggestedCc` and offers a one-click **"Add reply-all recipients"** button in the composer.
- Automatic CC features (`alwaysCc` and `defaultCc`) have been completely removed to avoid accidental data leakage.

---

## Local Development & Setup

### Prerequisites
- Node.js (v18+)
- MongoDB (local or Atlas)
- Ollama with models:
  ```bash
  ollama pull qwen2.5:7b
  ollama pull embeddinggemma-2:270m
  ```

### Backend Setup
```bash
cd server
npm install
npm test
npm start
```

### Frontend Setup
```bash
cd frontend
npm install
npm run build
npm run dev
```

### Database Cleanup Tool
To clean up legacy `alwaysCc` and `defaultCc` fields from MongoDB:
```bash
# Dry run to inspect counts
node server/tools/remove-always-cc.js --dry-run

# Execute idempotent migration
node server/tools/remove-always-cc.js
```
