# Site journeys in Playwright Test

## Status

Accepted

## Context

The eval (`bun run eval`) loads each protected site's home page once, and drives flaneur only through agent-browser.
Since [playwright-compatibility](playwright-compatibility.md), an agent can drive flaneur with stock Playwright, and
the question became whether a Playwright script gets through real sites consistently: protection often reacts to the
second or third action, not the first page load. That needs journeys of several steps on real sites, each repeated.

> **Checked 2026-11-21:** Playwright Test 1.65.1, run by its own CLI on Node, loads specs importing `flaneur` and the
> eval's sources; `chromium.connectOverCDP` to `serveStealthBrowser` gives `contexts()[0]`, `getByRole`, `goto` and
> cookies. `--repeat-each` runs repeats in turns (all tests, then all again). The runner restarts its worker after
> every failed test (`playwright/lib/worker/workerProcessEntry.js`, `_isStopped` on a failure).

## Options Considered

- **A probe and a runner in `bun run eval`:** journeys as one more probe, a `playwright` runner beside `agent`, the
  readings in `compare`. Trade-off: the eval's own loop, repeats and reporting to write; one comparison for every
  probe.
- **A Playwright Test suite:** journeys as tests, `--repeat-each`, `--grep`, projects for flaneur and the control, a
  reporter of our own for the consistency table. Trade-off: its own report beside `compare`; Node instead of Bun.

## Decision

A Playwright Test suite in `packages/eval/src/sites`, the owner's choice: journeys are written the way an agent
writes Playwright, and the runner's selection, repeats and failure screenshots come for free.

- flaneur is served once per run from the global setup, in the runner's process, so one browser and one pace see the
  whole run despite worker restarts; workers connect over CDP. The control is a plain headless Chromium project.
- A failed attempt is `challenged`, `refused` or `broken`, from the page's challenge markers (shared with the panel
  probe) and flaneur's pace refusals; a reporter counts passes over executed attempts per journey and project.
- Journeys never go past a guest cart.

## Consequences

- Two reports: `bun run eval compare` for the probes, the suite's table and `<time>-sites.json` for the journeys.
- The suite runs on Node, so what it imports from the eval uses no Bun API (`runScenario` sleeps with
  `node:timers/promises`).
- Playwright's own traces and screenshots do not hook flaneur's default context; the suite attaches a screenshot of a
  failed page itself.
- Real sites change; a journey that turns `broken` is maintenance, not a measurement.
