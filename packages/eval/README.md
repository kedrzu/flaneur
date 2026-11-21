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

## Site journeys

A [Playwright Test](https://playwright.dev/docs/test-intro) suite (`src/sites`) that checks whether a script written
in stock Playwright gets through real protected sites with flaneur, and does so consistently. Each journey is what a
person shopping does: open the site, accept cookies, search, open a product, add it to a guest cart, view the cart.
Why it is a Playwright Test suite and not a probe of `bun run eval`:
[site-journeys-in-playwright-test](../../docs/decisions/site-journeys-in-playwright-test.md).

```bash
bun run eval:sites                                 # every journey 3 times in flaneur
bun run eval:sites --repeat-each 1 --grep amazon   # one journey once
bun run eval:sites --project headless              # add the plain headless Chromium as the control
bun run eval:sites:history                         # pass rates of the last 5 runs, and the sites cooling
bun run eval:sites:selftest                        # the suite's own check, on local pages, offline
```

- **Journeys:** decathlon.pl (Cloudflare), vinted.pl, tripadvisor.com and etsy.com (DataDome), kohls.com and
  zalando.pl (Akamai), walmart.com and zillow.com (HUMAN), realestate.com.au (Kasada), amazon.pl (Amazon's robot check),
  google.com (reCAPTCHA on `/sorry/`), and the [test shop](shop/README.md), whose mean reCAPTCHA v3 score must reach
  0.5. AWS WAF has no journey: no site behind it with a guest flow was found (checked 2026-11-21).
- **Never:** a journey does not log in, create an account, submit a form other than the site's search, enter checkout
  or pay. The furthest it goes is a guest cart, and the eval profile's carts grow with every run.
- **Failures:** each failed attempt is `challenged` (a vendor's challenge, with its marker), `refused` (flaneur's
  pace refused the site after a challenge) or `broken` (anything else, usually a changed page). A `broken` journey
  needs fixing; a `challenged` one is the measurement.
- **Results:** a table at the end of the run — attempts passed out of those executed (refused ones apart), the
  classes, the vendors, the step and the evidence a journey fails with most, and whether the control passes too,
  which makes the journey tell nothing apart. It is saved as `~/.flaneur-eval/results/<time>-sites.json` with every
  attempt: its class, evidence, final URL, attachments and step timeline. The timeline has, before the first step and
  after each, the page's URL and the anti-bot cookies held for it: names only, never values, plus Akamai's `_abck`
  state (`valid` when its second `~` field is `0`, a community reading Akamai does not document).
- **Artifacts:** each run writes to its own `~/.flaneur-eval/sites/<time>/`, so older runs' screenshots stay; a failed
  attempt gets its screenshot and its HTML (up to 300 KB).
- **Cooldown:** a site that challenged or refused flaneur cools for an hour in `~/.flaneur-eval/sites/cooldown.json`,
  and later runs skip its journey in both projects, the skip naming the minutes left.
  `FLANEUR_SITES_IGNORE_COOLDOWN=1` runs it anyway; deleting the file ends every cooldown.
- **Repeats:** `--repeat-each` runs the journeys in turns (all once, then all again), with one flaneur and one pace
  for the whole run. After a challenge flaneur pauses the site for 5 minutes and stops it for an hour after a second,
  so later attempts on it are `refused`.
- The control spends the connection's reputation (DataDome flags the IP after a headless visit), so it runs only when
  named. Allegro stays with the `allegro` probe of `bun run eval`.
- The suite runs on Node, under Playwright's own runner; its `*.spec.ts` files are not `bun test` files.
