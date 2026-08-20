# Fold AI — Zero-Touch Setup (Multi-account / Remote)

This sets up the **multi-account** version — the same local Claude Desktop/Code
experience as the basic setup, but backed by a free [Turso](https://turso.tech)
database instead of a local file, so you can link more than one Fold account.

Use [bootstrap_claude_code.md](./bootstrap_claude_code.md) instead if you only
need one Fold account and don't care about linking a second one or reaching
Claude from your phone/browser — it's simpler and needs no external account.

**One step in here can't be automated:** creating your Turso account requires
one browser login click (Turso's signup is OAuth-based) — everything else,
including creating the database itself, is scripted.

This gets you multi-account support on Claude Desktop/Code. If you *also* want
to reach your data from Claude's mobile app or claude.ai in a browser, that's a
separate, optional step after this one — see "Setup 2: Local, Mobile, and
Browser" in the main [README](./README.md#setup-2-local-mobile-and-browser),
which uses a one-click Render deploy button rather than more terminal steps.

## How to Set Up

1. Create a new empty folder anywhere on your computer.
2. Open **Claude Code** (or any Claude agent with terminal access) inside that folder.
3. Paste the prompt below. Everything else is automatic except one browser login.

---

## 🚀 Paste This Prompt Into Claude Code

```
Set up the Fold AI multi-account expense companion for me, backed by Turso. I expect you
to do everything automatically — detect my OS, install dependencies, build all code,
create the Turso database, configure everything. The ONLY things I will do manually are:
- Click through the Turso login page that opens in my browser
- Type my phone number when asked
- Enter the OTP sent to my phone

Begin now. Do not wait for permission between steps. Run every command yourself.

─────────────────────────────────────────

STEP 1 — Detect my operating system:
  Run a command to check whether I am on macOS or Windows.
  On macOS: `uname -s` returns "Darwin"
  On Windows: use `$env:OS` in PowerShell, which returns "Windows_NT"

  Save the result — every subsequent step must use the correct OS-specific commands.

─────────────────────────────────────────

STEP 2 — Clone the repository into the current directory:
  Run: git clone --depth 1 https://github.com/naman0815/unfold-mcp.git .
  (git is pre-installed on modern macOS and Windows 10+. If it is missing, install it first:
    macOS: brew install git
    Windows: winget install --id Git.Git -e)

─────────────────────────────────────────

STEP 3 — Install system dependencies if missing. Check and install each:

  Note: npm install requires NO build tools — the SQLite dependency is pure WebAssembly.
  No Xcode, no Visual Studio Build Tools, nothing to compile.

  ── macOS ──────────────────────────────
  a) Homebrew:
       Check: command -v brew
       Install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  b) Node.js (v18+):
       Check: node --version
       Install: brew install node

  c) Go (v1.20+):
       Check: go version
       Install: brew install go

  d) Turso CLI:
       Check: turso --version
       Install: brew install tursodatabase/tap/turso

  ── Windows (run in PowerShell as Administrator) ──
  a) winget (ships with Windows 10 1709+, should already be present):
       Check: winget --version
       If missing, direct me to: https://aka.ms/getwinget

  b) Node.js (v18+):
       Check: node --version
       Install: winget install --id OpenJS.NodeJS -e
       After installing, close and reopen the terminal so PATH updates take effect.

  c) Go (v1.20+):
       Check: go version
       Install: winget install --id GoLang.Go -e
       After installing Go on Windows, close and reopen the terminal so PATH updates take effect.

  d) Turso CLI:
       Check: turso --version
       Turso's CLI has limited native Windows support as of this writing — if a direct
       install command fails, check https://docs.turso.tech/cli/installation for the
       current recommended method (may require WSL) and use that instead.

─────────────────────────────────────────

STEP 4 — Build the MCP server (TypeScript → JavaScript):
  Run: cd fold-mcp && npm install && npm run build && cd ..
  (Same command on both macOS and Windows)

─────────────────────────────────────────

STEP 5 — Build the unfold Go CLI:
  macOS:
    cd unfold_cli && go build -o ../unfold_patched . && cd ..

  Windows (PowerShell):
    cd unfold_cli; go build -o ../unfold_patched.exe .; cd ..

  Verify the binary works:
    macOS:   ./unfold_patched investments --help
    Windows: .\unfold_patched.exe investments --help
  This should print without error. If it fails, the binary did not build from the
  latest source — stop and check the build output for errors.

─────────────────────────────────────────

STEP 6 — Log in to Turso (one browser click, unavoidable):
  Run: turso auth login
  This opens a browser tab for you to approve. Tell me: "Click 'Authorize' in the
  browser tab that just opened, then come back here." Wait for me to confirm before
  continuing.

─────────────────────────────────────────

STEP 7 — Create the Turso database and capture its credentials:
  Run each of these and save the output:
    turso db create fold-mcp
    turso db show fold-mcp                        (save the URL — call it TURSO_URL)
    turso db tokens create fold-mcp                (save the token — call it TURSO_TOKEN)
    turso db shell fold-mcp < fold-mcp/schema/turso.sql

  If "fold-mcp" already exists from a previous attempt, that's fine — just run
  `turso db show fold-mcp` and `turso db tokens create fold-mcp` against the existing one.

─────────────────────────────────────────

STEP 8 — Write the environment file:
  Create fold-mcp/.env (copy from fold-mcp/.env.example if present) containing:
    TURSO_DATABASE_URL=<TURSO_URL from step 7>
    TURSO_AUTH_TOKEN=<TURSO_TOKEN from step 7>
  Leave MCP_SHARED_PASSWORD and PUBLIC_BASE_URL out for now — they're only needed
  for the separate, optional Render/mobile step, not this one.

─────────────────────────────────────────

STEP 9 — Configure Claude Desktop to use the MCP server, with Turso credentials passed
  through env (there's no local config file for them to live in otherwise):

  First, detect the full absolute path to the node binary:
    macOS:   Run `which node` and save the output (e.g. /opt/homebrew/bin/node)
    Windows: Run `(Get-Command node).Source` in PowerShell and save the output

  You MUST use this full path as the "command" value — Claude Desktop does not
  inherit the user's PATH, so a bare "node" will not work.

  The config file path is:
    macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
    Windows: %APPDATA%\Claude\claude_desktop_config.json

  Read the current file (create it if it does not exist).
  Add a "fold" entry under "mcpServers" using:
    - The FULL PATH to node as "command"
    - The ABSOLUTE PATH to fold-mcp/build/index.js in the current directory as the arg
    - An "env" block with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (the values from step 7)

  Example for macOS (replace paths/values with what you detected):
  {
    "mcpServers": {
      "fold": {
        "command": "/opt/homebrew/bin/node",
        "args": ["/Users/yourname/fold-ai/fold-mcp/build/index.js"],
        "env": {
          "TURSO_DATABASE_URL": "libsql://...",
          "TURSO_AUTH_TOKEN": "..."
        }
      }
    }
  }

  If the file already has other mcpServers entries, merge the "fold" entry in — do not
  overwrite existing entries. Write the final JSON back to the config file.

  If you cannot write to this file automatically, print the exact JSON I need to paste
  and the exact file path to open.

─────────────────────────────────────────

STEP 10 — Verify the build exists before finishing:
  Check that the compiled server file exists:
    macOS:   ls fold-mcp/build/index.js
    Windows: Test-Path fold-mcp\build\index.js

  If it is MISSING, re-run the build now: cd fold-mcp && npm install && npm run build && cd ..

─────────────────────────────────────────

STEP 11 — Confirm setup is complete and tell me to:
  1. Fully quit and relaunch Claude Desktop.
     macOS: Cmd+Q, then reopen from Applications.
     Windows: Right-click the tray icon → Quit, then reopen from Start Menu.
  2. Once relaunched, ask Claude: "Add my Fold account with phone number
     +91XXXXXXXXXX, then send me the OTP prompt" (using my real number).
     Claude will call add_fold_account, then ask for the OTP I receive by SMS,
     then call verify_fold_account_otp to finish linking.
  3. Once linked, ask Claude: "Sync my Fold data from 2021-01-01 to today"
     (Each year syncs in ~10s and up to 3 years run in parallel.)
  4. To link a second Fold account later, just repeat step 2 with a different
     phone number — Claude will ask which account to use whenever it matters,
     defaulting to whichever was linked most recently.

─────────────────────────────────────────

Go ahead and start from Step 1 now.
```

---

## 🔒 Privacy & Security

- Auth is still phone + OTP only — no passwords, no API keys, for Fold itself.
- Transaction data and Fold auth tokens live in **your own** Turso database — not shared with anyone, not a third party's database, but it is a cloud database rather than a local file.
- `fold-mcp/.env` (containing your Turso credentials) is gitignored and never leaves your machine — same guarantee as `db.sqlite` had in the local-only setup.
- If you later add the optional Render step for mobile/browser access, an additional shared password and OAuth tokens gate access — see that section's own privacy notes.
