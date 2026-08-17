# Unfold MCP

An unofficial MCP server for [Fold Money](https://fold.money) that lets you query and analyze your spending data directly from Claude.

There are **two ways to run this**, on two different branches:

| | **Local only** — branch [`local-mcp`](https://github.com/naman0815/unfold-mcp/tree/local-mcp) | **Remote / Render** — branch [`main`](https://github.com/naman0815/unfold-mcp/tree/main) (this branch) |
|---|---|---|
| Works with | Claude Desktop, Claude Code | Claude Desktop, Claude Code, **and** the Claude mobile app + claude.ai (browser) |
| Data storage | Local `db.sqlite` file — never leaves your machine | [Turso](https://turso.tech) (hosted libSQL) — required even if you only run it locally over stdio |
| Fold accounts | One | Multiple, switchable |
| Extra setup | None beyond Node/Go | Free Turso database; a Render deployment if you want mobile/browser access |
| Pick this if | You just want the simplest, fully-offline setup on your own laptop | You want to ask Claude about your spending from your phone/browser, or link more than one Fold account |

Both branches are real and maintained — pick the row that matches what you need, then follow the matching section below. `main` can also be run purely locally (stdio only, no Render, no mobile access) if you just want the multi-account tools — see the note in Option B.

---

## Option A: Local only (`local-mcp` branch)

Fully self-contained: a local SQLite file, one Fold login, no cloud account of any kind. Only reachable from Claude Desktop or Claude Code on the same machine.

### Quick Setup (one prompt)

Create an empty folder, open **Claude Code** inside it, and paste the prompt from [bootstrap_claude_code.md](./bootstrap_claude_code.md). Claude will clone the `local-mcp` branch, install dependencies, build everything, log you in, and configure Claude Desktop automatically. The only things you type are your phone number and the OTP.

### Manual Setup

**Requirements:** Node.js v18+, Go 1.20+, [Claude Desktop](https://claude.ai/download), a Fold account (India only).

**1. Clone and build**

```bash
git clone -b local-mcp https://github.com/naman0815/unfold-mcp.git fold-mcp
cd fold-mcp

# Build the MCP server
cd fold-mcp && npm install && npm run build && cd ..

# Build the Go CLI
cd unfold_cli && go build -o ../unfold_patched . && cd ..
```

> **No build tools required.** `npm install` downloads a pure WebAssembly SQLite — no Xcode, no native compilation.

**2. Log in to Fold**

```bash
./unfold_patched login
```

You'll be prompted for your phone number and an OTP. Tokens are stored at `~/.config/unfold/config.yaml`.

**3. Configure Claude Desktop**

Find your config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `fold` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "fold": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/fold-mcp/fold-mcp/build/index.js"]
    }
  }
}
```

Use the full path to `node` (run `which node` on macOS or `(Get-Command node).Source` on Windows). A bare `"node"` won't work because Claude Desktop doesn't inherit your shell's PATH.

Quit and relaunch Claude Desktop to pick up the new config.

**4. Sync your transaction history**

Ask Claude: *"Sync my Fold data from 2021-01-01 to today"*. Each year syncs in about 10 seconds and up to 3 years run in parallel.

**Staying up to date:** `git pull` then `cd fold-mcp && npm run build`, or just ask Claude *"Are there any updates available?"* — `check_for_updates` checks GitHub and tells you the exact command to run.

---

## Option B: Remote / Render (`main` branch — this branch)

This branch replaces the local SQLite file with a Turso (hosted libSQL) database, adds an HTTP transport with OAuth 2.1 + PKCE + Dynamic Client Registration, and supports multiple linked Fold accounts. That combination is what lets Claude on your phone or in the browser reach it — not just Claude Desktop/Code on your laptop.

**Requirements:** Node.js v18+, Go 1.20+, a [Turso](https://turso.tech) account (free tier is enough), a Fold account (India only). A [Render](https://render.com) account too, only if you want mobile/browser access.

### 1. Clone and build

```bash
git clone https://github.com/naman0815/unfold-mcp.git fold-mcp
cd fold-mcp

cd fold-mcp && npm install && npm run build && cd ..
cd unfold_cli && go build -o ../unfold_patched . && cd ..
```

### 2. Create the Turso database

```bash
turso db create fold-mcp
turso db show fold-mcp                       # note the URL
turso db tokens create fold-mcp               # note the auth token
turso db shell fold-mcp < fold-mcp/schema/turso.sql
```

### 3. Configure environment variables

```bash
cp fold-mcp/.env.example fold-mcp/.env
```

Fill in `fold-mcp/.env`:

| Variable | Needed for | Value |
|---|---|---|
| `TURSO_DATABASE_URL` | Always | from `turso db show` |
| `TURSO_AUTH_TOKEN` | Always | from `turso db tokens create` |
| `MCP_SHARED_PASSWORD` | HTTP/mobile/browser only | a password you pick — gates the OAuth sign-in page |
| `PUBLIC_BASE_URL` | HTTP/mobile/browser only | `http://localhost:3000` locally, or `https://<your-service>.onrender.com` on Render |
| `PORT` | HTTP/mobile/browser only | `3000` locally; Render sets this automatically |

### 4a. Run it locally (stdio — Claude Desktop / Claude Code)

You still don't need Render or `MCP_SHARED_PASSWORD`/`PUBLIC_BASE_URL` for this — only the two `TURSO_*` variables are read outside HTTP mode. Point Claude Desktop's config at the same `build/index.js`, but pass the Turso variables through `env` since there's no local file for them to live in otherwise:

```json
{
  "mcpServers": {
    "fold": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/fold-mcp/fold-mcp/build/index.js"],
      "env": {
        "TURSO_DATABASE_URL": "libsql://...",
        "TURSO_AUTH_TOKEN": "..."
      }
    }
  }
}
```

Then in Claude, link an account and sync — there's no `unfold_patched login` step here, it's done through tools instead:

> Add my Fold account with phone number +91XXXXXXXXXX, then send me the OTP prompt

Claude calls `add_fold_account` then `verify_fold_account_otp` once you give it the OTP. Repeat `add_fold_account` for a second phone number to link another account, and use `set_active_fold_account` / the `account` argument on tools to switch between them.

### 4b. Deploy to Render (for Claude mobile / claude.ai)

1. Push this repo (or your fork) to GitHub if you haven't.
2. In Render: **New → Web Service**, connect the repo, branch `main`. Render will detect the `Dockerfile` automatically — no build/start command needed.
3. Add the environment variables from the table above (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `MCP_SHARED_PASSWORD`, `PUBLIC_BASE_URL` set to your Render URL once you know it — you can redeploy after the first deploy to fill this in).
4. Deploy. Confirm it's up: `curl https://<your-service>.onrender.com/healthz` should return `{"status":"ok"}`.
5. In Claude (mobile app or claude.ai): **Settings → Connectors → Add custom connector**, and enter `https://<your-service>.onrender.com/mcp` as the URL. Claude will register itself (DCR) and redirect you to a sign-in page — enter the `MCP_SHARED_PASSWORD` you set above.
6. From there, ask Claude to add your Fold account the same way as in 4a (`add_fold_account` → OTP → `verify_fold_account_otp`), then sync.

> Free Render web services spin down when idle and take ~30-60s to wake on the first request after a while — expect a slow first message after inactivity.

---

## Available Tools

**Data & sync**

| Tool | What it does |
|---|---|
| `get_sync_status` | Check how fresh your data is before asking questions |
| `sync_fold_data` | Pull transactions from Fold into the database |
| `check_for_updates` | Check if a newer version of fold-mcp is available on GitHub |

**Transactions**

| Tool | What it does |
|---|---|
| `get_recent_transactions` | Get the most recent N transactions |
| `search_transactions` | Filter by merchant, narration, tag, date range, amount, mode, or type |
| `full_text_search` | Fast FTS5 search across all text fields — finds any word in merchant, narration, or summary |

**Spending analysis**

| Tool | What it does |
|---|---|
| `get_spending_summary` | Income vs spending with top merchants and daily average |
| `get_merchant_summary` | Top merchants by total spend or transaction count |
| `get_monthly_trend` | Month-by-month income, spending, and net cash flow |
| `get_balance_history` | Average account balance by month |
| `get_spending_by_mode` | Breakdown by payment mode (CARD, UPI, NEFT, etc.) |
| `get_category_breakdown` | Spending grouped into categories: Food Delivery, Transport, Shopping, etc. |
| `get_unusual_transactions` | Charges that are way above your normal spend at a merchant |
| `get_recurring_merchants` | Subscriptions and habits — merchants you pay month after month |
| `compare_periods` | Side-by-side comparison of two date ranges (e.g. this month vs last) |
| `get_spending_forecast` | Projected month-end total based on your pace so far |
| `get_account_breakdown` | Per-bank-account income, spending, and transaction count |
| `get_day_of_week_patterns` | Which days of the week (or month) you spend the most |

**Routines & check-ins**

| Tool | What it does |
|---|---|
| `get_weekly_digest` | 7-day summary vs your rolling average, with unusual charge alerts |
| `get_tax_year_report` | Full April–March financial year report (income, spending, savings rate) |
| `get_spending_streak` | How many consecutive days you've stayed under a daily spending limit |

**Multi-account management — `main` branch only**

| Tool | What it does |
|---|---|
| `list_fold_accounts` | List all linked Fold accounts and which one is active |
| `add_fold_account` | Link a new Fold account by phone number and send it an OTP |
| `verify_fold_account_otp` | Complete login for a newly linked account with the OTP |
| `set_active_fold_account` | Switch which linked account tools operate on by default |

### Example questions to ask Claude

- "What did I spend last month?"
- "How much have I spent on Swiggy this year?"
- "Show me my top 10 merchants since January"
- "Is my data up to date?"
- "Give me my weekly digest"
- "Are there any unusual charges in the last 3 months?"
- "Show me my FY 2024-25 report"
- "Break my spending down by category for this month"
- "How's my spending streak this week?"
- "Are there any updates available?"
- "Find any transaction mentioning 'coffee'"
- "Search for 'salary HDFC' across all my transactions"
- "Which subscriptions am I paying every month?"
- "Compare this month's spending vs last month"
- "Am I on track with my spending this month?"
- "Which day of the week do I spend the most?"

---

## How it works

**Option A — `local-mcp`:**

```
Claude Desktop
    |
    | MCP (stdio)
    v
fold-mcp/build/index.js      — Node.js process, read-only SQLite access
    |
    +-- SQLite reads -------> db.sqlite
    |
    +-- shell exec ---------> unfold_patched transactions -d --since X --till Y
                                    |
                                    | HTTPS (Bearer token)
                                    v
                              api.fold.money
                                    |
                                    v
                              db.sqlite  (upsert by transaction UUID)
```

The MCP server only reads from SQLite. All writes go through the Go CLI, which handles auth token refresh automatically before every sync.

**Option B — `main`:**

```
Claude Desktop/Code (stdio)         Claude mobile / claude.ai (HTTPS + OAuth)
        |                                        |
        |                                        v
        |                              Render: fold-mcp/build/index.js
        |                                        |  (mcpAuthRouter, bearer auth,
        v                                        |   MCP_SHARED_PASSWORD gate)
fold-mcp/build/index.js  <-----------------------+
    |
    +-- libSQL reads/writes ---> Turso (fold_accounts, transactions, oauth_*)
    |
    +-- shell exec, per account -> unfold_patched transactions -d --config <tmp>.yaml
                                            |
                                            | HTTPS (Bearer token)
                                            v
                                      api.fold.money
                                            |
                                            v
                                Turso (upsert by fold_account_id + transaction UUID)
```

Every tool call resolves which linked Fold account it's for, then reads/writes Turso scoped to that account — the same database backs both the stdio and HTTP entry points.

---

## Privacy

**Option A (`local-mcp`):**
- Everything runs locally. No data is sent to any third-party service.
- `db.sqlite` is gitignored and never leaves your machine.
- Auth tokens live at `~/.config/unfold/config.yaml`, scoped to your OS user.
- If you share a Claude account with others, they cannot see your spending data because MCP servers run locally on each person's own computer.

**Option B (`main`):**
- Transaction data and Fold auth tokens live in your own Turso database, not a third party's — but it is a cloud database, not your local disk.
- If deployed to Render, that database is reachable from anywhere Claude can reach the internet; `MCP_SHARED_PASSWORD` plus per-client OAuth tokens are what gate access to it.
- Anyone who knows your shared password and connector URL can read your data — treat it like any other account password.

## Credits
- [Fold Money](https://fold.money) for their Account Aggregator integration
- [Unfold](https://github.com/wantguns/unfold) for the CLI.
