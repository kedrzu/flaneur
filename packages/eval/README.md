# @flaneur/eval

Measures how detectable flaneur is. Every probe is run by three runners, so a reading always has a known bot and a
known human beside it:

- **agent** — flaneur with the pinned Chrome for Testing and a human pace, driven by
  [agent-browser](https://github.com/vercel-labs/agent-browser) over its CDP endpoint, exactly as an agent drives it;
- **headless** — a plain headless Chromium driven by Playwright, the control that is plainly a bot;
- **person** — the same shop visit made by hand in the person's own Chrome.

Why it is built this way: the design, [`docs/design/stealth-browsing`](../../docs/design/stealth-browsing/README.md)
(D6, D9, D11).

## Probes

- **shop** — a scripted visit to the [test shop](shop/README.md) (search, filter, paging, two products, the order form).
  The shop scores every action with reCAPTCHA v3 and records how input arrived (mouse movement before a click, key
  presses or inserted text).
- **leaks** — public fingerprint test pages (bot.sannysoft.com, rebrowser bot-detector, BotD, CreepJS, BrowserScan,
  deviceandbrowserinfo) and each page's verdict.
- **panel** — real sites behind the major protection vendors (Cloudflare, Akamai, HUMAN, Kasada, DataDome): whether a
  page loads, is challenged or is blocked.
- **allegro** — repeated searches on Allegro (DataDome) until the first CAPTCHA. Only when named: every search spends
  the connection's reputation.

## Running

```bash
bun run eval run [--runner agent|headless|all] [--probes shop,leaks,panel,allegro]
bun run eval person     # make the shop visit by hand, then paste its results
bun run eval compare    # each runner's latest reading of every probe, side by side
```

Run it on a real computer with a home connection: a datacenter IP is challenged whatever the browser does, and would
swamp every result. Everything the eval keeps — Chrome for Testing, agent-browser, the profile and the results — lives
in `~/.flaneur-eval`. A result file holds what the pages reported (verdicts, failed checks, page-specific details,
the user agent); read it before publishing one.
