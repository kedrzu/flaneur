import path from 'node:path';

import { defineConfig } from 'playwright/test';

import { SITES_STATE_FOLDER } from './serveSitesBrowser.js';
import type { SitesTestFixtures, SitesWorkerFixtures } from './sitesTest.js';

/**
 * The sites eval: journeys on real protected sites, one at a time, in flaneur and in a headless control. The selftest
 * has its own config (`selftest.config.ts`).
 */
export default defineConfig<SitesTestFixtures, SitesWorkerFixtures>({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    testIgnore: '**/selftest/**',
    // One browser and one pace for the whole run: the journeys never run side by side.
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 5 * 60_000,
    // A page load can be held up to 15 s by the pace, so an assertion after one waits as long as an action.
    expect: { timeout: 30_000 },
    use: { actionTimeout: 30_000, navigationTimeout: 60_000 },
    outputDir: path.join(SITES_STATE_FOLDER, 'sites', 'test-results'),
    globalSetup: './globalSetup.ts',
    reporter: [['list'], ['./consistencyReporter.ts']],
    projects: [
        { name: 'flaneur', use: { runner: 'flaneur' } },
        { name: 'headless', use: { runner: 'headless' } },
    ],
});
