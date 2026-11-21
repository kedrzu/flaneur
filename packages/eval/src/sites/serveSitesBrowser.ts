import os from 'node:os';
import path from 'node:path';

import { findChrome, installChromeForTesting, serveStealthBrowser } from 'flaneur';
import type { HumanInput, SitePace } from 'flaneur';
import type { FullConfig } from 'playwright/test';

import { createLogger, setLoggerTransport } from '@nzyme/logging/createLogger.js';
import { consoleLog } from '@nzyme/logging/LoggerTransport.js';
import type { Logger } from '@nzyme/logging/Logger.js';
import { assert } from '@nzyme/utils/assert.js';

/** The environment variable that hands flaneur's CDP endpoint from the global setup to the workers. */
export const SITES_ENDPOINT_VARIABLE = 'FLANEUR_SITES_ENDPOINT';

/** `installed` runs the installed Google Chrome instead of Chrome for Testing. */
const SITES_CHROME_VARIABLE = 'FLANEUR_SITES_CHROME';

/** The eval's own state folder, so a person's own flaneur profile is never touched. */
export const SITES_STATE_FOLDER = path.join(os.homedir(), '.flaneur-eval');

/** Where the sites runs are saved as `<startedAt>-sites.json`, beside the stealth eval's runs. */
export const SITES_RESULTS_FOLDER = path.join(SITES_STATE_FOLDER, 'results');

/** How the run's flaneur is started. */
export interface ServeSitesBrowserOptions {
    /** The Chrome profile; one browser at a time may open it. */
    userDataDir: string;
    pace: SitePace;
    /** Human-like input for every client, as the CLI gives it; none: the clients' input passes unchanged. */
    input?: HumanInput;
}

/**
 * Starts flaneur once for the whole run, in the runner process of a Playwright global setup, and hands its endpoint to
 * the workers in `FLANEUR_SITES_ENDPOINT`. Playwright restarts a worker after every failed test, so a browser (and a
 * pace) owned by a worker would forget the blocks it saw. Starts nothing when every selected project runs headless.
 * @returns The global teardown, which closes the server and the browser.
 */
export async function serveSitesBrowser(
    config: FullConfig,
    options: ServeSitesBrowserOptions,
): Promise<(() => Promise<void>) | undefined> {
    if (!config.filteredProjects.some(project => !('runner' in project.use) || project.use.runner !== 'headless')) {
        return undefined;
    }

    // Debug entries (every CDP routing decision, every failed brand command) would bury the test output.
    setLoggerTransport((logger, level, message, obj) => {
        if (level !== 'debug' && level !== 'trace') {
            consoleLog(logger, level, message, obj);
        }
    });
    const logger = createLogger('flaneur');

    const executablePath = await findSitesChrome(logger);
    const server = await serveStealthBrowser({
        executablePath,
        userDataDir: options.userDataDir,
        pace: options.pace,
        ...(options.input == null ? {} : { input: options.input }),
        logger,
    });
    process.env[SITES_ENDPOINT_VARIABLE] = server.endpoint;

    return () => server.close();
}

/**
 * The Chrome the run drives: the pinned Chrome for Testing, or with `FLANEUR_SITES_CHROME=installed` the Google Chrome
 * installed on this computer, as the CLI serves by default.
 */
async function findSitesChrome(logger: Logger) {
    if (process.env[SITES_CHROME_VARIABLE] === 'installed') {
        const installed = findChrome();
        assert(installed, 'FLANEUR_SITES_CHROME=installed, but Google Chrome is not installed');
        return installed;
    }
    const chrome = await installChromeForTesting({
        cacheDir: path.join(SITES_STATE_FOLDER, 'chrome-for-testing'),
        logger,
    });
    return chrome.executablePath;
}
