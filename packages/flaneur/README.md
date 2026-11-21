<h1 align="center">
  <img alt="flaneur" src="https://raw.githubusercontent.com/kedrzu/flaneur/main/docs/brand/lockup.svg" height="96">
</h1>

> *flâneur* (n.): one who strolls the city, watching everything and noticed by no one.

A stealth Chrome for AI agents, driven over the Chrome DevTools Protocol (CDP). It is the same ordinary browser
every day: a real Chrome with a persistent profile, launched over a pipe so no other local process can reach it, and
a proxy in front of it that keeps the client's code out of what page scripts can observe. Nothing is spoofed but the
Chromium brand: every page and worker names itself Google Chrome, as the installed Chrome would. Why the API looks as
it does: [`docs/decisions/package-api.md`](../../docs/decisions/package-api.md).

Runs on Node.js 22+ and Bun.

## Install

```bash
npm install flaneur   # Node.js
bun add flaneur       # Bun
```

Or run the CLI without installing: `npx flaneur` on Node, `bunx --bun flaneur` on Bun. Without `--bun`, `bunx`
honours the CLI's `node` shebang and runs it on Node when Node is installed.

## CLI

```bash
npx flaneur [--chrome installed|own|testing|testing@<version>|<path>] \
    [--user-data-dir <dir>] [--port <n>] [--no-pace] \
    [--vpn <region> --vpn-provider <name>] [-- <chrome args>]
```

It prints one line to stdout, the endpoint `ws://127.0.0.1:<port>/<token>`; logs go to stderr. Whoever has the
endpoint drives the browser: it listens on `127.0.0.1` only and refuses any connection from a web page (one with an
`Origin` header).

- **Chrome:** `--chrome` picks it. `installed`, the default, is the installed Google Chrome. `testing` downloads the
  pinned Chrome for Testing once, checks its SHA-256 and reuses it; `testing@<version>` picks another version,
  downloaded over HTTPS but unverified. A value with a path separator (`/` or `\`) is the path to any Chrome binary.
  `own` is your own running Chrome, with your profile and logins, through the flaneur extension (see below).
- **Profile and cache:** a persistent profile and the Chrome for Testing cache live in `flaneur/` in the
  user's app data: `~/Library/Application Support` on macOS, `%LOCALAPPDATA%` on Windows,
  `${XDG_DATA_HOME:-~/.local/share}` on Linux. `--user-data-dir` sets another profile.
- **Pace:** each site gets at most one page load every 5 s, and is paused, then slowed, after it blocks or challenges
  the browser. `--no-pace` turns that off.
- **VPN:** `--vpn "US Texas" --vpn-provider "private internet access"` sends the browser, and only the browser,
  through a VPN server region (see below).
- **Exit:** non-zero when Chrome exits or the start fails; SIGINT and SIGTERM close the browser cleanly.

> [!WARNING]
> There is no headless mode on purpose. Headless Chrome reports `HeadlessChrome` in its user agent, and the brand
> passes the user agent through as it is, so `-- --headless=new` gives the browser away to every site.

### Through a VPN

`--vpn <region>` starts a [gluetun](https://github.com/qdm12/gluetun) container and sends every request of the
browser through it. Nothing else on the computer uses the VPN, and a failing tunnel cannot take it offline.

```bash
FLANEUR_VPN_USER=… FLANEUR_VPN_PASSWORD=… npx flaneur --vpn "US Texas" --vpn-provider "private internet access"
```

- **Docker is required.** `--vpn-provider` is gluetun's `VPN_SERVICE_PROVIDER`, `--vpn` one of its server regions
  (`SERVER_REGIONS`); an unknown region fails with the valid ones.
- **The login** comes from `FLANEUR_VPN_USER` and `FLANEUR_VPN_PASSWORD` only, never from the command line. It
  reaches gluetun as a secret file deleted once the tunnel is up.
- **The address** the tunnel got and where ipinfo places it are logged once it is up. A site's own geolocation may
  differ, so confirm the location with the site.
- **The first start is slow:** the image is pulled once and the provider's server list is refreshed daily into a Docker
  volume. A tunnel that does not connect in 90 s fails the start with OpenVPN's last messages.
- **Cleanup:** the container goes when the CLI exits; one left by a killed CLI goes on the next VPN start.
- **No Docker, no browser.** When Docker is not installed or not running, or the tunnel does not come up, the CLI exits
  with an error before Chrome starts. It never falls back to browsing without the VPN.

How it works:

1. The CLI starts gluetun with the VPN login and gluetun's HTTP proxy on, published on a random port of `127.0.0.1`.
   The proxy wants a login made up for this run, so no other local program can use the tunnel.
2. It waits until gluetun's healthcheck passes and gluetun knows the tunnel's public address, which it asks for on
   gluetun's control server, behind a random key of its own.
3. Chrome starts with `--proxy-server` pointing at the tunnel. Chrome takes no proxy login on its command line, so
   flaneur answers the proxy's challenges over CDP (`Fetch` on the browser target): each request pauses there for a
   moment and goes on. Pages see nothing of it, clients get none of its events, and a client's own `Fetch` on a page
   works as before.
4. WebRTC may not send UDP past the proxy, so its STUN requests cannot reveal the real address. The browser's timezone
   and language stay the computer's, as they would for a person on a VPN.

The region holds for the CLI's lifetime, as Chrome cannot change its proxy while it runs: another region is another
start. Why the login goes over CDP: [`docs/decisions/vpn-tunnels.md`](../../docs/decisions/vpn-tunnels.md).

### Your own Chrome

`--chrome own` drives the browser you browse with, signed in to the sites you are signed in to, through the flaneur
extension: Google Chrome or any other Chromium browser (Arc, Brave, Edge, Vivaldi, Opera, Chromium). The endpoint, the
stealth rules and the pace are the same as with a launched Chrome.

```bash
npx flaneur --chrome own
```

Once, in your browser:

1. Install the extension. Until it is on the Chrome Web Store: `bun run build` in a clone of this repo, then in the
   browser's extensions page (`chrome://extensions`) switch on Developer mode, **Load unpacked** and pick
   `packages/chrome-extension`.
2. Optionally, in the extension's options (click its icon), choose which tabs agents can use: **only tabs the agent
   opens** (the default) or **all my tabs**. Changing it disconnects a connected agent, which connects again with the
   new choice.

Installing the extension is the consent: it connects to flaneur whenever the browser runs.

flaneur finds your browsers by itself: it registers its native messaging host in every Chromium browser's user data
folder (a folder with `Local State` and `Default/Extensions`; on Windows, under the registry key derived from it, and
Google Chrome's and Chromium's), so the extension reaches it from whichever browser it is in. The manifest admits only
the flaneur extension.

When no browser is connected, the CLI starts the one the extension last connected from, without flags, or Google
Chrome before the first connection, and waits 45 s for the extension; without it, it exits with code 1 and says where
to install the extension. The extension's icon shows `ON` while an agent is connected.

A browser flaneur cannot find (a portable one, one started with its own `--user-data-dir`, a Windows browser with a
registry key of its own) is set up once, by you:

```bash
npx flaneur setup --browser-data "/path/to/the/browser's/user data"      # macOS, Linux
npx flaneur setup --registry-key "HKCU\Software\<Vendor>\<Browser>\NativeMessagingHosts"   # Windows
```

They are kept in `config.json` in flaneur's data folder and used on every later `--chrome own`. `flaneur setup` alone
registers the host again and prints where, and which browser it remembers.

- **A window of its own:** the agent's tabs open in one agent window, created without focus, so your window keeps it.
  They still read as visible and focused. `Target.activateTarget` and `Page.bringToFront` activate the tab and bring
  that window to the front, e.g. for you to sign in.
- **Its tabs stay open** when the CLI stops; flaneur only lets go of them. They are then yours: the next agent does
  not see them unless it may use all tabs.
- **One client per tab at a time:** a second client attaching to a tab is refused until the first detaches.
- **Web pages only:** the agent opens and sees `http:`, `https:` and `about:blank` tabs, never Chrome's own pages or
  extensions.
- **Not in this mode:** `--vpn`, `--user-data-dir` and Chrome arguments after `--`, which all shape a Chrome flaneur
  starts. One CLI per browser: a second gets an error. With the extension in several browsers or profiles, the first
  to connect is the one driven.
- **The yellow bar:** while the extension is attached, Chrome shows a bar saying flaneur is debugging the browser. It
  shrinks the window's content once, as any window resize does. **Cancel** on it detaches the agent from its tabs.
- **Exit:** code 1 when Chrome closes, or the extension is turned off, removed or reloaded.

How it works: the extension drives tabs through `chrome.debugger` and talks to a native messaging host, a small
script Chrome starts. On each start the CLI copies the host into `own-chrome/` of its app data folder and registers it
for Chrome: a manifest in Chrome's `NativeMessagingHosts` folder (macOS, Linux) or the registry (Windows), admitting
the flaneur extension only. The host relays between Chrome and a local socket the CLI connects to. `chrome.debugger`
reaches tabs only, so the browser-level `Target.*` and `Browser.*` methods are emulated in flaneur, in front of the
same proxy as a launched Chrome.

Security: the socket lives in a folder only you may enter (`0700`; on Windows a named pipe the host stays silent on
until the client speaks), which keeps other users out but not other programs you run: while Chrome runs with the
extension, any program running as you can drive your signed-in Chrome. That is the threat for which Chrome 136 stopped
debugging switches on your own profile; the yellow bar shows when it happens. Remove or turn off the extension in
`chrome://extensions` when you do not want it. Why it is built this way: [`docs/decisions/own-chrome.md`](../../docs/decisions/own-chrome.md).

### With Playwright

Stock Playwright connects to the endpoint and works in the browser's one context:

```ts
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://example.com');
console.log(await page.getByRole('paragraph').first().textContent());
await browser.close(); // disconnects; the pages stay open for the next script
```

Locators, auto-waiting, `fill`, `evaluate`, screenshots, `ariaSnapshot`, `route`, popups and frames work, on a launched
Chrome and on `--chrome own`. A script connecting later sees the pages an earlier one left, the one used last first.
What does not, because page scripts must never observe the client ([The price of isolation](#the-price-of-isolation)):

- `evaluate` and `addInitScript` run in an isolated world: the page's DOM, not its globals, and the page never sees
  theirs;
- `exposeFunction`, `exposeBinding`, `console` and `pageerror` events;
- `browser.newContext()` and `browser.newPage()`: there is one profile, so use `browser.contexts()[0]`; context
  options such as `userAgent` or `locale` come with a new context, so they are out too;
- `worker.evaluate` fails; download events never fire;
- `page.setContent()` waits for a console message of its own, so it hangs until its timeout: `goto` a `data:text/html`
  URL instead;
- with `--chrome own`: the context's cookie and permission methods (`cookies()`, `storageState()`,
  `grantPermissions()`), which need the browser target, and a tab another client already drives.

Navigations keep to the pace: a second load of a site within seconds waits, and `goto` with it. How it works:
[`docs/decisions/playwright-compatibility.md`](../../docs/decisions/playwright-compatibility.md).

### With agent-browser

```bash
agent-browser --cdp "$(npx flaneur)" open https://example.com
```

Better: start the CLI once in the background, read its first line and pass the endpoint to `agent-browser --cdp` on
every call. Any other client that takes a CDP WebSocket URL works the same way.

## Library

```ts
import {
    connectOwnChrome,
    createSitePace,
    launchStealthBrowser,
    serveBrowser,
    serveStealthBrowser,
    startVpnTunnel,
} from 'flaneur';
```

- `launchStealthBrowser({ executablePath, userDataDir, args?, proxy?, policy?, pace?, logger? })` launches Chrome over
  `--remote-debugging-pipe` and resolves once every new target is branded. `browser.connect(socket, { group, data })`
  adds a client on any socket-like object (`send`, `close`); the caller feeds it the socket's messages. A client with a
  `group` sees only that group's pages, and pages it creates join the group. `browser.send` and `browser.attach` are
  the host's own channel, which clients never see.
- `policy(request, client)` judges every client command: pass it on (rewritten or not), answer it, or refuse it. It
  runs after the proxy's session and target checks and before its stealth rules, which no policy can lift.
- `createSitePace()` creates the human pace. Hand the same pace to each launch: what it learned of blocks outlives a
  browser restart.
- `serveStealthBrowser(options & { port? })` is what the CLI runs: it launches the browser and serves it at a
  tokenised `127.0.0.1` endpoint, each socket a client with no group. `close()` stops both. `serveBrowser(browser,
  { port?, logger? })` is its serving half, for a browser already started.
- `proxy: { server, username?, password? }` on a launch sends every request through an HTTP proxy. Chrome takes no
  proxy login on its command line, so the browser answers the proxy's challenges itself over CDP (`Fetch` on the
  browser target, unseen by pages and clients); a client's own `Fetch` on a page keeps working.
- `startVpnTunnel({ provider, region, credentials, logger? })` starts a VPN tunnel as `--vpn` does and resolves with
  its `proxy` for the launch, its `publicIp` and `ipGeolocation`; `close()` removes it.
- `installChromeForTesting({ cacheDir, version?, sha256?, baseUrl? })` installs Chrome for Testing into
  `<cacheDir>/<version>-<platform>/`, a folder that exists only once a verified archive is fully unpacked; concurrent
  calls share one download. `findChromeForTesting({ cacheDir, version? })` finds it without downloading.
  `findChrome()` finds the installed Google Chrome in its standard place.
- `connectOwnChrome({ dataDir, policy?, pace?, logger? })` is `--chrome own`: it registers the native messaging host
  in `<dataDir>/own-chrome`, starts Chrome when it is not running, and resolves with the browser once the extension
  connects, within 45 s (`timeoutMs`). Serve it with `serveBrowser`; closing it detaches the extension from every tab
  and leaves Chrome and its tabs open.

## In the background

The browser keeps out of the way of the person at the computer: it starts without a window, every page a client
creates opens in a background window of its own, and `Page.bringToFront` and `Target.activateTarget` are answered
without activating anything. The pages still read as visible and focused (`document.visibilityState` is `visible`,
`document.hasFocus()` is `true`), as on a screen someone is looking at.

A tab or popup a page opens itself, such as a click on a `target="_blank"` link or `window.open`, is Chrome's own
doing: it still brings Chrome to the front.

This is the launched Chrome; your own Chrome has an agent window instead ([Your own Chrome](#your-own-chrome)).

## The price of isolation

Page scripts must never observe the client, so the proxy never enables Runtime, Console or Debugger in the page:

- every evaluation runs in an isolated world, which shares the page's DOM but not its globals, so a client reads the
  page's variables only through the DOM;
- the client gets no page console messages; the execution context events it gets are the proxy's, for isolated
  worlds;
- with Playwright, `evaluate` sees the page's DOM but not its globals; `exposeFunction`, `exposeBinding`, `console` and
  `pageerror` events and `browser.newContext()` fail at once, saying why ([With Playwright](#with-playwright)).
