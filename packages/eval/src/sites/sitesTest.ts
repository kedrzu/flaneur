import { chromium, test } from 'playwright/test';
import type { BrowserContext, TestInfo } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

import type { PageFacts } from '../classifyChallenge.js';
import { classifyFailure } from './classifyFailure.js';
import { OUTCOME_ANNOTATION, createJourneyStep, readPageFacts, recordOutcome } from './defineJourney.js';
import type { JourneyStep } from './defineJourney.js';
import { SITES_ENDPOINT_VARIABLE } from './serveSitesBrowser.js';

/** How long the screenshot of a failed test's page may take; a hung page must not hold the teardown. */
const SCREENSHOT_TIMEOUT_MS = 10_000;

/** The browser a project runs the journeys in: flaneur served by the global setup, or a plain headless Chromium as the control. */
export type SitesRunner = 'flaneur' | 'headless';

/** The test fixtures `sitesTest` adds. */
export interface SitesTestFixtures {
    /** The step to run a journey's actions in; see `createJourneyStep`. */
    step: JourneyStep;
    /** What the page showed when the test failed, kept by `page` for the classification done after it closes. */
    failedPage: FailedPage;
}

/** The worker fixtures `sitesTest` adds. */
export interface SitesWorkerFixtures {
    /** Set per project. */
    runner: SitesRunner;
    /** The context every test of the worker opens its tab in. */
    sitesContext: BrowserContext;
}

/** What the `page` fixture saw of a failed test's page before closing it. */
export interface FailedPage {
    facts: PageFacts | null;
}

/**
 * Playwright's `test` for the sites eval. `page` is a new tab in the runner's browser, screenshotted when the test
 * fails; every failed test ends with exactly one `outcome` annotation, also after a timeout or an error outside a step.
 */
export const sitesTest = test.extend<SitesTestFixtures, SitesWorkerFixtures>({
    runner: ['flaneur', { option: true, scope: 'worker' }],

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

    // Auto and set up before `page`, so it is torn down after it: it classifies a failure no step did, from the facts
    // `page` read before closing the tab, even when `page` never came up (a worker fixture failed).
    failedPage: [
        // Playwright wants a destructured first argument, and an empty one is a lint error; `runner` is a plain value,
        // so depending on it sets nothing up.
        async ({ runner: _runner }, use, testInfo) => {
            const failedPage: FailedPage = { facts: null };
            await use(failedPage);
            if (
                hasFailed(testInfo) &&
                !testInfo.annotations.some(annotation => annotation.type === OUTCOME_ANNOTATION)
            ) {
                const error = testInfo.errors[0];
                const message = error?.message ?? error?.value ?? 'the test failed without an error';
                recordOutcome(testInfo, { ...classifyFailure(message, failedPage.facts), step: 'outside a step' });
            }
        },
        { auto: true },
    ],

    page: async ({ sitesContext, failedPage, actionTimeout, navigationTimeout }, use, testInfo) => {
        const page = await sitesContext.newPage();
        page.setDefaultTimeout(actionTimeout || 0);
        page.setDefaultNavigationTimeout(navigationTimeout || 0);
        await use(page);
        if (hasFailed(testInfo)) {
            // Playwright's own screenshot on failure only hooks contexts it creates for the test.
            try {
                await testInfo.attach('screenshot', {
                    body: await page.screenshot({ timeout: SCREENSHOT_TIMEOUT_MS }),
                    contentType: 'image/png',
                });
            } catch {
                // A closed or crashed page has nothing to show; the failure is reported all the same.
            }
            failedPage.facts = await readPageFacts(page);
        }
        await page.close();
    },

    step: async ({ page, actionTimeout }, use, testInfo) => {
        await use(createJourneyStep({ page, testInfo, actionTimeout: actionTimeout || 0 }));
    },
});

function hasFailed(testInfo: TestInfo) {
    return testInfo.status !== testInfo.expectedStatus;
}
