# Driving the user's own Chrome

## Status

Accepted

## Context

flaneur launches Chrome with a profile of its own, so an agent has none of the user's logins, cookies or context. Some
errands need them: a site the user is signed in to, a session that a fresh profile would have to recreate with a CAPTCHA
or a second factor.

The usual ways to drive a Chrome are closed for the profile the user browses with:

> **Checked 2026-11-20:** since Chrome 136, `--remote-debugging-port` and `--remote-debugging-pipe` are ignored when
> Chrome runs on its default user data folder
> ([developer.chrome.com/blog/remote-debugging-port](https://developer.chrome.com/blog/remote-debugging-port)). The
> change keeps other programs of the same user from reading the user's cookies over CDP.

> **Checked 2026-11-20:** the remote debugging switch in `chrome://inspect` (Chrome 144+) asks the user to approve
> each connection
> ([developer.chrome.com/docs/devtools/agents/get-started/configuration](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)),
> so an agent cannot work on its own.

An extension with the `debugger` permission still gets CDP on the tabs of the real profile through `chrome.debugger`,
and the user does one thing: installs it once. What it reaches was checked before the decision:

> **Checked 2026-11-20** (Chrome for Testing, headless): after `chrome.debugger.attach` a page sees
> `navigator.webdriver === false` and no new globals. Every CDP method the proxy sends to a page works on a tab:
> `Page.*`, isolated worlds, `DOM.resolveNode`, `Runtime.callFunctionOn`, `Input.*`, `Fetch.*`, `Target.setAutoAttach`
> with `flatten` and commands to child sessions by `sessionId`. Browser-level `Target.getTargets`,
> `Target.setDiscoverTargets`, `Target.attachToTarget` and `Browser.*` are refused ("Not allowed"). An MV3 service
> worker with an open native messaging port stayed alive for 110 s with no other activity.

> **Checked 2026-11-20** (Chrome for Testing with a window, macOS): a tab in a covered window without a debugger is
> `hidden`, its timers throttled to once a second. With `Emulation.setFocusEmulationEnabled` through `chrome.debugger`
> it is `visible`, focused and at the full timer rate, as is a background tab of the same window. Detaching and at
> once attaching again does not resize the page.

## Options Considered

- **Copy the user's profile** into a Chrome flaneur launches. Rejected: the cookies are encrypted with a key held by
  the macOS Keychain or, on Windows, an app-bound key, which a copy cannot use; logins do not survive the copy.
- **`chrome://inspect` remote debugging, approved by the user.** No extension to ship. Rejected: every connection
  waits for a click, so every CLI start does.
- **A localhost WebSocket from the extension** instead of native messaging. No host to register. Rejected: a loopback
  port is open to every user of the computer, and a sleeping MV3 worker retries a connection at most every 30 s
  (`chrome.alarms`), while native messaging both wakes it and keeps it alive.
- **A fat extension** that speaks full CDP and emulates the browser target itself. flaneur would connect to it as to
  any Chrome. Trade-off: the emulation would ship through the Chrome Web Store on its own cadence and review, apart from
  the npm package that depends on it, and the extension would execute whatever a local program sends.
- **A thin extension** that executes a small typed protocol (`tabs.*`, `debugger.*`), with the browser-target emulation
  in the npm package.

## Decision

The thin extension, reached through a native messaging host.

- **A typed protocol is the security boundary.** The extension executes only the messages of `OwnChromeProtocol.ts`:
  open, list, close and activate a tab, attach, detach and send a CDP command to one. It opens web pages only
  (`http:`, `https:`, `about:blank`), and a tab outside the user's chosen scope is unknown to flaneur. The `Target.*`
  and `Browser.*` methods `chrome.debugger` refuses are emulated in the package (`createOwnChromeConnection`), behind
  the same proxy, stealth rules, groups and pace as a launched Chrome; any other browser-level method gets a CDP error.
  `OWN_CHROME_PROTOCOL_VERSION` must match on both sides, and a mismatch names the side to update.
- **One CDP session per tab at a time.** `chrome.debugger` allows one attachment per tab per extension, so a second
  `Target.attachToTarget` on a tab is refused while the first session lives.
- **Agent tabs stay attached for the whole connection, with focus emulation.** A tab flaneur creates, and a popup it
  opens, is attached as it appears, so it stays visible and unthrottled in a covered window. When a client's session on
  a tab ends, the tab is detached and attached again, which clears whatever the session left (domains, `Fetch`,
  scripts, bindings, auto-attach). Closing the connection detaches every tab and closes none.
- **A dedicated agent window.** The extension opens agent tabs in one window, created unfocused with the first of them,
  so the user's window keeps the focus. `Target.activateTarget` and `Page.bringToFront` activate the tab and bring its
  window to the front, e.g. for the user to sign in; with a launched Chrome they activate nothing.
- **A native messaging host bridged to a local socket.** Chrome starts the host when the extension connects; the host
  relays native messaging frames to a socket in `<data dir>/own-chrome`, a folder only the user may enter (`0700`), or
  on Windows to a named pipe where other users may only read and the host sends nothing before a client speaks. One
  flaneur at a time: a second gets a `busy` line. The CLI writes the host and its registration again on every start, so
  a moved Node or a new flaneur is picked up.
- **No switch: installing the extension is the consent.** The extension connects to the host whenever Chrome runs,
  at startup and every 30 s while no port is open.
- **The user sets the tab scope:** only the tabs agents open (the default), or every web tab. An agent cannot change it.

## Consequences

- While Chrome runs with the extension, any program running as the same OS user can drive the signed-in Chrome
  through the host's socket: the socket keeps other users out, not other programs of the same user. This is the threat
  Chrome 136 closed for the default profile, accepted here; the yellow bar below is what shows it happening.
- While an agent is attached, Chrome shows its yellow bar saying the flaneur extension is debugging the browser. It
  appears once and shrinks the window's content by its height, which a page sees as any window resize. "Cancel" on the
  bar detaches the debugger, which a client sees as its session on the tab ending.
- No VPN in this mode: Chrome takes a proxy only at launch, and the user's Chrome is already running.
- No brand override: it is real Google Chrome. Focus emulation stays, on agent tabs.
- Agent tabs stay open after the session, as the user's tabs; the next connection does not see them under the "only
  agent tabs" scope.
- The extension's ID is fixed by the `key` in its manifest, since the host manifest admits only that ID; the store
  build gets the same ID ([`docs/publishing-extension.md`](../publishing-extension.md)).
- The automated tests run on Chrome for Testing, which accepts `--load-extension`; regular Chrome 137+ does not, and no
  test has run on regular Google Chrome with a window. **Before the first release with this mode, check it by hand on
  regular Google Chrome with a window:** install the extension, run `flaneur --chrome own`, open a page
  through agent-browser in a covered agent window, and confirm `navigator.webdriver` is `false`, the page is `visible`
  and `Target.activateTarget` brings the window to the front.
