# flaneur

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
npx flaneur [--chrome installed|testing|testing@<version>|<path>] \
    [--user-data-dir <dir>] [--port <n>] [--no-pace] \
    [--vpn <region> --vpn-provider <name>] [-- <chrome args>]
```

It prints one line to stdout, the endpoint `ws://127.0.0.1:<port>/<token>`; logs go to stderr. Whoever has the
endpoint drives the browser: it listens on `127.0.0.1` only and refuses any connection from a web page (one with an
`Origin` header).

- **Chrome:** `--chrome` picks it. `installed`, the default, is the installed Google Chrome. `testing` downloads the
  pinned Chrome for Testing once, checks its SHA-256 and reuses it; `testing@<version>` picks another version,
  downloaded over HTTPS but unverified. A value with a path separator (`/` or `\`) is the path to any Chrome binary.
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

### With agent-browser

```bash
agent-browser --cdp "$(npx flaneur)" open https://example.com
```

Better: start the CLI once in the background, read its first line and pass the endpoint to `agent-browser --cdp` on
every call. Any other client that takes a CDP WebSocket URL works the same way.

## Library

```ts
import { createSitePace, launchStealthBrowser, serveStealthBrowser, startVpnTunnel } from 'flaneur';
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

## In the background

The browser keeps out of the way of the person at the computer: it starts without a window, every page a client
creates opens in a background window of its own, and `Page.bringToFront` and `Target.activateTarget` are answered
without activating anything. The pages still read as visible and focused (`document.visibilityState` is `visible`,
`document.hasFocus()` is `true`), as on a screen someone is looking at.

A tab or popup a page opens itself, such as a click on a `target="_blank"` link or `window.open`, is Chrome's own
doing: it still brings Chrome to the front.

## The price of isolation

Page scripts must never observe the client, so the proxy never enables Runtime, Console or Debugger in the page:

- every evaluation runs in an isolated world, which shares the page's DOM but not its globals, so a client reads the
  page's variables only through the DOM;
- the client gets no page console messages and no execution context events;
- Playwright and Puppeteer do not work: both need an enabled Runtime. They are out on purpose, not a missing feature.
