<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-dark.svg">
    <img alt="flaneur" src="docs/brand/lockup.svg" height="96">
  </picture>
</h1>

> *flâneur* (n.): one who strolls the city, watching everything and noticed by no one.

A stealth Chrome for AI agents. flaneur launches a real Chrome with a persistent profile and serves it over the Chrome
DevTools Protocol (CDP) behind a proxy that keeps the agent's code out of what page scripts can observe, brands every
page as Google Chrome and holds each site to a human pace. Sites see a person browsing, not a bot.

With `--vpn <region>` it browses from another country: only the browser goes through a VPN tunnel in Docker, the rest
of the computer stays on its own network.

With `--chrome own` it drives the Chrome you browse with instead, signed in as you are, through a Chrome extension you
install and allow once: [your own Chrome](packages/flaneur/README.md#your-own-chrome).

Runs on Node.js 22+ and Bun.

## Quick start

```bash
npx flaneur            # Node.js
bunx --bun flaneur     # Bun
# ws://127.0.0.1:53817/7c9e…   ← the CDP endpoint, the only line on stdout
```

Drive it with any CDP client, for example [agent-browser](https://github.com/vercel-labs/agent-browser):

```bash
npx flaneur > flaneur.endpoint &
until [ -s flaneur.endpoint ]; do sleep 0.5; done
FLANEUR="$(head -n1 flaneur.endpoint)"

agent-browser --cdp "$FLANEUR" open https://example.com
```

The CLI, its options and the library API: [`packages/flaneur/README.md`](packages/flaneur/README.md).

## What it has been tested against

Measured with the repo's own eval ([`packages/eval`](packages/eval/README.md)) on one residential connection in
Poland, with Chrome for Testing 157. Each column is a single run on that day, so read it as evidence, not a benchmark:
sites change their rules, and an IP's reputation moves results. Three browsers are compared:

- **Headless Chromium**: Playwright's bundled Chromium in headless mode, the control that is plainly a bot.
- **No stealth**: the same Chrome for Testing that flaneur runs, driven by agent-browser over CDP, before any of
  flaneur's layers existed (2026-11-15).
- **flaneur**: its stealth layers on 2026-11-16, while they still lived inside the app they were built for, and the
  package itself on 2026-11-19.

### Sites behind anti-bot vendors

"Through" means the page loaded with its content; "challenged" means the vendor's challenge, CAPTCHA or block page.

|Vendor|Site|Headless Chromium (11-19)|No stealth (11-15)|flaneur (11-16)|flaneur (11-19)|
|-|-|-|-|-|-|
|Cloudflare|indeed.com|challenged|challenged|challenged|through|
|Cloudflare|medium.com|challenged|through|through|through|
|Akamai|southwest.com|through|through|through|through|
|Akamai|kohls.com|challenged|challenged|challenged|through|
|HUMAN|wayfair.com|challenged|through|through|challenged|
|HUMAN|priceline.com|challenged|through|through|through|
|Kasada|realestate.com.au|challenged|challenged|through|through|
|DataDome|g2.com|challenged|challenged|through|through|
|**Total**||**1 of 8**|**4 of 8**|**6 of 8**|**7 of 8**|

### Allegro (DataDome)

Allegro shows a CAPTCHA once it decides a visitor is a bot, which ends an agent's errand. The eval runs product
searches one after another until the first CAPTCHA.

- **No stealth (11-15):** a CAPTCHA on the very first search.
- **flaneur (11-16):** 40 of 40 searches at one every 8 s, 40 of 40 at one every 5 s, and 19 of 20 at one per second (the
  20th timed out; no CAPTCHA in any run).

### Bot-detection test pages

|Page|Headless Chromium (11-19)|No stealth (11-15)|flaneur (11-19)|
|-|-|-|-|
|[bot.sannysoft.com](https://bot.sannysoft.com/)|fail|fail (WebDriver)|pass|
|[rebrowser bot-detector](https://bot-detector.rebrowser.net/)|fail|fail (Runtime.enable)|pass|
|[BotD](https://fingerprintjs.github.io/BotD/main/)|fail|fail (WebDriver)|pass|
|[CreepJS](https://abrahamjuliot.github.io/creepjs/)|fail (headless)|fail (WebDriver)|pass|
|[BrowserScan](https://www.browserscan.net/bot-detection)|fail|fail (WebDriver)|pass|
|[deviceandbrowserinfo](https://deviceandbrowserinfo.com/are_you_a_bot)|fail|fail (WebDriver)|pass|

### reCAPTCHA v3

The eval's [test shop](packages/eval/shop/README.md) scores a scripted visit, action by action, with reCAPTCHA v3
(1.0 is a person, 0.0 a bot). On 11-15/16 the mean scores were 0.01–0.17 for headless Chromium, 0.50–0.70 with no
stealth, 0.90 for flaneur and 0.90 for a person browsing by hand. On 11-19 headless Chromium also scored 0.90, so the
key's scores no longer tell a bot from a person and this reading is on hold until they do.

### Not measured

Account bans: they come late, hit a whole account, and cannot be tested on a real one. flaneur guards against them by
rule instead, chiefly the human pace.

## For Claude Code

The repo is a plugin marketplace with one plugin: a `flaneur` skill that teaches the agent to start the browser, drive
it with agent-browser and behave like a person on the sites it visits.

```text
/plugin marketplace add kedrzu/flaneur
/plugin install flaneur@flaneur
```

## Repository

- `packages/flaneur/` — the npm package: library and CLI.
- `plugin/` — the Claude Code plugin and its skill.
- `docs/decisions/` — why the API looks as it does.
- `ARCHITECTURE.md` — how the repo is built.

## License

MIT
