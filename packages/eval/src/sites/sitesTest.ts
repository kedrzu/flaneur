import { writeFile } from 'node:fs/promises';

import { chromium, test } from 'playwright/test';
import type { BrowserContext, TestInfo } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';
import { withTimeout } from '@nzyme/utils/withTimeout.js';

import type { PageFacts } from '../classifyChallenge.js';
import { classifyFailure } from './classifyFailure.js';
import { createJourneyTimeline, TIMELINE_ANNOTATION } from './createJourneyTimeline.js';
import type { JourneyTimeline } from './createJourneyTimeline.js';
import { OUTCOME_ANNOTATION, createJourneyStep, readPageFacts, recordOutcome } from './defineJourney.js';
import type { JourneyStep } from './defineJourney.js';
import { SITES_ENDPOINT_VARIABLE } from './serveSitesBrowser.js';
import { FINAL_URL_ANNOTATION } from './summarizeSites.js';

/** How long the screenshot of a failed test's page may take; a hung page must not hold the teardown. */
const SCREENSHOT_TIMEOUT_MS = 10_000;

/** How long reading a failed test's HTML may take, for the same reason. */
const HTML_TIMEOUT_MS = 10_000;

/** The most of a failed test's HTML kept: enough for the markup of a challenge or block page. */
const MAX_HTML_LENGTH = 300_000;

/** The browser a project runs the journeys in: flaneur served by the global setup, or a plain headless Chromium as the control. */
export type SitesRunner = 'flaneur' | 'headless';

/** The test fixtures `sitesTest` adds. */
export interface SitesTestFixtures {
    /** The step to run a journey's actions in; see `createJourneyStep`. */
    step: JourneyStep;
    /** The journey's step timeline, written to the test as its `timeline` annotation. */
    timeline: JourneyTimeline;
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
 * Playwright's `test` for the sites eval. `page` is a new tab in the runner's browser; its final URL is the test's
 * `finalUrl` annotation, and a failed test gets its screenshot and HTML attached. Every failed test ends with exactly
 * one `outcome` annotation, also after a timeout or an error outside a step.
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
        testInfo.annotations.push({ type: FINAL_URL_ANNOTATION, description: page.url() });
        if (hasFailed(testInfo)) {
            // Playwright's own screenshot on failure only hooks contexts it creates for the test. Both are attached by
            // path: the reporter keeps an attachment's file, and one given as a body has none.
            try {
                const screenshot = testInfo.outputPath('screenshot.png');
                await page.screenshot({ path: screenshot, timeout: SCREENSHOT_TIMEOUT_MS });
                await testInfo.attach('screenshot', { path: screenshot, contentType: 'image/png' });
            } catch {
                // A closed or crashed page has nothing to show; the failure is reported all the same.
            }
            try {
                const html = await withTimeout({ operation: page.content(), timeoutMs: HTML_TIMEOUT_MS });
                const file = testInfo.outputPath('page.html');
                await writeFile(file, html.slice(0, MAX_HTML_LENGTH));
                await testInfo.attach('html', { path: file, contentType: 'text/html' });
            } catch {
                // As the screenshot: a page that cannot give its HTML (navigating, closed, hung) leaves none.
            }
            try {
                // The accessibility tree is what a journey's `getByRole` locators match against.
                const tree = await page.locator('body').ariaSnapshot({ timeout: HTML_TIMEOUT_MS });
                const file = testInfo.outputPath('aria.yml');
                await writeFile(file, tree);
                await testInfo.attach('aria', { path: file, contentType: 'text/yaml' });
            } catch {
                // As the HTML.
            }
            failedPage.facts = await readPageFacts(page);
        }
        await page.close();
    },

    timeline: async ({ page }, use, testInfo) => {
        const timeline = createJourneyTimeline(page);
        await use(timeline);
        if (timeline.entries.length > 0) {
            testInfo.annotations.push({ type: TIMELINE_ANNOTATION, description: JSON.stringify(timeline.entries) });
        }
    },

    step: async ({ page, actionTimeout, timeline }, use, testInfo) => {
        await use(createJourneyStep({ page, testInfo, actionTimeout: actionTimeout || 0, timeline }));
    },
});

function hasFailed(testInfo: TestInfo) {
    return testInfo.status !== testInfo.expectedStatus;
}
