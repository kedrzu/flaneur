# Eval journal

Hypotheses about why sites detect flaneur, the evidence for and against each, and the verdict. Newest first within a
day. Results files are in `~/.flaneur-eval/results` on the owner's machine; the site journeys are
`packages/eval/src/sites`.

## 2026-11-21

### Evening: journeys that never ran past a point

Runs on fresh profiles, the journeys following links by clicking.

- **flaneur's pace turns a self-solving interstitial into a broken journey.** realestate.com.au and chewy.com answer
  the first load with Kasada's 429 and `ips.js`, etsy.com with DataDome's 403; each solves itself and the real page
  renders. The pace counts the 429/403 as a block and refuses every `Input.*` command for 5 minutes; Playwright
  retries the refused click silently until its timeout, so the journey fails `broken` ("locator.click: Timeout").
  realestate.com.au's search box was never the problem: its call log shows the element visible, enabled and stable
  on every retry.
- **Misclassified as challenged:** ocado.com loads AWS WAF's CAPTCHA SDK (`captcha-sdk.awswaf.com/…/jsapi.js`) and
  xcite.com Imperva's `/_Incapsula_Resource` script on ordinary pages; both now count only on a near-empty page.
  zara.com's "Akamai at the size step" was the login page: `/^Dodaj/` clicked the wishlist button.
- **Not challenged:** skyscanner.pl's results and a result's page, zara.com's cart, kohls.com's cart.

### Harder sites and longer walks

14 sites that refuse plain curl, chosen across vendors (notino.pl, lego.com, kaufland.pl, thalia.de — Cloudflare;
euro.com.pl, hm.com, asos.com, lowes.com — Akamai; homedepot.com, fiverr.com — HUMAN; leroymerlin.pl, seatgeek.com —
DataDome; costco.com — Kasada; hertz.com — Imperva) and four long walks (search, sort, page 2, two products read with
the wheel, cart) on decathlon, zalando, walmart and otto, plus six Google searches in a row. Full run
`2026-11-21T18-52-42Z`: 46 of 50 passed, none challenged; the four failures were page problems, each checked on its
screenshot. Dropped: autozone.com (a DataDome geo rule "Slider rule non US…", not detection), wayfair.com (HUMAN
"Press & Hold" on the first load of a fresh profile — open), leboncoin.fr (below).

**Open — the pace and a hidden challenge frame.** On leboncoin.fr the page shows normally, but its hidden auth iframe
is answered with a DataDome CAPTCHA document; the pace counts the `captcha-delivery.com` request as a block of the site
and refuses the next click for 5 minutes. Not yet known whether a person's browser gets the same hidden CAPTCHA.

### Which journeys measure anything: the headless control

The plain headless Chromium (`--project headless`), one attempt per journey, DataDome sites left out (a headless visit
flags the IP there), after the evening run in which flaneur passed every one of these:

- **The control is challenged — the journey separates a bot from flaneur:** decathlon.pl (Cloudflare challenge page),
  kohls.com, zara.com, sephora.pl (Akamai "Access Denied"), zillow.com, skyscanner.pl (HUMAN), realestate.com.au,
  otto.de (Kasada), google.com (reCAPTCHA on the second search), the reCAPTCHA v2 checkbox (image challenge).
- **The control passes too — the journey tells nothing apart:** x-kom.pl, ikea.com, nike.com, ocado.com, amazon.pl,
  nowsecure.nl, and both reCAPTCHA v3 readings that score the control 0.9: our test shop and antcpt.com. They stay as
  journeys (a site can tighten), but a pass there is no evidence.
- **The control's journey broke before a verdict** (morele, zalando, walmart, gamestop, chewy, booking, redfin, xcite):
  undecided; several are likely silent blocks.

### Evening: the whole panel, twice

After the event fix, the pace grace and the journey fixes, run `2026-11-21T15-56-51Z-sites` (flaneur driven by stock
Playwright, eval profile, home connection, `--repeat-each 2`): 57 of 62 attempts passed. Every journey on every
vendor — Cloudflare, Akamai, HUMAN, DataDome, Kasada, AWS WAF, Imperva, Amazon — passed both attempts, walmart.com,
zillow.com, kohls.com and realestate.com.au included. The failures: zara.com twice, a home page that never fired `load`
(not a block; the journey now waits for the DOM), booking.com twice, its date picker staying open over the results
(fixed); both passed on the rerun. One real challenge: 2captcha's reCAPTCHA v3 scored 0.3 once and 0.9 once; with
0.3, 0.9, 0.7, 0.3 and 0.9 over the day it is noisy, and without a person's reading on the same key it cannot yet tell
how human flaneur looks.

### Cause found: Playwright's DOM events

Walmart, flaneur's installed Chrome, fresh profile, input layer on, each line one or more runs:

|Variant|Result|
|-|-|
|`page.$` + `boundingBox` + `mouse.click`, `keyboard.type`|passes, 3 of 3 (search, results, product page)|
|`locator.click()` on the search box, then `keyboard.type`|challenged after the search|
|`locator.click({ force: true })` (no actionability or hit-target checks)|challenged|
|raw input + `elementHandle.scrollIntoViewIfNeeded()`|passes|
|raw input + two pairs of `__playwright_reset_targets__` / `__playwright_mark_target__` dispatched on the search box|challenged, 2 of 2|

Playwright's injected script, though it runs in an isolated world, dispatches `CustomEvent`s on the shared DOM:
`__playwright_reset_targets__` on `document` and `__playwright_mark_target__` on the target of every locator action
(`markTargetElements`, playwright-core 1.65.1), and `__playwright_global_listeners_check__` on `window` when the
document element is replaced. A page's own listener receives them, and HUMAN listens: adding them to a passing visit
is enough to be challenged. D8's guarantee covered evaluation and bindings, not events dispatched from an isolated
world. Fix: the proxy wraps `dispatchEvent` in every client world so these internal events never leave it.

Also: `page.goto(url, { referer })` sends `Sec-Fetch-Site: none` with a `Referer`, a typed navigation with a
referrer; the proxy drops a `Page.navigate` referrer, and the journeys follow links by clicking.

### Afternoon: narrowing it down

Each experiment changes one thing against the failing setup (Chrome for Testing, eval profile, scripted input, the
old IP); the sites are kohls.com, walmart.com and zillow.com.

|Experiment|Result|Rules out|
|-|-|-|
|New home IP (router reset), same profile|same three challenged on the same steps|the IP's reputation|
|Fresh profile|same|the profile's reputation|
|Person in their own Chrome, same IP, same minutes|all pass|the IP, the country|
|Person in flaneur's installed Chrome, fresh profile, no client attached|all pass|the browser binary, flaneur's flags and brand|
|Person in flaneur's Chrome with Playwright attached (domains on, focus emulation) but idle|Walmart and Zillow pass|an attached CDP client|
|Script on the installed Chrome instead of Chrome for Testing, input layer off and on|same challenges|Chrome for Testing; the input layer alone does not fix it|
|Walmart: click the product link instead of `goto` with a referrer|challenged|—|
|Walmart: 20 s of reading (moves, wheel) before the search|challenged on the results page|time on page|

**kohls.com was a false positive of the eval.** Its normal pages carry `#sec-container`, which the classifier took
for Akamai's challenge page, and the journey expected a results URL Kohl's no longer uses; the screenshot shows
"9,821 results for towels". Fix: the Akamai container counts only on a near-empty page.

**Found tells, not yet the cause:**

- `page.goto(url, { referer })`, which the journeys used to follow links, sends `Sec-Fetch-Site: none` together with a
  `Referer` — a typed-URL navigation that has a referrer, which no browser sends. A click sends `same-origin`.
- `locator.clear()` on an empty field sends a `Delete` key.
- Events recorded from the person and from the input layer match field by field (`pointerId`, pressure, width,
  `sourceCapabilities`, order of pointer, mouse, focus, key and input events, coordinates against the window). What
  differs: the person's moves come with predicted events (`getPredictedEvents()` non-empty), the script's never; the
  person's key presses overlap (`w` released after `e` pressed); the person's window gets an OS `focus`.

**Where it stands:** Walmart (HUMAN) challenges on the results page after a search made by the script, whatever the
time on page, and passes the same search made by hand in the same browser. What remains is the behaviour itself:
the shape of the synthetic mouse paths, missing predicted events, and the window never having OS focus (an attempt to
bring it to the front could not be verified).

### What the first diagnosed run shows

Run `2026-11-21T13-41-09Z-sites` (flaneur driven by Playwright, one attempt per journey, home connection in Poland):
8 of 12 journeys pass; kohls.com, walmart.com, zillow.com and realestate.com.au are challenged, the same four as in
the two runs before it.

|Site|Vendor|Step|Marker|Vendor cookies|
|-|-|-|-|-|
|kohls.com|Akamai|search|Akamai challenge page|`_abck` not validated from load to the challenge (38 s)|
|walmart.com|HUMAN|open a product|`#px-captcha`|`_px3`, `_pxhd` present|
|zillow.com|HUMAN|first click after search|`#px-captcha`|`_px3` present|
|realestate.com.au|Kasada|search, 67 ms after load|`ips.js` on an empty page|`KP_UIDz` present|

zalando.pl passes with Akamai's `_abck` not validated throughout, so that site does not gate on it.

### Ruled out

- **Playwright's CDP footprint.** The public fingerprint pages give the Playwright path the same verdicts as the
  agent-browser path (sannysoft, rebrowser with no test triggered, BotD, CreepJS 31 % "like headless" with the same
  signals, BrowserScan, deviceandbrowserinfo).
- **A brand override missing on some target.** Page, iframe, dedicated worker and service worker all report
  `Google Chrome` brands, before and after a reload. The logged `A brand command failed` errors are for a short-lived
  target that closes before the command lands.

### Open

- **Input is machine-like on both paths.** Measured: a click is one `mouseMoved` at the element's exact centre and an
  instant press and release; text arrives with no key events (agent-browser `type`, Playwright `fill`); scrolling is
  a script jump with no wheel events. The test shop records the same for agent-browser and Playwright. Test: the input
  layer (D4), A/B on fresh profiles.
- **No time on page.** realestate.com.au was searched 67 ms after load. Test: the input layer's wait before the
  first action, alone.
- **Profile reputation.** The eval profile carries vendor cookies from earlier runs. Test: the same journey on a fresh
  profile and on the eval profile, back to back.

### External reCAPTCHA

The test shop no longer separates bot from human: the plain headless Chromium scored 0.9 today (0.08 on
2026-11-15). 2captcha's reCAPTCHA v3 demo gave flaneur 0.3 and antcpt's 0.9 (one reading each), so 2captcha's key is
the external reCAPTCHA measure from now on.
