import { writeFile } from 'node:fs/promises';

import { test } from 'playwright/test';
import type { TestInfo } from 'playwright/test';

import { withTimeout } from '@nzyme/utils/withTimeout.js';

import type { PageFacts } from '../classifyChallenge.js';
import { classifyFailure } from './classifyFailure.js';
import { OUTCOME_ANNOTATION, recordOutcome } from './defineJourney.js';

/** How long each piece of a failed test's evidence may take; a hung page must not hold the teardown. */
export const EVIDENCE_TIMEOUT_MS = 10_000;

/** The most of a failed test's HTML kept: enough for the markup of a challenge or block page. */
const MAX_HTML_LENGTH = 300_000;

/** The browser a project runs the journeys in: flaneur served by the global setup, or a plain headless Chromium as the control. */
export type SitesRunner = 'flaneur' | 'headless';

/** The test fixtures `sitesBaseTest` adds. */
export interface SitesBaseTestFixtures {
    /** What the page showed when the test failed, kept by the fixture that holds the page for the classification done after it closes. */
    failedPage: FailedPage;
}

/** The worker fixtures `sitesBaseTest` adds. */
export interface SitesBaseWorkerFixtures {
    /** Set per project. */
    runner: SitesRunner;
}

/** What the fixture holding the page saw of a failed test's page before closing it. */
export interface FailedPage {
    facts: PageFacts | null;
}

/** How a failed test's page is read for its evidence, by Playwright or by agent-browser. */
export interface EvidenceSource {
    /** Saves a screenshot of the page to `path`. */
    screenshot(path: string): Promise<unknown>;
    html(): Promise<string>;
    /** The page's accessibility tree, as the driver's own locators see it. */
    tree(): Promise<string>;
}

/**
 * What the Playwright and the agent-browser tests of the sites eval share: every failed test ends with exactly one
 * `outcome` annotation, also after a timeout or an error outside a step.
 */
export const sitesBaseTest = test.extend<SitesBaseTestFixtures, SitesBaseWorkerFixtures>({
    runner: ['flaneur', { option: true, scope: 'worker' }],

    // Auto and set up before the page's fixture, so it is torn down after it: it classifies a failure no step did, from
    // the facts read before the tabs closed, even when the page never came up (a worker fixture failed).
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
});

/**
 * Whether the test ended other than expected: its evidence is worth keeping.
 * @util
 */
export function hasFailed(testInfo: TestInfo) {
    return testInfo.status !== testInfo.expectedStatus;
}

/**
 * Attaches a failed test's screenshot, HTML and accessibility tree. Playwright's own screenshot on failure only hooks
 * contexts it creates for the test. All are attached by path: the reporter keeps an attachment's file, and one given
 * as a body has none. A piece the page cannot give (closed, crashed, navigating, hung) is left out; the failure is
 * reported all the same.
 * @util
 */
export async function attachEvidence(testInfo: TestInfo, source: EvidenceSource) {
    try {
        const screenshot = testInfo.outputPath('screenshot.png');
        await withTimeout({ operation: source.screenshot(screenshot), timeoutMs: EVIDENCE_TIMEOUT_MS });
        await testInfo.attach('screenshot', { path: screenshot, contentType: 'image/png' });
    } catch {
        // Left out.
    }
    try {
        const html = await withTimeout({ operation: source.html(), timeoutMs: EVIDENCE_TIMEOUT_MS });
        const file = testInfo.outputPath('page.html');
        await writeFile(file, html.slice(0, MAX_HTML_LENGTH));
        await testInfo.attach('html', { path: file, contentType: 'text/html' });
    } catch {
        // Left out.
    }
    try {
        const tree = await withTimeout({ operation: source.tree(), timeoutMs: EVIDENCE_TIMEOUT_MS });
        const file = testInfo.outputPath('aria.yml');
        await writeFile(file, tree);
        await testInfo.attach('aria', { path: file, contentType: 'text/yaml' });
    } catch {
        // Left out.
    }
}
