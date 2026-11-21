# Decisions

The decisions in force: grepped and re-entered, never read front to back. A heading is the
decision's ID alone, so `DECISIONS.md#d3` keeps resolving after the wording is sharpened. Retired
decisions and the journal live in [history/](history/).

**Before proposing a change in an area, read the Rejected lines of its decisions and the history
they link to.** Reopening a rejected option is right when its premise changed; repeating it without
knowing it was rejected is not.

## D1

**Two goals, in this order: the person's account is not banned, and the agent finishes its task instead of stopping
at a block or CAPTCHA. It is one real person on their own accounts, on any site, at a human scale.** (2026-11-15,
owner)

**Why.** The owner's cases: agentic Allegro searches trip a CAPTCHA after some number of actions and the task stops;
X bans accounts for automation. The person may use any site, so nothing may assume a known list of sites.

> **Checked 2026-11-15:** X's automation rules list "Use non-API-based forms of automation, such as scripting the X
> website. The use of these techniques may result in the permanent suspension of your account." (primary page
> `help.x.com/en/rules-and-policies/x-automation` returned 403; quoted by a secondary source). X ToS forbids access
> "by any means (automated or otherwise) other than through our currently available, published interfaces" —
> [x.com/tos](https://x.com/en/tos).

**Rejected.**

- Many identities (rotating fingerprints, proxies, profiles), as scraping tools do — that is not the purpose, and for
  a logged-in account a changing identity is itself suspicious.
- Tuning for a fixed list of sites (Allegro, X) — the person may use any site.

## D2

**Stealth means consistency with the real machine: the browser presents its real fingerprint (canvas, WebGL, fonts,
screen, OS) and removes only what says "automated". Nothing is spoofed beyond that.** (2026-11-15, design agent
proposal, owner agreed)

**Why.** One person on a real Mac or PC is, by definition, consistent; a spoofed fingerprint introduces mismatches
that detectors look for. Residential IP, a persistent profile with real logins, and a real Chromium's TLS fingerprint
come for free.

> **Checked 2026-11-15:** CloakBrowser's Allegro block (issue #16) was Linux system fonts leaking through a spoofed
> Windows persona; its maintainer on #471: "the main way it shows up is IP reputation" —
> [CloakBrowser](https://github.com/CloakHQ/CloakBrowser).

**Rejected.**

- Fingerprint spoofing engines (CloakBrowser, Camoufox, Helium's noise patch) — they hide many identities; for one
  real person they add inconsistencies.

## D3

**The agent's browser is Chrome for Testing driven over CDP through `--remote-debugging-pipe`, launched with
`--disable-blink-features=AutomationControlled`.** (2026-11-15, design agent proposal, owner agreed)

**Why.** It keeps agent-browser and flaneur's CDP proxy, through which every client command passes and where a host's
policy enforces the agent's limits. The pipe means no other local process can reach the browser, unlike a debugging
port. The pipe alone sets `navigator.webdriver = true`; the flag turns it back off without giving up the pipe. Keeping
up with Chrome stable is a one-line pin bump (`PINNED_VERSION` in
`packages/flaneur/src/getChromeForTestingRelease.ts`, at stable 157.0.8103.78).

> **Checked 2026-11-15:** `{wrf::EnableAutomationControlled, switches::kRemoteDebuggingPipe, true}` in
> [runtime_features.cc](https://chromium.googlesource.com/chromium/src/+/main/content/child/runtime_features.cc);
> local test on CfT 158 headed macOS with the pipe: `navigator.webdriver` true without the flag, false with it.

> **Checked 2026-11-15:** CfT reports only `Not.A/Brand` and `Chromium` in `userAgentData.brands` (no "Google
> Chrome"), has proprietary codecs, and shows a non-removable "Chrome for Testing" banner in browser UI —
> [CfT README](https://github.com/chromium/chromium/blob/main/docs/chrome_for_testing/README.md). The brand is a
> layer to fix ([D4](#d4)).

**Consequences.** The package later made the installed Google Chrome the CLI's default, since a CLI user keeps it up
to date, with the pinned Chrome for Testing one flag away for a host that ships the browser
([package API](../../decisions/package-api.md)). The launch flag and the stealth layers apply to both.

A second flag, `--disable-backgrounding-occluded-windows`, keeps a page drawn while other windows cover the browser's.
Without it a page loaded behind them never paints, and the next click waits out Chrome's 5 s input timeout and is
lost. The price is that a covered page still reports `visibilityState` `visible`, as under Playwright and Puppeteer,
which launch with the same flag.

> **Checked 2026-11-19:** on macOS, a page loaded while its window was covered stayed `hidden`; the click after it
> reached the page as a `pointermove` without a `pointerdown`, with or without the pace. With the flag the page stayed
> `visible` and 10 of 10 runs, and 8 of 8 with four windows covering each other, delivered the click.

**Rejected.**

- CloakBrowser — closed-source binary, licence key per launch, "no redistribution (OEM/SaaS license required to serve
  third parties)" — [licence](https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md).
- Camoufox or any Firefox — Firefox removed CDP as of 141
  ([fxdx.dev](https://fxdx.dev/cdp-retirement-in-firefox/)), so agent-browser (Firefox only in open PR
  [#2205](https://github.com/vercel-labs/agent-browser/pull/2205)) and the CDP proxy would go.
- Bundling Google Chrome — not allowed without Google's written permission (Chrome ToS 9.2).
- Launching the person's installed Chrome with our own profile as the only option — correct brand, but no control over
  the version and nothing for people without Chrome. Reopen if the brand proves unfixable over CDP.
- Agent-oriented browsers: Ardia (Helium + agent-browser, macOS Apple Silicon only), Yab (closed, WebKit, macOS only,
  no CDP), Helium and Zen (privacy browsers, no agent features; Zen has no CDP). Their agent layer is the one
  agent-browser already gives.
- Headless agent engines (Obscura, Lightpanda) — headless, no persistent profile, own fingerprint; Lightpanda loaded
  5/9 protected pages vs Chrome 7/9 in a third-party test.
- Native web views — WKWebView has no CDP and a default UA detectably short of Safari's
  ([webkit.org](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/)); WebView2 has CDP
  and looks like Edge, but it would mean two engines and two control stacks for a gain on Windows only.
- CEF — one major behind stable and only the Chromium brand; nothing over CfT.
- Driving the person's own Chrome through an extension, as Claude in Chrome does — it is the same CDP, reached
  through `chrome.debugger`; what differs is the person's everyday profile, which flaneur does not hand the agent: the
  agent gets a profile of its own.

  > **Checked 2026-11-15:** Claude in Chrome's control permission is `debugger` — "allows Claude to actually control
  > your browser" ([support](https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome));
  > Claude Code reaches it through a native messaging host and the `claude-in-chrome` MCP server, and it "shares
  > your browser's login state"; on a CAPTCHA "it pauses and asks you to handle it manually"
  > ([docs](https://code.claude.com/docs/en/chrome)). The extension debugger API exposes `Runtime`, `Input`,
  > `Page` and others ([chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)).
- Our own patched Chromium now — see [D7](#d7).

## D4

**Stealth is built in flaneur's CDP proxy, in layers every browser client gets, regardless of measurement: the launch
flag ([D3](#d3)), the guarantee that page scripts never observe our code ([D8](#d8)), pace ([D5](#d5)), the "Google
Chrome" brand set over CDP on every target, workers included, and human input (mouse paths, a dwell before a click,
per-key typing and wheel scrolling generated from the agent's clicks, text and scrolls).** (2026-11-15, design agent
proposal; the brand moved to this group by the owner on 2026-11-16, input on 2026-11-21, before the eval showed
sites react to it)

**Why.** Every CDP command already passes the proxy, so a fix there covers agent-browser, site helpers in any
language, and anything later. Vendors document client-side JS fingerprinting first and behaviour second (HUMAN:
"user-interaction anomalies within mouse clicks, screen touches, cadence and timing" —
[docs](https://docs.humansecurity.com/applications/bd-detection-overview)).

> **Checked 2026-11-15:** agent-browser v0.43.0 sends `Runtime.enable` on every page
> (`cli/src/native/browser.rs:1040`); a click is one `mouseMoved` plus press and release at the element centre
> (`cli/src/native/interaction.rs:59-94`); `type` sends `Input.insertText` per character, key events only for
> Enter/Tab — [agent-browser](https://github.com/vercel-labs/agent-browser).

> **Checked 2026-11-16:** after the launch flag, the isolated-world rule and pace, the brand is the only leak the
> public test pages still report (rebrowser `useragent`); the agent scores as the person does on reCAPTCHA (0.90),
> and indeed.com and kohls.com still block it for reasons not yet known. The owner chose to remove the last known leak
> rather than wait for a site to show it matters.

> **Checked 2026-11-21:** a Playwright click through flaneur is one `Input.dispatchMouseEvent mouseMoved` exactly at
> the element's centre, then `mousePressed` and `mouseReleased` at the same instant; `fill` and agent-browser `type`
> send `Input.insertText`, text with no key events; scrolling into view is `DOM.scrollIntoViewIfNeeded`, with no wheel
> events; the first action comes a fraction of a second after the page loaded (CDP log, and the test shop's input
> recording for both clients). Akamai, HUMAN, Kasada and reCAPTCHA sensors collect these signals. The owner chose to
> build the input layer now rather than wait for the eval to show a site reacting
> (`packages/flaneur/src/createHumanInput.ts`, on by default in the CLI).

**Rejected.**

- Waiting for the eval before building the input layer — the measurement-first rule of 2026-11-15; the owner
  dropped it for input on 2026-11-21, as every client's input is a known machine pattern
  ([history](history/DECISIONS.md#d4)).
- Waiting for evidence before building the brand — the measurement-first rule the owner set on 2026-11-15; he
  dropped it for the brand once it was the last known leak ([history](history/DECISIONS.md#d4)).
- Fixing only the CDP leaks the measurement shows — the owner wants no traces regardless of measurement
  ([history](history/DECISIONS.md#d4)).
- Stealth inside each client (Patchright, rebrowser-patches, ghost-cursor per helper) — every client and every
  language would need its own copy; the proxy sees all traffic once.
- In-page JS patches (puppeteer-extra-plugin-stealth style) — detectable themselves; that plugin is abandoned since
  2023 and named as detected in DataDome's docs.

## D5

**flaneur enforces a human pace on every site and backs off when a page shows a CAPTCHA or block. Pace: at most one
page load per site every 5 seconds, shared by every client of the browser. A block is recognised passively, from the
page events the proxy already relays to the client: a main document answered 403 or 429, or a request to a known
challenge URL. After a first block the site gets a 5-minute pause and a doubled interval for an hour; a second block
within the hour refuses further actions on that site and tells the agent to ask the person. A wait of up to about 15
seconds is held silently; a longer one is refused with a message saying why and for how long, and the agent's
instructions (the flaneur skill, or the host's own) say such a message is deliberate. A host hands one pace to every
launch, so what it learned of blocks outlives a browser restart.** (2026-11-15, design agent proposal, owner agreed;
adaptive from the first version is the owner's choice; values, recognition and the message chosen by the owner on
2026-11-16 from the Allegro measurement)

**Why.** Blocks after N actions come from volume per session and IP, which no fingerprint fix changes. Enforced in the
proxy, the agent cannot skip it; telling the agent keeps it from treating the wait as a broken browser. A generic pace
fits "any site" ([D1](#d1)). Passive recognition sends nothing a page could observe. agent-browser gives every CDP
command 30 seconds and shows a refusal's text to the agent, so a short hold fits inside a command and a long wait
needs words. A navigation the agent writes in its own page script is counted when its document arrives but not
held: the proxy gates the commands that load pages, and agent-browser's back and forward are such commands, but it
does not read the agent's scripts.

> **Checked 2026-11-16:** Allegro from the owner's home connection, the agent's browser after the launch flag and the
> isolated-world rule: 40 searches at 8-second intervals and 40 at 5-second intervals, each with results in about 1.3
> s, no CAPTCHA. The threshold was not searched for further, to spare the home IP; before the launch flag the same IP
> was flagged after a handful of headless loads.

> **Checked 2026-11-16:** agent-browser v0.43.0 waits 30 seconds for a CDP reply (`cli/src/native/cdp/client.rs:801`)
> and prints a CDP error's text, rewritten only when it contains "timeout" or "intercept"
> (`cli/src/native/browser.rs:237-270`).

**Rejected.**

- Per-site limits only — needs a known list of sites.
- Pace as an instruction to the agent — a hurried agent ignores it.
- A fixed per-site interval first, with CAPTCHA back-off added later — the owner wants the adaptive behaviour from
  the first version (rightsize review, 2026-11-15).
- Reading each loaded page in an isolated world to recognise a block — more precise, but a command after every load
  (owner, 2026-11-16).
- Holding every wait silently — past 30 seconds the agent gets an error it cannot read (owner, 2026-11-16).
- A further Allegro run at a faster interval to find the threshold — not needed for a pace the agent rarely
  reaches, and it would flag the home IP again ([history](history/DECISIONS.md#d5)).

## D6

**Stealth is measured by a repeatable eval over a panel of real protected sites covering the major vendors
(Cloudflare, DataDome via Allegro, Akamai, HUMAN, Kasada, reCAPTCHA v3) plus fingerprint test pages. A layer stays only
if it improves the panel. Ban risk is not measured; it is handled by rules.** (2026-11-15, design agent proposal, owner
agreed)

**Why.** "As good as possible" ([D1](#d1)) needs a number. CAPTCHA rate and actions-until-block are measurable on
the real site; bans are delayed and account-level, and nobody tests them on real accounts.

> **Checked 2026-11-15:** live test pages:
> recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php,
> antcpt.com/eng/information/demo-form/recaptcha-3-test-score.html, abrahamjuliot.github.io/creepjs,
> bot.sannysoft.com, fingerprintjs.github.io/BotD/main, browserscan.net/bot-detection, demo.turnstile.workers.dev,
> bot-detector.rebrowser.net, deviceandbrowserinfo.com/are_you_a_bot. No public DataDome test page found; allegro.pl
> sets a `datadome` cookie, so Allegro is the DataDome test.

**Rejected.**

- Test pages alone — they check single leaks, not whether a real vendor lets the agent through.
- Allegro and a few test pages only, adding a vendor when the agent is blocked by it — the owner wants coverage of
  every major vendor from the start, for "any site" (rightsize review, 2026-11-15).

## D7

**We build our own patched Chromium only if the eval shows a leak that neither a launch flag nor the CDP layer can
fix; then we start from Helium's patch pipeline.** (2026-11-15, design agent proposal, owner agreed)

**Why.** Shipping a Chromium is done; building a modified one is a permanent pipeline: per build 100 GB+ disk, 16 GB+
RAM, "20+ [cores] is not excessive", about an hour on 16 cores, on macOS and Windows, signed, for a milestone every two
weeks plus weekly security refreshes. A browser holding the person's logins that lags security fixes is worse than one
that gets detected. Helium shows a one-day lag is achievable; GPL would not touch flaneur or its host, since the
browser runs as a separate program.

> **Checked 2026-11-15:** build requirements —
> [Windows build docs](https://chromium.googlesource.com/chromium/src/+/main/docs/windows_build_instructions.md);
> two-week milestones since Chrome 153 — [Chrome blog](https://developer.chrome.com/blog/chrome-two-week-release);
> lag vs stable 157.0.8103.78: Helium 1 day, ungoogled-chromium-macos and Thorium one major.

**Rejected.**

- Building our own Chromium up front — the cost is certain and the gain unmeasured.

## D8

**Page scripts never observe our code. flaneur enforces it for every client: the `Runtime`, `Console` and
`Debugger` domains are never enabled in the browser (the proxy answers a client's enable itself), every evaluation
and init script runs in an isolated world, no binding or global is created in the main world, and the brand override
reaches every worker and service worker. No host policy can lift it.** (2026-11-15, owner required hiding
`Runtime.enable` with no traces and robust to change; the class-wide rule is the design agent's proposal, owner agreed)

**Why.** Hiding one leak at a time leaves the others: main-world execution, main-world init scripts, bindings and
worker inconsistency are each tested by public detectors. A rule the proxy enforces cannot be broken by a new
agent-browser version or a helper, and a new way to detect an enabled domain finds nothing, because the domain is
never on. The proxy's stealth rules run after the session and target checks and after a host's policy
(`packages/flaneur/src/checkStealthRequest.ts`; [package API](../../decisions/package-api.md)).

> **Checked 2026-11-15:** agent-browser v0.43.0 (commit 1cc19526) consumes only `Runtime.consoleAPICalled`
> (`console` command, `cli/src/native/actions.rs:1981`) and `Runtime.exceptionThrown` (`errors`, `actions.rs:1999`);
> no execution-context events; evaluation uses the default main-world context; init scripts (`network.rs:175`, the
> React hook) run in the main world. `Runtime.evaluate` and `callFunctionOn` work without `Runtime.enable` ("If the
> parameter is omitted the evaluation will be performed in the context of the inspected page", js_protocol.json).

> **Checked 2026-11-15:** V8 commits 61a907540d and e08e973474 (May 2025) stopped user getters running during
> previews, yet rebrowser bot-detector still detects `Runtime.enable` through `prepareStackTrace` calls and extra
> `error.name` reads (`index.js:21-25`), and tests `mainWorldExecution`, `sourceUrlLeak`, `workerConsistency`,
> `cdpBindingGlobals` — [bot-detector](https://bot-detector.rebrowser.net). Patchright runs all evaluation in
> per-frame isolated worlds (`driver_patches/framesPatch.ts:272`) and drops console support.

> **Checked 2026-11-15:** `Emulation.setUserAgentOverride` is per target; workers and service workers need their
> own (Playwright `crPage.ts:823-828`); `--user-agent` leaves Sec-CH-UA brands unchanged
> (`components/embedder_support/user_agent_utils.cc`).

> **Checked 2026-11-16:** real Google Chrome 157 and CfT 157 on the owner's Mac differ only in `brands` and
> `fullVersionList` (and the `Sec-CH-UA` headers built from them) — on the page, in frames, dedicated, shared and
> service workers; the UA string is the same reduced `Chrome/157.0.0.0`. Chrome's brand order and GREASE brand follow
> from the major version (`GenerateBrandVersionList`, `user_agent_utils.cc` at 157.0.8103.78); a port reproduces real
> Chrome 157 exactly. An emulation override lives as long as the session that set it, and a target held by
> `waitForDebuggerOnStart` from several sessions starts only after all resume — so flaneur's own session holds each
> target until its brand is set. After the brand, the public test pages report no leak; indeed.com and kohls.com
> still block.

**Consequences.** The agent loses agent-browser's `console`, `errors` and `expose`, and cannot read the page's JS
globals (isolated worlds share the DOM, not globals). Playwright works through context events the proxy emulates
(2026-11-21, [playwright-compatibility](../../decisions/playwright-compatibility.md)), within the same limits. Site
helpers work through the DOM; calling a site's internal API with its own client code (X's per-request
header) is out.

**Rejected.**

- Hiding only `Runtime.enable` — main-world execution, init scripts, bindings and workers still leak.
- Emulating context events for clients (rebrowser's approach) — agent-browser consumes none, so dropping the enable
  suffices. *Reopened 2026-11-21: Playwright consumes them; the proxy now emulates them from isolated worlds
  ([playwright-compatibility](../../decisions/playwright-compatibility.md)).*
- A narrow main-world exception for site helpers — it is a trace; the owner chose none.
- Patching agent-browser instead of the proxy — covers one client; the rule must hold for all ([D4](#d4)).

## D9

**The eval is a script that drives the browser by the agent's own path (flaneur's proxy and agent-browser) on a
residential machine, never CI, and writes a result file per run for comparison: a reCAPTCHA v3 score from our own key
on a public test page, the verdicts of the leak test pages, and Allegro searches until a CAPTCHA. Every run also scores
two controls on our key — a plain headless Chrome (a known bot) and the person browsing by hand (a known human) — and
the reCAPTCHA reading counts only once our key separates them.** (2026-11-15, owner asked for a reCAPTCHA measurement;
shape is the design agent's proposal, owner agreed; controls added after the owner asked whether Google's demo page is
more reliable)

**Why.** A datacenter IP would dominate every result; a different driving path would measure a different browser.
The test page must be public: the reCAPTCHA key accepts only its registered domain, and a host may keep the agent's
browser off loopback. The eval lives in `packages/eval` (`bun run eval`).

> **Checked 2026-11-15:** new reCAPTCHA keys are created only in Google Cloud projects; 10,000 assessments a month
> free; without billing only four score levels (0.1, 0.3, 0.7, 0.9) and `LOW_CONFIDENCE_SCORE` on little traffic;
> "Scores in a staging environment and within 7 days of implementation might differ" —
> [FAQ](https://docs.cloud.google.com/recaptcha/docs/faq). Billing: owner chose to enable it for finer
> scores (still free within the quota).

> **Checked 2026-11-15:** Google Cloud project `poweragents-stealth-eval` on the owner's personal account;
> `recaptchaenterprise.googleapis.com` enabled without billing; score-based web key
> `6LeHciEuAAAAAJSL9I_rLsgkmxdwe5IL27QfR_dv` (site keys are public), allowed domain `kedrzu.github.io`. No billing
> account exists on that Google account yet.

> **Checked 2026-11-15:** the first probe page, a text field and a button at `kedrzu.github.io/stealth-eval-page`,
> wrote the token into `#token`, readable from an isolated world. End to end: a token from a Playwright-driven headed
> Chrome (Playwright MCP, residential IP), assessed with `createAssessment`, scored 0.9 with no reasons — one run, no
> billing (four levels), so not conclusive; reCAPTCHA alone may not separate automated from human here, which is why
> it is one reading among the panel ([D6](#d6)).

> **Checked 2026-11-15:** billing is attached to `poweragents-stealth-eval` (gcloud `billingEnabled: True`), so scores
> are no longer limited to four levels. The one-page probe above is replaced by the test shop, which assesses each
> token in the page ([D11](#d11)); the eval reads the scores from it. First runs: the agent's browser averaged 0.68
> and the plain headless Chromium 0.08 over the same visit.

> **2026-11-21:** a second path is measured beside agent-browser: stock Playwright over flaneur's proxy, in a
> Playwright Test suite of journeys on real protected sites (search, product, guest cart), each repeated, with the
> headless control on request — [site-journeys-in-playwright-test](../../decisions/site-journeys-in-playwright-test.md).

**Rejected.**

- Running the eval in CI — datacenter IP.
- Google's public reCAPTCHA demo page — it is over its free quota and returns a fixed 0.9 whatever the browser, and
  says itself that its score means nothing.

  > **Checked 2026-11-15:** recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php: the badge reads "Ta strona
  > przekracza limit bezpłatnych testów reCAPTCHA dla firm" (over the free limit); the page notes "the score returned
  > here is not a reflection on your Google account or type of traffic … Do not raise issues regarding the score you
  > see here"; its backend returned `"score": 0.9`. Over quota without billing, verification "fails open" with a
  > static 0.9 ([migration overview](https://docs.cloud.google.com/recaptcha/docs/migration-overview)).

## D10

**This design covers only the general stealth mechanism and its eval. Ready-made commands for popular sites (site
helpers) are deferred to a design of their own, and how the agent posts on X (official API or browser) is not this
design's question.** (2026-11-15, owner)

**Why.** The owner wants the general mechanism first; whether X writes go through the API is a question about X, not
about stealth.

**Consequences.** A later site-helper design inherits [D8](#d8): helpers work through the page, not the site's own
client code.

**Rejected.**

- Site helpers in this design — deferred by the owner.
- X writes through the official API as part of ban protection — out of scope; earlier proposal in
  [history/JOURNAL.md](history/JOURNAL.md).

## D11

**The reCAPTCHA probe is a small static multi-page shop on GitHub Pages, no backend: a product list with search,
filters and pagination; a product page with a long description, tabs, a gallery and expandable sections; an order or
contact form (text, select, checkbox, date, validation, submit); and a cookie-consent modal. At every meaningful action
the page requests a token named after that action, assesses it at once itself with a public API key restricted to the
reCAPTCHA API and the page's domain, and appends the score to a list in the DOM. It also records how input
arrived — mouse movements before each click, whether text came as key events, the timing between them — into the
DOM. Scenarios ("search, open two products, read a description, submit the form") live in the eval, and the agent, the
headless control and the person run the same ones.** (2026-11-15, owner asked for content that reproduces reading,
submits and component interactions; shape and input recording are the design agent's proposal, owner agreed;
assessment in the page chosen by the owner on 2026-11-15, when building showed the person's run could not be read
otherwise)

**Why.** reCAPTCHA v3 scores actions within a visit, not a single page load, so a page with content measures a
whole visit. Several pages, because moving between pages is the core of what the agent does (search, list, product on
Allegro). A token lives two minutes and can be assessed once, and nothing is attached to the person's own Chrome to read
it in time, so the page assesses each token as it gets it; every runner is then read the same way. Input recording
does not show whether sites react; it shows exactly how the agent's input differs from the person's, which informs
whether to build the input layer ([D4](#d4)) and then checks it. The shop is `packages/eval/shop`, served at
[kedrzu.github.io/flaneur/shop](https://kedrzu.github.io/flaneur/shop/); the scenarios are in `packages/eval/src`.

> **Checked 2026-11-15:** `recaptchaenterprise.googleapis.com` answers a browser `POST …/assessments?key=` from
> `https://kedrzu.github.io` (CORS preflight allows the origin and POST). API key "stealth eval page" in
> `poweragents-stealth-eval`, restricted to that API and referrer `https://kedrzu.github.io/*`;
> `CreateAssessmentRequests` capped at 300 a day. A Playwright-driven headed Chrome on the live shop got per-action
> scores 0.5–1.0.

**Rejected.**

- Tokens left in the DOM for the eval to assess — the person's run in their own Chrome has no eval attached, and its
  early tokens expire before the visit ends ([history](history/DECISIONS.md#d11)).
- A person's run in the agent's browser instead, read over CDP — no key needed, but the control would carry the
  agent's fingerprint and stop being a known human.
- A single page with components — measures clicking, not navigation.
- The first one-page probe (a text field and a button) — no visit to score; it is replaced by the shop.
- Scenarios kept on the page — the eval owns them, so the agent and both controls run identical steps.
