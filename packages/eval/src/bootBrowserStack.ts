import path from 'node:path';

import { createSitePace, installChromeForTesting, serveStealthBrowser } from 'flaneur';

import { createLogger, setLoggerTransport } from '@nzyme/logging/createLogger.js';
import { consoleLog } from '@nzyme/logging/LoggerTransport.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/** flaneur running for the eval: the endpoint agent-browser connects to, and how to stop it. */
export interface BrowserStack {
    /** The CDP endpoint flaneur serves, `ws://127.0.0.1:<port>/<token>`. */
    endpoint: string;
    /** The agent-browser session the eval's commands share. */
    session: string;
    /** The browser's product and version. */
    browserVersion(): Promise<string>;
    /** Closes the server and the browser. */
    stop(): Promise<void>;
}

/**
 * Starts flaneur as its CLI does — the pinned Chrome for Testing, a human pace — with every path under `stateFolder`:
 * Chrome for Testing installs into `stateFolder/chrome-for-testing` and the profile lives in `stateFolder/profile`, so
 * a person's own flaneur profile is never touched.
 */
export async function bootBrowserStack(stateFolder: string): Promise<BrowserStack> {
    // Debug entries (every CDP routing decision) would bury what the eval prints itself.
    setLoggerTransport((logger, level, message, obj) => {
        if (level !== 'debug' && level !== 'trace') {
            consoleLog(logger, level, message, obj);
        }
    });
    const logger = createLogger('flaneur');

    const chrome = await installChromeForTesting({ cacheDir: path.join(stateFolder, 'chrome-for-testing'), logger });
    const server = await serveStealthBrowser({
        executablePath: chrome.executablePath,
        userDataDir: path.join(stateFolder, 'profile'),
        pace: createSitePace(),
        logger,
    });

    return {
        endpoint: server.endpoint,
        session: `flaneur-eval-${Date.now().toString(36)}`,
        browserVersion,
        stop: () => server.close(),
    };

    async function browserVersion() {
        const version = await server.browser.send('Browser.getVersion');
        const product = isPlainObject(version) ? version['product'] : undefined;
        if (typeof product !== 'string') {
            throw new TypeError('Browser.getVersion gave no product');
        }
        return product;
    }
}
