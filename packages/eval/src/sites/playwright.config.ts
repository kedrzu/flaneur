import path from 'node:path';

import { defineConfig } from 'playwright/test';

import { SITES_STATE_FOLDER } from './serveSitesBrowser.js';
import type { SitesBaseTestFixtures, SitesBaseWorkerFixtures } from './sitesBaseTest.js';

/**
 * Names the run's output folder. Set once, when the runner loads this config; its workers load the config again and
 * inherit the variable, so they write to the same folder. A folder per run keeps the screenshots of earlier runs, which
 * Playwright would wipe from a fixed `outputDir`.
 */
const RUN_FOLDER_VARIABLE = 'FLANEUR_SITES_RUN_FOLDER';

const runFolder = (process.env[RUN_FOLDER_VARIABLE] ??= new Date().toISOString().replaceAll(':', '-'));

/** The `agent-browser` project's specs; the Playwright projects leave them out. */
const AGENT_BROWSER_SPECS = '**/agentBrowser/**/*.spec.ts';

/**
 * The sites eval: journeys on real protected sites, one at a time, in flaneur driven by Playwright (`flaneur`) or by
 * agent-browser (`agent-browser`), and in a headless control. The selftest has its own config (`selftest.config.ts`).
 */
export default defineConfig<SitesBaseTestFixtures, SitesBaseWorkerFixtures>({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    // One browser and one pace for the whole run: the journeys never run side by side.
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 5 * 60_000,
    // A page load can be held up to 15 s by the pace, so an assertion after one waits as long as an action.
    expect: { timeout: 30_000 },
    use: { actionTimeout: 30_000, navigationTimeout: 60_000 },
    outputDir: path.join(SITES_STATE_FOLDER, 'sites', runFolder),
    globalSetup: './globalSetup.ts',
    reporter: [['list'], ['./consistencyReporter.ts']],
    projects: [
        { name: 'flaneur', use: { runner: 'flaneur' }, testIgnore: ['**/selftest/**', AGENT_BROWSER_SPECS] },
        { name: 'headless', use: { runner: 'headless' }, testIgnore: ['**/selftest/**', AGENT_BROWSER_SPECS] },
        // The same flaneur, pace and human input as `flaneur`; `workers: 1` keeps the two from sharing the profile at once.
        { name: 'agent-browser', use: { runner: 'flaneur' }, testMatch: AGENT_BROWSER_SPECS },
    ],
});
