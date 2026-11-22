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

Or with stock Playwright, in the browser's one context:

```ts
const browser = await chromium.connectOverCDP(endpoint);
const page = await browser.contexts()[0].newPage();
```

Page scripts never see the client, so `evaluate` reads the DOM but not the page's globals, and a few Playwright
features are out: [With Playwright](packages/flaneur/README.md#with-playwright).

The CLI, its options and the library API: [`packages/flaneur/README.md`](packages/flaneur/README.md).

## What it has been tested against

Measured with the repo's own eval ([`packages/eval`](packages/eval/README.md)) on one residential connection in
Poland, with Chrome for Testing 157. Each reading is a run on the day it names, so read it as evidence, not a
benchmark: sites change their rules, and an IP's reputation moves results.

### Errands on protected sites (2026-11-21)

The eval's [site journeys](packages/eval/README.md#site-journeys) run what a person does on a site: open it, accept
cookies, search, open a product, add it to a guest cart, view the cart (or browse only where there is no guest cart).
51 journeys on 45 sites (41 real sites, the rest CAPTCHA test pages), each run twice, with flaneur as released in
0.2.0: Chrome for Testing 157, a persistent profile, the human input on, one residential connection in Poland. The
control is a plain headless Chromium running the same journeys.

- **flaneur driven by stock Playwright:** 91 of 102 attempts completed the errand, **0 were challenged**. The other 11
  broke in the journey (a dialog over the results, a changed layout); none showed a vendor's challenge marker.
- **flaneur driven by agent-browser:** 26 of 28 completed, **0 challenged**; zara.com's journey broke twice on its cart
  dialog.
- **Headless Chromium:** challenged on 10 of the 26 journeys it ran (DataDome sites left out, as a headless visit
  flags the IP there).

Where the control is challenged, a pass is evidence. Attempts completed out of two; "broke" is the journey, not a
challenge:

|Vendor|Site|Headless Chromium|flaneur + Playwright|flaneur + agent-browser|
|-|-|-|-|-|
|Cloudflare|decathlon.pl|challenged|2/2|2/2|
|Akamai|kohls.com|challenged|1/2 (1 broke)|2/2|
|Akamai|sephora.pl|challenged|2/2|2/2|
|Akamai|zara.com|challenged|2/2|0/2 (broke)|
|HUMAN|zillow.com|challenged|2/2|2/2|
|HUMAN|skyscanner.pl|challenged|2/2|2/2|
|Kasada|realestate.com.au|challenged|2/2|2/2|
|Kasada|otto.de|challenged|2/2|2/2|
|reCAPTCHA|google.com, two searches|challenged (`/sorry/`)|2/2|2/2|
|reCAPTCHA|v2 checkbox demo|image challenge|2/2, ticked|2/2, ticked|

Also completed by flaneur and Playwright, without a challenge: x-kom, morele, ikea, notino, lego, kaufland, thalia
(Cloudflare); zalando, hm, asos, lowes (Akamai); walmart, gamestop, fiverr (HUMAN); vinted, etsy, tripadvisor,
airbnb, leroymerlin, seatgeek, leboncoin (DataDome); chewy, costco, nike (Kasada); booking, redfin, ocado (AWS WAF);
hertz (Imperva); amazon.pl; six Google searches in a row; and longer walks (search, sort, page 2, two products, cart)
on decathlon, zalando, walmart and otto. Some of them let the headless control through too (x-kom, ikea, nike, ocado,
amazon), so there a pass proves less.

What the eval found and flaneur now fixes, each settled by experiments that changed one thing at a time
([journal](docs/design/stealth-browsing/history/EVAL-JOURNAL.md)):

- **Playwright's DOM events.** Its injected script dispatches `__playwright_*` events on the page's DOM, and HUMAN
  listens for them: adding them to a visit that otherwise passed got walmart.com to challenge it, twice out of two.
  The proxy now keeps them in the client's world.
- **agent-browser's traces.** Data attributes it stamps on elements, focus and clearing done by script, scrolling with
  no wheel: hidden or done by hand.
- **A navigation's referrer.** `goto` with a referrer sent a typed-URL request that carries one; dropped.
- **The pace.** A self-solving interstitial (Kasada's `ips.js`, DataDome's device check) or a CAPTCHA in a hidden
  frame no longer counts as a block of the site.

### Sites behind anti-bot vendors (2026-11-15 to 19)

The first readings loaded each site's home page once. Three browsers are compared:

- **Headless Chromium**: Playwright's bundled Chromium in headless mode, the control that is plainly a bot.
- **No stealth**: the same Chrome for Testing that flaneur runs, driven by agent-browser over CDP, before any of
  flaneur's layers existed (2026-11-15).
- **flaneur**: its stealth layers on 2026-11-16, while they still lived inside the app they were built for, and the
  package itself on 2026-11-19.

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
stealth, 0.90 for flaneur and 0.90 for a person browsing by hand. Since 11-19 headless Chromium also scores 0.90 there
and on antcpt.com's demo, so those keys no longer tell a bot from a person. 2captcha.com's demo key does: it gave
flaneur between 0.3 and 0.9 over 11-21 (mostly 0.7–0.9), with no person's reading on that key yet to compare.

### Not measured

Account bans: they come late, hit a whole account, and cannot be tested on a real one. flaneur guards against them by
rule instead, chiefly the human pace.

## For AI agents

The `flaneur` skill teaches an agent to start the browser, drive it with agent-browser or a Playwright script and
behave like a person on the sites it visits.

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

## Repository

- `packages/flaneur/` — the npm package: library and CLI.
- `plugin/` — the agent skill, packaged for Claude Code, Codex and OpenCode.
- `docs/decisions/` — why the API looks as it does.
- `ARCHITECTURE.md` — how the repo is built.

## License

MIT
