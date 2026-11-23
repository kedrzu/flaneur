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

The repo's eval ([`packages/eval`](packages/eval/README.md#site-journeys)) runs, on each site, what a person does
there: open it, accept cookies, search, open a product, add it to a guest cart, view and empty the cart (or browse
only where there is no guest cart). Each errand runs twice, with flaneur driven by stock Playwright and, on 14 of the
sites, by agent-browser; a plain headless Chromium runs the same errands as the control. One residential connection
in Poland, Chrome for Testing 157.

### Sites behind anti-bot vendors

|Vendor|Sites|flaneur|Headless Chromium challenged on|
|-|-|-|-|
|Cloudflare|decathlon.pl, x-kom.pl, morele.net, ikea.com, notino.pl, lego.com, kaufland.pl, thalia.de|all pass|decathlon, notino, lego, thalia|
|Akamai|kohls.com, zalando.pl, zara.com, sephora.pl, euro.com.pl, hm.com, asos.com, lowes.com|all pass|kohls, zara, sephora, hm, asos, lowes|
|HUMAN|walmart.com, zillow.com, gamestop.com, skyscanner.pl, homedepot.com, fiverr.com|all pass|zillow, skyscanner, fiverr|
|DataDome|vinted.pl, etsy.com, tripadvisor.com, airbnb.pl, leroymerlin.pl, seatgeek.com, leboncoin.fr|all pass|not run: a headless visit flags the IP with DataDome|
|Kasada|realestate.com.au, nike.com, chewy.com, costco.com, otto.de|all pass but otto.de|realestate, otto|
|AWS WAF|booking.com, redfin.com, ocado.com|all pass|none|
|Imperva|hertz.com, xcite.com|all pass|hertz|
|Amazon|amazon.pl|passes|none|
|Google|google.com: two searches, and six in a row|passes|—|

"Pass" is the errand completed with no challenge on both attempts of its latest run, through Playwright and, where
it runs, agent-browser. otto.de answers with its own error page ("Hoppla! Das hat nicht geklappt") and no vendor marker, so
whether it refuses flaneur or this connection is not known yet. Where the control passes too (x-kom, ikea, nike,
gamestop, ocado, xcite, amazon), a pass proves less.

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
