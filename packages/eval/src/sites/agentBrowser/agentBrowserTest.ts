import { randomUUID } from 'node:crypto';

import { assert } from '@nzyme/utils/assert.js';

import { AgentBrowserError } from '../../createAgentBrowserCli.js';
import { installAgentBrowser } from '../../installAgentBrowser.js';
import { createJourneyTimeline, TIMELINE_ANNOTATION } from '../createJourneyTimeline.js';
import type { JourneyTimeline } from '../createJourneyTimeline.js';
import { createStepRunner, OPTIONAL_STEP_TIMEOUT_MS, readFactsWith } from '../defineJourney.js';
import type { StepRunner } from '../defineJourney.js';
import { SITES_ENDPOINT_VARIABLE, SITES_STATE_FOLDER } from '../serveSitesBrowser.js';
import { attachEvidence, hasFailed, sitesBaseTest } from '../sitesBaseTest.js';
import { FINAL_URL_ANNOTATION } from '../summarizeSites.js';
import { openAgentBrowser } from './openAgentBrowser.js';
import type { AgentBrowser } from './openAgentBrowser.js';

/** The test fixtures `agentBrowserTest` adds. */
export interface AgentBrowserTestFixtures {
    /**
     * An agent-browser session of its own on the flaneur the global setup serves, in a tab it opens and closes. Its
     * final URL is the test's `finalUrl` annotation, and a failed test gets its screenshot, HTML and snapshot attached.
     */
    ab: AgentBrowser;
    /** The step to run a journey's commands in; see `createStepRunner`. */
    step: StepRunner;
    /** The journey's step timeline, written to the test as its `timeline` annotation. */
    timeline: JourneyTimeline;
}

/** The worker fixtures `agentBrowserTest` adds. */
export interface AgentBrowserWorkerFixtures {
    /** The pinned agent-browser, downloaded into the eval's state folder on first use. */
    agentBrowserExecutable: string;
}

/** The action timeout when the project sets none: Playwright's in the sites eval. */
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

/**
 * The sites eval's `test` for the `agent-browser` project: the journeys run as agent-browser commands over the same
 * flaneur, pace and human input the `flaneur` project's Playwright drives, and fail, are classified and keep their
 * evidence as there.
 */
export const agentBrowserTest = sitesBaseTest.extend<AgentBrowserTestFixtures, AgentBrowserWorkerFixtures>({
    agentBrowserExecutable: [
        // `runner` is a plain value, so depending on it sets nothing up; Playwright wants a destructured argument.
        async ({ runner: _runner }, use) => {
            await use(await installAgentBrowser(SITES_STATE_FOLDER));
        },
        { scope: 'worker' },
    ],

    // Auto, so a test that fails before its first command keeps its evidence too.
    ab: [
        async ({ agentBrowserExecutable, failedPage, actionTimeout }, use, testInfo) => {
            const endpoint = process.env[SITES_ENDPOINT_VARIABLE];
            assert(endpoint, `${SITES_ENDPOINT_VARIABLE} is not set: the global setup did not start flaneur`);
            const session = await openAgentBrowser({
                executable: agentBrowserExecutable,
                endpoint,
                session: `flaneur-sites-${randomUUID()}`,
                actionTimeoutMs: actionTimeout || DEFAULT_ACTION_TIMEOUT_MS,
            });
            const { ab } = session;
            try {
                await use(ab);
                testInfo.annotations.push({ type: FINAL_URL_ANNOTATION, description: await ab.url().catch(() => '') });
                if (hasFailed(testInfo)) {
                    await attachEvidence(testInfo, {
                        screenshot: path => ab.screenshot(path),
                        html: () => readHtml(ab),
                        // The snapshot is what the journey's commands found their targets in.
                        tree: async () => (await ab.snapshot()).text,
                    });
                    failedPage.facts = await readFactsWith(expression => ab.eval(expression));
                }
            } finally {
                await session.close();
            }
        },
        { auto: true },
    ],

    timeline: async ({ ab }, use, testInfo) => {
        const timeline = createJourneyTimeline({
            readUrl: () => ab.url(),
            readCookies: () => ab.cookies(),
            // agent-browser shows no frame tree; a challenge frame inside a subframe goes unseen here.
            findNestedChallenges: () => Promise.resolve([]),
        });
        await use(timeline);
        if (timeline.entries.length > 0) {
            testInfo.annotations.push({ type: TIMELINE_ANNOTATION, description: JSON.stringify(timeline.entries) });
        }
    },

    step: async ({ ab, timeline }, use, testInfo) => {
        await use(
            createStepRunner({
                testInfo,
                timeline,
                browser: {
                    readFacts: () => readFactsWith(expression => ab.eval(expression)),
                    runOptional: action => ab.withActionTimeout(OPTIONAL_STEP_TIMEOUT_MS, action),
                    isMissingTarget: error => error instanceof AgentBrowserError && error.missingTarget,
                },
            }),
        );
    },
});

async function readHtml(ab: AgentBrowser) {
    const html = await ab.eval('document.documentElement.outerHTML');
    return typeof html === 'string' ? html : '';
}
