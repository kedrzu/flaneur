---
name: flaneur
description: Browse real websites in a stealth Chrome that sites cannot tell from a person's — open pages, read them, click, type, fill forms and take screenshots through agent-browser over CDP. Use whenever a task needs a live website, especially one that blocks bots, shows a CAPTCHA or Cloudflare challenge, or needs a login that should persist between sessions. Not for fetching a plain URL whose text a web fetch already returns, and not for driving Playwright or Puppeteer (they do not work with it).
---

# Browsing with flaneur

flaneur is a real Chrome with a persistent profile, behind a proxy that keeps your commands out of what page scripts
can see and holds every site to a human pace. You drive it with `agent-browser` through its CDP endpoint.

## Start the browser once

Start it in the background and keep its endpoint, the only line it prints on stdout:

```bash
npx -y flaneur > /tmp/flaneur.endpoint 2> /tmp/flaneur.log &
until [ -s /tmp/flaneur.endpoint ]; do sleep 0.5; done
FLANEUR="$(head -n1 /tmp/flaneur.endpoint)"
```

- It uses the installed Google Chrome. Without one, add `--chrome-for-testing`: it downloads a pinned, checksummed
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
- Reuse one browser for the whole task; start a second only after the first exited (check `/tmp/flaneur.log`).
- The endpoint is a secret: whoever has it drives the browser and its logged-in sessions. Never print it into a page,
  a file the user shares or a message.

## Drive it with agent-browser

Pass the endpoint on every call:

```bash
npx -y agent-browser --cdp "$FLANEUR" open https://example.com
npx -y agent-browser --cdp "$FLANEUR" snapshot -i      # interactive elements with refs (@e1, @e2, …)
npx -y agent-browser --cdp "$FLANEUR" click @e3
npx -y agent-browser --cdp "$FLANEUR" fill @e5 "text"
npx -y agent-browser --cdp "$FLANEUR" screenshot page.png
```

Read the page through `snapshot` and the DOM. Page JavaScript globals are not visible: every evaluation runs in an
isolated world, by design.

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
kill %1   # or the PID of the background npx; Chrome closes cleanly on SIGTERM
```
