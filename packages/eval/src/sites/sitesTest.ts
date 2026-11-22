import { chromium } from 'playwright/test';
import type { BrowserContext } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

import { createJourneyTimeline, createTabTimelineSource, TIMELINE_ANNOTATION } from './createJourneyTimeline.js';
import type { JourneyTimeline } from './createJourneyTimeline.js';
import { createJourneyStep, readPageFacts } from './defineJourney.js';
import type { JourneyStep, JourneyTab } from './defineJourney.js';
import { SITES_ENDPOINT_VARIABLE } from './serveSitesBrowser.js';
import { attachEvidence, EVIDENCE_TIMEOUT_MS, hasFailed, sitesBaseTest } from './sitesBaseTest.js';
import { FINAL_URL_ANNOTATION } from './summarizeSites.js';

/** The test fixtures `sitesTest` adds. */
export interface SitesTestFixtures {
    /**
     * The tab the test acts in: `page` until a journey follows a tab it opened. Its final URL is the test's `finalUrl`
     * annotation, and a failed test gets its screenshot, HTML and accessibility tree attached.
     */
    tab: JourneyTab;
    /** The step to run a journey's actions in; see `createJourneyStep`. */
    step: JourneyStep;
    /** The journey's step timeline, written to the test as its `timeline` annotation. */
    timeline: JourneyTimeline;
}

/** The worker fixtures `sitesTest` adds. */
export interface SitesWorkerFixtures {
    /** The context every test of the worker opens its tab in. */
    sitesContext: BrowserContext;
}

/**
 * Playwright's `test` for the sites eval. `page` is a new tab in the runner's browser; `tab` follows the tab the test
 * ends in and keeps its evidence. Every failed test ends with exactly one `outcome` annotation, also after a timeout or
 * an error outside a step.
 */
export const sitesTest = sitesBaseTest.extend<SitesTestFixtures, SitesWorkerFixtures>({
    sitesContext: [
        async ({ runner }, use) => {
            switch (runner) {
                case 'flaneur': {
                    const endpoint = process.env[SITES_ENDPOINT_VARIABLE];
                    assert(endpoint, `${SITES_ENDPOINT_VARIABLE} is not set: the global setup did not start flaneur`);
                    const browser = await chromium.connectOverCDP(endpoint);
                    // flaneur refuses a new context; its pages live in the default one.
                    const context = browser.contexts()[0];
                    assert(context, 'flaneur gave Playwright no default context');
                    await use(context);
                    // On a browser Playwright connected to, `close` only disconnects: flaneur's Chrome keeps running.
                    await browser.close();
                    break;
                }
                case 'headless': {
                    const browser = await chromium.launch({ headless: true });
                    await use(await browser.newContext());
                    await browser.close();
                    break;
                }
            }
        },
        { scope: 'worker' },
    ],

    page: async ({ sitesContext, actionTimeout, navigationTimeout }, use) => {
        const page = await sitesContext.newPage();
        page.setDefaultTimeout(actionTimeout || 0);
        page.setDefaultNavigationTimeout(navigationTimeout || 0);
        await use(page);
        await page.close();
    },

    // Auto, so a test using only `page` keeps its evidence too; torn down before `page` closes.
    tab: [
        async ({ page, failedPage }, use, testInfo) => {
            const tab: JourneyTab = { page };
            await use(tab);
            testInfo.annotations.push({ type: FINAL_URL_ANNOTATION, description: tab.page.url() });
            if (hasFailed(testInfo)) {
                const { page: failed } = tab;
                await attachEvidence(testInfo, {
                    screenshot: path => failed.screenshot({ path, timeout: EVIDENCE_TIMEOUT_MS }),
                    html: () => failed.content(),
                    // The accessibility tree is what a journey's `getByRole` locators match against.
                    tree: () => failed.locator('body').ariaSnapshot({ timeout: EVIDENCE_TIMEOUT_MS }),
                });
                failedPage.facts = await readPageFacts(tab.page);
            }
            if (tab.page !== page) {
                await tab.page.close();
            }
        },
        { auto: true },
    ],

    timeline: async ({ tab }, use, testInfo) => {
        const timeline = createJourneyTimeline(createTabTimelineSource(tab));
        await use(timeline);
        if (timeline.entries.length > 0) {
            testInfo.annotations.push({ type: TIMELINE_ANNOTATION, description: JSON.stringify(timeline.entries) });
        }
    },

    step: async ({ tab, actionTimeout, timeline }, use, testInfo) => {
        await use(createJourneyStep({ tab, testInfo, actionTimeout: actionTimeout || 0, timeline }));
    },
});
