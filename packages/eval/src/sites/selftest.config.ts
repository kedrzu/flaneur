import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'playwright/test';

import type { SitesTestFixtures, SitesWorkerFixtures } from './sitesTest.js';

/**
 * The selftest of the sites eval: the journey machinery on pages served locally, in both projects. It never opens the
 * eval's profile and writes nothing under `~/.flaneur-eval` but the Chrome for Testing cache.
 */
export default defineConfig<SitesTestFixtures, SitesWorkerFixtures>({
    testDir: 'selftest',
    testMatch: '**/*.spec.ts',
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 5 * 60_000,
    use: { actionTimeout: 30_000, navigationTimeout: 60_000 },
    outputDir: path.join(os.tmpdir(), 'flaneur-sites-selftest', 'test-results'),
    globalSetup: './selftest/selftestSetup.ts',
    reporter: 'list',
    projects: [
        { name: 'flaneur', use: { runner: 'flaneur' } },
        { name: 'headless', use: { runner: 'headless' } },
    ],
});
