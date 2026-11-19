# flaneur

> *flâneur* (n.): one who strolls the city, watching everything and noticed by no one.

A stealth Chrome for AI agents. flaneur launches a real Chrome with a persistent profile and serves it over the Chrome
DevTools Protocol (CDP) behind a proxy that keeps the agent's code out of what page scripts can observe, brands every
page as Google Chrome and holds each site to a human pace. Sites see a person browsing, not a bot.

With `--vpn <region>` it browses from another country: only the browser goes through a VPN tunnel in Docker, the rest
of the computer stays on its own network.

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

The CLI, its options and the library API: [`packages/flaneur/README.md`](packages/flaneur/README.md).

## For Claude Code

The repo is a plugin marketplace with one plugin: a `flaneur` skill that teaches the agent to start the browser, drive
it with agent-browser and behave like a person on the sites it visits.

```text
/plugin marketplace add kedrzu/flaneur
/plugin install flaneur@flaneur
```

## Repository

- `packages/flaneur/` — the npm package: library and CLI.
- `plugin/` — the Claude Code plugin and its skill.
- `docs/decisions/` — why the API looks as it does.
- `ARCHITECTURE.md` — how the repo is built.

## License

MIT
