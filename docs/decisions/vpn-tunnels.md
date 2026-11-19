# VPN tunnels and the proxy login

## Status

Accepted

## Context

An agent sometimes needs a site as a person in another country sees it. A VPN on the host would move every program
on the computer, and a failing tunnel would take it offline. The approach is already proven in the Playwright plugin of
`kedrzu/skills`: a [gluetun](https://github.com/qdm12/gluetun) container per region, exposing an HTTP proxy on
`127.0.0.1` that only the browser uses.

Chrome takes a proxy only as `--proxy-server` at launch, and that flag carries no login. An open proxy on `127.0.0.1`
would let every local process, and potentially a page probing the loopback, use the VPN.

## Options Considered

- **No proxy login:** gluetun's proxy open on a random loopback port. The simplest, and nothing runs per request.
  Rejected: anything local can use the tunnel.
- **A proxy login answered over CDP:** what Playwright does. `Fetch.enable` with `handleAuthRequests` on the browser
  target reaches the requests of every page, frame, worker and service worker. Chrome refuses `handleAuthRequests`
  without a pattern, so every request pauses and is let go at once: one message pair on the pipe per request.
- **A local relay** adding the login on its way to gluetun. It would only move the open port, so it gains nothing.

## Decision

The proxy login is answered over CDP, by the browser itself (`createProxyAuth`), at the browser target. Checked on
Chromium before the decision:

- a client's own `Fetch` on a page session still sees and answers that page's requests, beside the browser target's;
- events of the browser target never reach a client, so a client cannot tell;
- a proxy that refuses the login twice for one request gets it cancelled, not answered again in a loop.

A tunnel lasts as long as the process that started it: `--vpn` picks one region for the CLI's lifetime, as Chrome
cannot change its proxy while it runs. `startVpnTunnel` is exported for a host that manages tunnels itself.

## Consequences

- Every request pays one round trip on the pipe. Chrome's own background requests (updates, time checks) are not a
  target's, so they fail at the proxy instead of leaving through the VPN.
- WebRTC is kept from sending UDP past the proxy (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`): its
  STUN requests would tell a page the real address.
- The browser's timezone and language stay the computer's, as they would for a person on a VPN; nothing more is
  spoofed.
- Docker is a requirement of `--vpn` only. Containers carry their owner's PID and are removed by the next start once the
  owner is gone, so a killed CLI leaves a tunnel only until then.
