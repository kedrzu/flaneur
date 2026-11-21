import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'playwright/test';

import type { SitesBaseTestFixtures, SitesBaseWorkerFixtures } from './sitesBaseTest.js';

/** The `agent-browser` project's selftest; the Playwright projects leave it out. */
const AGENT_BROWSER_SPEC = '**/agentBrowser.spec.ts';

/**
 * The selftest of the sites eval: the journey machinery on pages served locally, in every project. It never opens the
 * eval's profile and writes nothing under `~/.flaneur-eval` but the Chrome for Testing and agent-browser downloads.
 */
export default defineConfig<SitesBaseTestFixtures, SitesBaseWorkerFixtures>({
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
        { name: 'flaneur', use: { runner: 'flaneur' }, testIgnore: AGENT_BROWSER_SPEC },
        { name: 'headless', use: { runner: 'headless' }, testIgnore: AGENT_BROWSER_SPEC },
        { name: 'agent-browser', use: { runner: 'flaneur' }, testMatch: AGENT_BROWSER_SPEC },
    ],
});
