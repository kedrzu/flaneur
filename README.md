<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-dark.svg">
    <img alt="flaneur" src="docs/brand/lockup.svg" height="96">
  </picture>
</h1>

<p align="center"><strong>A stealth Chrome for AI agents: browses like a person, never looks like a bot.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/flaneur"><img alt="npm" src="https://img.shields.io/npm/v/flaneur?color=mediumvioletred"></a>
  <a href="https://github.com/kedrzu/flaneur/actions/workflows/build.yml"><img alt="Build" src="https://github.com/kedrzu/flaneur/actions/workflows/build.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/kedrzu/flaneur?color=mediumvioletred"></a>
  <img alt="Node.js 22+ and Bun" src="https://img.shields.io/badge/runs%20on-Node.js%2022%2B%20%C2%B7%20Bun-mediumvioletred">
</p>

Headless browsers get challenged. flaneur launches a real Chrome with a persistent profile and serves it over the
Chrome DevTools Protocol (CDP) behind a proxy that hides the automation from page scripts and turns every click,
keystroke and page load into a person's. On 41 sites behind Cloudflare, Akamai, HUMAN, DataDome, Kasada, AWS WAF and
Imperva it completed every errand without a challenge; headless Chromium was challenged on 22 of the errands it ran.

```bash
npx flaneur            # Node.js
bunx --bun flaneur     # Bun
# ws://127.0.0.1:53817/7c9e…   ← the CDP endpoint, the only line on stdout
```

## Why flaneur

- **A real Chrome.** A persistent profile, and nothing spoofed but the brand: pages name it Google Chrome
  ([CLI](packages/flaneur/README.md#cli)).
- **A driver pages cannot see.** The client's code runs in an isolated world
  ([isolation](packages/flaneur/README.md#the-price-of-isolation)).
- **Human input and pace.** Curved cursor paths, typing key by key, one page load per site every 5 s at most
  ([input](packages/flaneur/README.md#human-input), [pace](packages/flaneur/README.md#cli)).
- **Your own Chrome,** signed in as you are, through an extension you install once
  ([own Chrome](packages/flaneur/README.md#your-own-chrome)).
- **A VPN for the browser only:** the rest of the computer stays on its own network ([VPN](packages/flaneur/README.md#through-a-vpn)).
- **Out of your way:** pages open in the background yet read as visible and focused
  ([background](packages/flaneur/README.md#in-the-background)).
- **Any CDP client:** stock [Playwright](packages/flaneur/README.md#with-playwright), [agent-browser](packages/flaneur/README.md#with-agent-browser), anything
  that takes a CDP WebSocket URL, or the [library](packages/flaneur/README.md#library) from Node.js and Bun.
- **Ready for agents:** a skill for Claude Code, Codex and OpenCode ([For AI agents](#for-ai-agents)).

## How it differs

- **Nothing to patch, so nothing to catch:** no fingerprint is overwritten, so what sites measure is a real Chrome.
- **Stealth in the proxy, not the client:** stock Playwright and agent-browser connect unmodified, no patched driver.
- **Behaviour, not just fingerprint:** the cursor, the typing and the pace of page loads are a person's.
- **Local and yours:** no cloud, no account; your computer, your connection, a profile that stays.

## What it has been tested against

The repo's eval ([`packages/eval`](packages/eval/README.md#site-journeys)) runs, on each site, what a person does
there: open it, accept cookies, search, open a product, add it to a guest cart, view and empty the cart (or browse
only where there is no guest cart). Each errand runs twice, with flaneur driven by stock Playwright and, on 14 of the
sites, by agent-browser; a plain headless Chromium runs the same errands as the control. One residential connection
in Poland, Chrome for Testing 157.

|Vendor|Sites|flaneur|Headless Chromium challenged on|
|-|-|-|-|
|Cloudflare|decathlon.pl, x-kom.pl, morele.net, ikea.com, notino.pl, lego.com, kaufland.pl, thalia.de|all pass|decathlon, notino, lego, thalia|
|Akamai|kohls.com, zalando.pl, zara.com, sephora.pl, euro.com.pl, hm.com, asos.com, lowes.com|all pass|kohls, zara, sephora, hm, asos, lowes|
|HUMAN|walmart.com, zillow.com, gamestop.com, skyscanner.pl, homedepot.com, fiverr.com|all pass|zillow, skyscanner, fiverr|
|DataDome|vinted.pl, etsy.com, tripadvisor.com, airbnb.pl, leroymerlin.pl, seatgeek.com, leboncoin.fr|all pass|not run: a headless visit flags the IP with DataDome|
|Kasada|realestate.com.au, nike.com, chewy.com, costco.com, otto.de|all pass|realestate, otto|
|AWS WAF|booking.com, redfin.com, ocado.com|all pass|none|
|Imperva|hertz.com, xcite.com|all pass|hertz|
|Amazon|amazon.pl|passes|none|
|Google|google.com: two searches, and six in a row|passes|—|

"Pass" is the errand completed with no challenge on both attempts of its latest run, through Playwright and, where
it runs, agent-browser. Where the control passes too (x-kom, ikea, nike, gamestop, ocado, xcite, amazon), a pass
proves less.

<details>
<summary>Profiles marked over time, CAPTCHAs, bot-detection test pages, what is not measured</summary>

A site can still mark one profile after many visits in a short time: otto.de (an error page, "Hoppla! Das hat nicht
geklappt") and leroymerlin.pl (a DataDome challenge) did so to the eval's profile after a dozen runs of the same
errand within an hour, while a fresh profile passed on the same connection minutes later.

### CAPTCHAs

- **reCAPTCHA v3** on [2captcha's demo](https://2captcha.com/demo/recaptcha-v3), whose key tells a bot from a person:
  flaneur scores 0.7, a person in their own Chrome 0.9, headless Chromium 0.1. antcpt.com's demo and the eval's own
  [test shop](packages/eval/shop/README.md) score everyone 0.9, headless Chromium included, so they measure nothing.
- **reCAPTCHA v2 checkbox** on [Google's demo](https://www.google.com/recaptcha/api2/demo): it shows an image
  challenge on this connection to everyone, a person in their own Chrome included, so it measures the IP, not the
  browser.

### Bot-detection test pages

|Page|flaneur|Headless Chromium|
|-|-|-|
|[bot.sannysoft.com](https://bot.sannysoft.com/)|pass|fail (WebDriver, User Agent)|
|[rebrowser bot-detector](https://bot-detector.rebrowser.net/)|pass|fail (Runtime.enable, main-world execution)|
|[BotD](https://fingerprintjs.github.io/BotD/main/)|pass|fail (user agent, plugins)|
|[CreepJS](https://abrahamjuliot.github.io/creepjs/)|pass (0 % headless)|fail (100 % headless)|
|[BrowserScan](https://www.browserscan.net/bot-detection)|pass (Normal)|fail (Robot)|
|[deviceandbrowserinfo](https://deviceandbrowserinfo.com/are_you_a_bot)|pass|fail (WebDriver, user agent)|

### Not measured

Account bans: they come late, hit a whole account, and cannot be tested on a real one. flaneur guards against them by
rule instead, chiefly the human pace.

</details>

## Usage

With Playwright, in the browser's one context:

```ts
const browser = await chromium.connectOverCDP(endpoint);
const page = await browser.contexts()[0].newPage();
await page.goto('https://example.com');
```

`evaluate` reads the page's DOM but not its globals, and a few features are out:
[With Playwright](packages/flaneur/README.md#with-playwright). From the shell:

```bash
npx flaneur > flaneur.endpoint &                 # start once, read the endpoint
until [ -s flaneur.endpoint ]; do sleep 0.5; done
agent-browser --cdp "$(head -n1 flaneur.endpoint)" open https://example.com

npx flaneur --chrome own                         # your own Chrome, signed in
FLANEUR_VPN_USER=… FLANEUR_VPN_PASSWORD=… npx flaneur --vpn "US Texas" --vpn-provider "private internet access"
```

[Your own Chrome](packages/flaneur/README.md#your-own-chrome) needs the flaneur extension, installed once.
[A VPN](packages/flaneur/README.md#through-a-vpn) needs Docker and never falls back to browsing without it.
The CLI, its options and the library API: [`packages/flaneur/README.md`](packages/flaneur/README.md).

## For AI agents

The `flaneur` skill teaches an agent to start the browser, drive it and behave like a person on the sites it visits.

**Claude Code:** the repo is a plugin marketplace with one plugin.

```text
/plugin marketplace add kedrzu/flaneur
/plugin install flaneur@flaneur
```

**Codex:** it reads the same marketplace.

```bash
codex plugin marketplace add kedrzu/flaneur
codex plugin add flaneur@flaneur
```

The browser needs the network and starts Chrome, which Codex's sandbox blocks: approve its commands when Codex asks to
run them outside it.

**OpenCode:** add the skill catalog to `opencode.json`, globally (`~/.config/opencode/opencode.json`) or in a project.

```json
{
    "skills": ["https://raw.githubusercontent.com/kedrzu/flaneur/main/plugin/skills/"]
}
```

## Limits

- **No headless mode,** on purpose: headless Chrome names itself `HeadlessChrome` in its user agent.
- **Page scripts never see the client,** nor it their globals ([isolation](packages/flaneur/README.md#the-price-of-isolation)).
- **Human input costs time:** about half a second more per click and about 90 ms per typed character.

## Repository

- `packages/flaneur/` — the npm package: library and CLI.
- `plugin/` — the agent skill, packaged for Claude Code, Codex and OpenCode.
- `docs/decisions/` — why the API looks as it does.
- `ARCHITECTURE.md` — how the repo is built.

MIT license.
