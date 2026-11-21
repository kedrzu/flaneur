import { expect } from 'playwright/test';

import { agentBrowserTest } from '../agentBrowser/agentBrowserTest.js';
import { defineAgentBrowserJourney } from '../agentBrowser/defineAgentBrowserJourney.js';
import { submitSearch } from '../agentBrowser/submitSearch.js';
import { JourneyFailure, runJourney } from '../defineJourney.js';
import { serveSelftestPages } from './selftestTest.js';
import type { SelftestWorkerFixtures } from './selftestTest.js';

const test = agentBrowserTest.extend<object, SelftestWorkerFixtures>({
    selftestOrigin: [
        // Playwright wants a destructured first argument; `runner` is a plain value, so depending on it sets nothing up.
        async ({ runner: _runner }, use) => {
            await serveSelftestPages(use);
        },
        { scope: 'worker' },
    ],
});

test('an agent-browser journey through the mini shop passes, skipping an absent cookie banner', async ({
    ab,
    step,
    selftestOrigin,
}) => {
    await runJourney(createMiniShopJourney(selftestOrigin), ab, step);
});

test('an agent-browser journey that meets a HUMAN challenge fails as challenged, its cookies in the timeline', async ({
    ab,
    step,
    timeline,
    selftestOrigin,
}) => {
    const failure = await runJourney(createChallengeJourney(selftestOrigin), ab, step).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JourneyFailure);
    expect(failure).toMatchObject({
        outcome: { class: 'challenged', vendor: 'HUMAN', step: 'search', evidence: 'HUMAN #px-captcha' },
    });
    expect(timeline.entries.map(entry => entry.step)).toEqual(['start', 'open the site', 'search']);
    const cookies = timeline.entries.at(-1)?.cookies;
    expect(cookies?.abck).toBe('invalid');
    expect(cookies?.names.toSorted()).toEqual(['_abck', '_px3']);
});

test('an agent-browser journey goes on in the tab a link opened: its challenge, its timeline', async ({
    ab,
    step,
    timeline,
    selftestOrigin,
}) => {
    const failure = await runJourney(createNewTabJourney(selftestOrigin), ab, step).catch((error: unknown) => error);

    expect(failure).toMatchObject({ outcome: { class: 'challenged', vendor: 'HUMAN', step: 'after the journey' } });
    expect(timeline.entries.at(-1)?.url).toBe(`${selftestOrigin}/challenge.html`);
});

/** Search, a product, the cart, as an agent reads and acts; with a cookie banner the mini shop never shows. */
function createMiniShopJourney(origin: string) {
    return defineAgentBrowserJourney({
        name: 'mini shop',
        vendor: 'HUMAN',
        url: `${origin}/`,
        run: async (ab, step) => {
            await step('open the shop', async () => {
                await ab.open(`${origin}/`);
            });
            await step(
                'accept cookies',
                async () => {
                    await ab.clickRole('button', 'Accept all');
                },
                { optional: true },
            );
            await step('search', async () => {
                await submitSearch(ab, { role: 'searchbox', name: /^Search$/ }, 'kettle');
                await ab.waitForUrl(/\/search\.html\?q=kettle/);
            });
            await step('open a product', async () => {
                await ab.click({ role: 'link', name: /^Electric Kettle$/ });
                await ab.findRef({ role: 'heading', name: /^Electric Kettle$/ });
            });
            await step('add to cart', async () => {
                await ab.clickRole('button', 'Add to cart');
                await ab.findRef({ role: 'link', name: /^Cart \(1\)$/ });
            });
            await step('open the cart', async () => {
                await ab.clickRole('link', 'Cart (1)', { exact: true });
                await ab.waitForUrl(/\/cart\.html/);
            });
        },
    });
}

/** Opens the mini shop's store locator, which opens in a new tab and shows HUMAN's "Press & Hold". */
function createNewTabJourney(origin: string) {
    return defineAgentBrowserJourney({
        name: 'new tab',
        vendor: 'HUMAN',
        url: `${origin}/`,
        run: async (ab, step) => {
            await step('open the shop', async () => {
                await ab.open(`${origin}/`);
            });
            await step('open the store locator', async () => {
                await ab.clickRole('link', 'Store locator');
            });
        },
    });
}

/** Opens a page showing HUMAN's "Press & Hold", then tries to search on it. */
function createChallengeJourney(origin: string) {
    return defineAgentBrowserJourney({
        name: 'challenge',
        vendor: 'HUMAN',
        url: `${origin}/challenge.html`,
        run: async (ab, step) => {
            await step('open the site', async () => {
                await ab.open(`${origin}/challenge.html`);
            });
            await step('search', async () => {
                await submitSearch(ab, { role: 'searchbox', name: /^Search$/ }, 'kettle');
            });
        },
    });
}
