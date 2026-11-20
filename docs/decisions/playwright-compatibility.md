# Stock Playwright through the proxy

## Status

Accepted

Supersedes the "Playwright and Puppeteer are out on purpose" point of [package-api](package-api.md).

## Context

An agent knows Playwright's API better than any other browser API: locators, `getByRole`, auto-waiting,
`ariaSnapshot`, `route`. Before this change it could not drive flaneur with it.

> **Checked 2026-11-20:** stock Playwright 1.64 against `serveStealthBrowser`: `chromium.connectOverCDP` fails with
> "Target.setAutoAttach must be sent on a session of a page". With that command let through, `newPage` fails on
> `_crPages.get(targetId)`, since the proxy's registry claims Chrome's attach events.

Playwright needs two things the proxy did not give a client (Playwright 1.65.1, `playwright-core/lib/coreBundle.js`,
checked 2026-11-20):

- **Pages only from browser-level auto-attach.** It sends `Target.setAutoAttach` at the browser and learns a page from
  its `Target.attachedToTarget`, which must arrive before the reply to its `Target.createTarget` (line 40417).
- **Execution contexts only from Runtime events.** It knows a frame's contexts from `Runtime.executionContextCreated`:
  `auxData.isDefault` is "main", its own world's name is "utility" (lines 39553-39577). The proxy never enables Runtime
  ([D8](../design/stealth-browsing/DECISIONS.md#d8)), so no such event ever came, and `evaluate`, clicks,
  `ariaSnapshot` and screenshots waited forever.

D8 had rejected emulating context events because agent-browser consumes none. Playwright consumes them, so that
premise no longer holds.

## Options Considered

- **Stock Playwright, emulated in the proxy:** the proxy answers what Playwright needs from what it already has.
  Agents use Playwright as they know it. Trade-off: the proxy follows the protocol shapes Playwright relies on, held by
  an integration test pinned to the devDependency's version.
- **An API of our own in Playwright's shape:** `page.goto`, `locator`, `getByRole` and the like, written on raw CDP.
  Full control, but the selector engine, role queries and auto-waiting are Playwright's large injected script to
  rebuild, and an agent reaches for every method we did not write. Its limits would be the same, as they come from D8.

How the emulation is laid out was chosen from three designs that agreed on the mechanism: no new module, with
`connectClient` growing past 600 lines; a public `compat` option of exchangeable emulations per client, a semver
contract with no second consumer; or two internal modules, which won.

## Decision

Stock Playwright, emulated in the proxy, for the launched Chrome and `--chrome own` alike. Nothing new reaches the
browser: Runtime stays off, no client code runs in a page's own world, no binding is made.

- **Execution contexts** (`createExecutionContexts`). A client that sends `Runtime.enable` on a session is told of its
  contexts by the proxy, with ids of the proxy's own. A frame's default context ("main") is the proxy's isolated world;
  each world the client created is announced in every new document. A new document destroys the old one's contexts
  around its `Page.frameNavigated` and announces its own right after, so a call never runs in a document that is gone.
  An id `Page.createIsolatedWorld` returned keeps naming its world after a navigation, as agent-browser relies on.
  A worker's context refuses every call, so `worker.evaluate` fails instead of hanging.
- **Ordering.** Context and lifecycle events of a session wait until the client has the replies to its earlier
  commands, because Playwright starts listening for them only on its `Page.getFrameTree` reply.
- **Browser auto-attach** (`createClientAutoAttach`). The proxy attaches the client itself to every page it sees, the
  one used last first, before replying; to a page it creates before the `Target.createTarget` reply; to popups as they
  appear. Each attach is judged by the proxy's rules and the host's policy, like the client's own.
- **Browser-wide commands.** `Browser.setDownloadBehavior` is answered by the proxy and never sent, since it would
  change downloads for every client and, with `--chrome own`, the user's Chrome.
- **Replies name their session**, as Chrome's do; Playwright matches a reply to its call by session.

## Consequences

- `chromium.connectOverCDP(endpoint)` works without options, in `browser.contexts()[0]`. A second script sees the pages
  the first left open.
- What D8 costs, Playwright pays too: `evaluate` sees the DOM but not the page's globals; `exposeFunction`,
  `exposeBinding`, console and `pageerror` events are out; `addInitScript` runs in an isolated world;
  `browser.newContext()` fails, as browser contexts are the proxy's. The refusals come at once, with the reason.
- With `--chrome own`, cookie and permission methods of the context fail, as `chrome.debugger` reaches tabs only, and
  one client drives a tab at a time.
- A popup reaches Playwright already running, not held for it as Chrome's own auto-attach would hold it; the lifecycle
  ordering above makes up for it. Holding popups for clients would need the brand's hold to wait for them.
- A Playwright upgrade can move what the emulation answers; `playwright.test.ts` and the `--chrome own` extension test
  catch it.
