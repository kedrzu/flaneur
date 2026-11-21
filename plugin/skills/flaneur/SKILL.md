---
name: flaneur
description: Browse real websites in a stealth Chrome that sites cannot tell from a person's — open pages, read them, click, type, fill forms and take screenshots through agent-browser or a Playwright script over CDP. Use whenever a task needs a live website, especially one that blocks bots, shows a CAPTCHA or Cloudflare challenge, or needs a login that should persist between sessions. Not for fetching a plain URL whose text a web fetch already returns.
---

# Browsing with flaneur

flaneur is a real Chrome with a persistent profile, behind a proxy that keeps your commands out of what page scripts
can see and holds every site to a human pace. You drive it through its CDP endpoint: with `agent-browser` to look and
click step by step, or with a Playwright script for a flow of many steps.

## Start the browser once

It runs until stopped, so it must outlive the command that starts it. Start it in the background; it writes its
endpoint, the only line it prints on stdout, and its PID to files:

```bash
: > /tmp/flaneur.endpoint   # a stale endpoint from an earlier run must not count
sh -c 'echo $$ > /tmp/flaneur.pid; exec npx -y flaneur > /tmp/flaneur.endpoint 2> /tmp/flaneur.log' &
until [ -s /tmp/flaneur.endpoint ]; do sleep 0.5; done
```

Options go after `npx -y flaneur`, inside the quotes.

- **Codex** ends a command's background jobs when the command returns, `&` included: run the `sh -c '…'` line
  without `&`, as a long-running terminal session you leave open, and wait for the endpoint in the next command.
- **A sandboxed shell** (Codex's default) blocks what flaneur needs: the network, and starting Chrome. Run its commands
  and agent-browser's outside the sandbox, with the escalated permission the harness offers or the user's approval.
  When the browser does not start, say so: never answer from memory instead.
- It uses the installed Google Chrome. Without one, add `--chrome testing`: it downloads a pinned, checksummed
  Chrome for Testing once.
- **Another country:** when the task needs the site as seen from elsewhere, add
  `--vpn "<region>" --vpn-provider "<provider>"` (e.g. `--vpn "US Texas" --vpn-provider "private internet access"`).
  It needs Docker and the user's VPN login in `FLANEUR_VPN_USER` / `FLANEUR_VPN_PASSWORD`; ask the user for the
  provider, never for the password itself. The first start can take a few minutes; `/tmp/flaneur.log` shows the address
  the tunnel got, and where ipinfo places it — confirm the location on the site itself, its own database may differ.
  Another region means stopping the browser and starting it again.
- **When the VPN does not start** (no Docker, Docker not running, a wrong login, an unknown region), flaneur exits
  before Chrome starts and `/tmp/flaneur.log` says why; an unknown region lists the valid ones. Fix what it names or
  tell the user. Never browse without `--vpn` instead: the task needed the other country.
- **The user's own Chrome:** when the task needs the user's own logins or context (their accounts, their open
  session on a site) and the user agreed to let you use their browser, start with `--chrome own` instead. It drives
  their own browser (Chrome or any Chromium browser, found by flaneur itself) through the flaneur extension, in a window of its own; your tabs stay open for them afterwards.
  It takes no `--vpn`, `--user-data-dir` or Chrome arguments. Never pick it on your own: it acts as the user, on their
  real accounts.
- **When `--chrome own` fails**, `/tmp/flaneur.log` says why. Not connected within 45 s: the flaneur extension is not
  installed or not running in their browser: tell the user to install it (the log gives the link) or turn it on in
  its extensions page, then start again. Installed and on, yet never connecting: flaneur did not find that browser;
  ask the user to run `npx flaneur setup --browser-data <its user data folder>` once. Never search for it yourself.
  "Another flaneur is already using your browser": stop the other one first. A protocol version mismatch names what to
  update. Never fall back to the separate profile silently: tell the user and ask.
- Reuse one browser for the whole task; start a second only after the first exited (check `/tmp/flaneur.log`).
- The endpoint is a secret: whoever has it drives the browser and its logged-in sessions. Never print it into a page,
  a file the user shares or a message.

## Drive it with agent-browser

Pass the endpoint on every call. Read it from the file in each command: a shell variable does not outlive the command
that set it.

```bash
FLANEUR="$(head -n1 /tmp/flaneur.endpoint)"
npx -y agent-browser --cdp "$FLANEUR" open https://example.com
npx -y agent-browser --cdp "$FLANEUR" snapshot -i      # interactive elements with refs (@e1, @e2, …)
npx -y agent-browser --cdp "$FLANEUR" click @e3
npx -y agent-browser --cdp "$FLANEUR" fill @e5 "text"
npx -y agent-browser --cdp "$FLANEUR" screenshot page.png
```

Read the page through `snapshot` and the DOM. Page JavaScript globals are not visible: every evaluation runs in an
isolated world, by design.

## Drive it with Playwright

For a flow of many steps (search, open each result, read a field), write a script with stock Playwright. Install
`playwright-core` once in a folder of its own (it needs no browser download), and connect to the endpoint:

```bash
mkdir -p /tmp/flaneur-pw && cd /tmp/flaneur-pw && [ -d node_modules/playwright-core ] || npm i playwright-core
```

```js
// /tmp/flaneur-pw/visit.mjs — run: node /tmp/flaneur-pw/visit.mjs "$(head -n1 /tmp/flaneur.endpoint)"
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP(process.argv[2]);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://example.com');
console.log(await page.title(), await page.getByRole('paragraph').first().textContent());
await browser.close(); // only disconnects: the pages stay open for the next script
```

- Use `browser.contexts()[0]`: there is one profile. `browser.newContext()`, `browser.newPage()` and context options
  (`userAgent`, `locale`, `viewport`) fail.
- A later script sees the pages an earlier one left, the one used last first: continue where you stopped.
- `evaluate` sees the page's DOM, not its JavaScript globals, and the page never sees yours. `exposeFunction`,
  `exposeBinding`, `console` and `pageerror` events do not work; `worker.evaluate` fails; download events never come.
- `page.setContent()` hangs until its timeout (it waits for a console message): open your HTML with
  `page.goto('data:text/html,' + encodeURIComponent(html))` instead.
- With `--chrome own`, `context.cookies()`, `storageState()` and `grantPermissions()` fail, and a tab another client
  drives is not yours.
- The pace holds `goto` too: a wait of a few seconds is the protection, not a hang.
- Clicks and typing take a person's time (about half a second a click, 90 ms a typed character, a few seconds before
  the first action on a fresh page): that is the protection too.

## Behave like a person

- **The pace is the protection.** Each site gets at most one page load every few seconds and is slowed down after it
  blocks or challenges the browser. A load that waits is not a failure: do not retry it, do not pass `--no-pace`.
- **A challenge (CAPTCHA, "verify you are human")** is for the user, not for you: tell them which page shows it and
  wait while they solve it in the open window.
- **Logins persist** in the profile. When a site needs one, ask the user to log in in the window, then continue.
- **No headless mode.** Never pass `--headless`: headless Chrome names itself in its user agent and every site sees
  it.

## Stop

```bash
kill "$(cat /tmp/flaneur.pid)"   # Chrome closes cleanly on SIGTERM
```

With `--chrome own`, stopping only lets go of the user's Chrome: it and its tabs stay open.
