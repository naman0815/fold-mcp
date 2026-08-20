# Unfold MCP

An unofficial MCP server for [Fold Money](https://fold.money) that lets you ask Claude about your spending, investments, and net worth directly — no spreadsheets, no exporting data by hand.

There are two ways to set it up. Pick whichever matches what you want:

| | **Setup 1: Local Only** | **Setup 2: Local, Mobile, and Browser** |
|---|---|---|
| Works with | Claude Desktop app, Claude Code (on this computer only) | All of that, **plus** the Claude app on your phone and claude.ai in any browser |
| Your data lives | A file on your own computer — never sent anywhere else | A private database you own (free tier), so it's reachable from your phone too |
| Fold accounts | One | More than one, if you want |
| Setup time | ~5 minutes, nothing to sign up for | ~10 minutes, one free account to create |
| Pick this if | You just want to ask Claude about your money on your laptop | You want that from your phone too, or need more than one Fold account |

Not sure? Start with **Setup 1** — it's simpler, and you can always add Setup 2 on top later without redoing anything.

---

## Setup 1: Local Only (Desktop and Code CLI)

Everything runs on your computer. No accounts to create beyond Fold itself, nothing sent to any other service.

### If you're not a developer (recommended)

1. Create a new empty folder on your computer.
2. Open **Claude Code** inside that folder. (Don't have it? [Get it here](https://claude.ai/download) — it's Claude's terminal app.)
3. Open [bootstrap_claude_code.md](./bootstrap_claude_code.md), copy the whole prompt block, and paste it into Claude Code.
4. Claude does everything else — installing what it needs, building the project, connecting to Claude Desktop. You'll only be asked for two things: your phone number, and the OTP code Fold texts you.

That's it. Once it's done, open Claude Desktop and ask something like *"Sync my Fold data from 2021-01-01 to today."*

### If you'd rather run the commands yourself

**Requirements:** Node.js v18+, Go 1.20+, [Claude Desktop](https://claude.ai/download), a Fold account (India only).

**1. Clone and build**

```bash
git clone https://github.com/naman0815/unfold-mcp.git fold-mcp
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

## Setup 2: Local, Mobile, and Browser

Same server, pointed at a small free cloud database instead of a local file — that's what lets Claude's phone app and browser reach it, and lets you link more than one Fold account. Everything from Setup 1 still works exactly the same.

This has two parts, and you only need the second one if you actually want phone/browser access:

- **Part A — multi-account, still on your computer:** creates your free database and switches Claude Desktop/Code over to it. Mostly automatic.
- **Part B — phone and browser access (optional):** deploys a copy of the server to a free hosting service ([Render](https://render.com)) so it's reachable from anywhere. This part genuinely can't be fully automated (creating a Render account requires you, in a browser), but it's a single click, not a manual walkthrough.

### Part A: Multi-account setup

#### If you're not a developer (recommended)

1. Create a new empty folder on your computer.
2. Open **Claude Code** inside that folder.
3. Open [bootstrap_claude_code_remote.md](./bootstrap_claude_code_remote.md), copy the prompt block, and paste it into Claude Code.
4. Claude does everything, including creating your free database — the one thing it can't do for you is one login click in a browser tab that pops up (that's how the database provider's login works). Then it'll ask for your phone number and OTP, same as Setup 1.

#### If you'd rather run the commands yourself

**Additional requirements:** Node.js v18+, Go 1.20+, a [Turso](https://turso.tech) account (free tier is enough).

**1. Clone and build** — same as Setup 1's manual steps above (clone, `npm install && npm run build`, build the Go CLI).

**2. Create the Turso database**

```bash
turso db create fold-mcp
turso db show fold-mcp                       # note the URL
turso db tokens create fold-mcp               # note the auth token
turso db shell fold-mcp < fold-mcp/schema/turso.sql
```

**3. Configure environment variables**

```bash
cp fold-mcp/.env.example fold-mcp/.env
```

Fill in `fold-mcp/.env`:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | from `turso db show` |
| `TURSO_AUTH_TOKEN` | from `turso db tokens create` |

(Leave `MCP_SHARED_PASSWORD` and `PUBLIC_BASE_URL` blank for now — those are only for Part B below.)

**4. Configure Claude Desktop**, same as Setup 1 but with the Turso credentials passed through `env` since there's no local config file for them to live in otherwise:

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

**5. Link your Fold account(s)** — there's no `unfold_patched login` step here, it's done through Claude instead:

> Add my Fold account with phone number +91XXXXXXXXXX, then send me the OTP prompt

Claude calls `add_fold_account` then `verify_fold_account_otp` once you give it the OTP. Repeat for a second phone number to link another account, and use `set_active_fold_account` (or the `account` argument on any tool) to switch between them.

### Part B: Add phone and browser access (optional)

Only do this if you actually want to reach your data from Claude's mobile app or claude.ai — Part A alone already gives you multi-account support on your laptop.

1. Click the button below. Render will ask you to sign in (or create a free account) and will fork this repo into your own GitHub automatically — you don't need to push anything yourself first.

   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/naman0815/unfold-mcp)

2. When prompted, paste in the two Turso values from Part A, plus a password of your choosing (this is what gates who can sign in to your server — pick something real, you'll type it once when connecting Claude). Nothing else needs configuring — port, transport mode, and the server's own URL are all handled automatically.
3. Render builds and deploys. Once it's live, confirm: `curl https://<your-service>.onrender.com/healthz` should return `{"status":"ok"}`.
4. In Claude (mobile app or claude.ai): **Settings → Connectors → Add custom connector**, and enter `https://<your-service>.onrender.com/mcp` as the URL. Claude will redirect you to a sign-in page — enter the password you set in step 2.
5. Ask Claude to add your Fold account the same way as in Part A (`add_fold_account` → OTP → `verify_fold_account_otp`), then sync.

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

**Investments — mutual funds, stocks, EPF, NPS, PPF, fixed deposits**

Live-fetched from Fold on every call (not synced to a database) — always reflects the current NAV/price, not a stale snapshot.

| Tool | What it does |
|---|---|
| `get_investments_summary` | One-shot net-worth view across all linked investments |
| `get_mutual_funds` | Per-scheme holdings: units, value, invested amount, gain/loss, XIRR |
| `get_stock_holdings` | Per-stock demat holdings: units, last traded price, value |
| `get_epf_balance` | Current EPF balance: UAN, employer/employee/pension split, interest rate |
| `get_epf_history` | Year-wise EPF contribution and interest history |
| `get_nps_accounts` | Linked NPS accounts and their value |
| `get_ppf_accounts` | Linked PPF accounts and their balance |
| `get_fixed_deposits` | Active and archived fixed deposits: principal, maturity amount, interest |
| `get_net_worth` | Total net worth across all linked sources, and its 30-day change |
| `get_mutual_fund_refresh_status` | When your MF holdings were last pulled from CAMS/KFintech and when you're next eligible (Fold enforces a cooldown — 14 days free, 5 days Plus) — does not trigger a pull |
| `explain_mutual_fund_performance` | Beginner-friendly per-scheme verdict: is each fund beating or lagging its benchmark |
| `explain_portfolio_health` | Beginner-friendly read on concentration risk, asset mix, and overall returns vs benchmark |

**Multi-account management — only appears if you've done Setup 2**

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
- "What's my total net worth right now?"
- "How are my mutual funds doing — am I beating the market?"
- "Is my portfolio healthy or too concentrated in one place?"
- "What's my EPF balance?"
- "When can I next refresh my mutual fund data?"

---

## How it works

Storage is picked automatically at startup, with no flag to remember: if you've done Setup 2 (Turso credentials are present), the server uses Turso; otherwise it defaults to a local SQLite file (Setup 1). Everything below describes Setup 1's path first, then what changes for Setup 2.

**Setup 1 (local):**

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

The MCP server only reads from SQLite. All writes go through the Go CLI, which handles auth token refresh automatically before every sync. Investment tools (mutual funds, stocks, EPF, NPS, PPF, fixed deposits) don't touch SQLite at all — each call shells out to `unfold_patched investments --json`, which hits Fold live and returns a fresh snapshot straight to Claude.

**Setup 2 (Turso, optionally + Render):**

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

Every tool call resolves which linked Fold account it's for, then reads/writes Turso scoped to that account — the same database backs both the stdio and HTTP entry points. Investment tools skip Turso entirely — each call materializes that account's temp config, shells out to `unfold_patched investments --json` for a live snapshot, and returns it directly; nothing is persisted.

---

## Privacy

**Setup 1 (local):**
- Everything runs locally. No data is sent to any third-party service.
- `db.sqlite` is gitignored and never leaves your machine.
- Auth tokens live at `~/.config/unfold/config.yaml`, scoped to your OS user.
- If you share a Claude account with others, they cannot see your spending data because MCP servers run locally on each person's own computer.

**Setup 2 (Turso, optionally + Render):**
- Transaction data and Fold auth tokens live in your own Turso database, not a third party's — but it is a cloud database, not your local disk.
- If deployed to Render, that database is reachable from anywhere Claude can reach the internet; the shared password you set plus per-client OAuth tokens are what gate access to it.
- Anyone who knows your shared password and connector URL can read your data — treat it like any other account password.

---

## Credits
- [Fold Money](https://fold.money) for their Account Aggregator integration
- [Unfold](https://github.com/wantguns/unfold) for the CLI.
