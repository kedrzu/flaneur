import { createLogger } from '@nzyme/logging/createLogger.js';

import { launchStealthBrowser } from './launchStealthBrowser.js';
import type { LaunchStealthBrowserOptions } from './launchStealthBrowser.js';
import { serveBrowser } from './serveBrowser.js';
import type { StealthBrowserServer } from './serveBrowser.js';

/** How the browser is launched and where it is served. */
export interface ServeStealthBrowserOptions extends LaunchStealthBrowserOptions<undefined> {
    /** The local port to listen on; any free one by default. */
    port?: number;
    /** How long the server may go without a client command before its `idle` resolves; never by default. */
    idleTimeoutMs?: number;
}

/**
 * Launches the browser and serves it (`serveBrowser`). The browser is launched before the server listens, so no client
 * ever waits for it.
 */
export async function serveStealthBrowser(options: ServeStealthBrowserOptions): Promise<StealthBrowserServer> {
    const logger = options.logger ?? createLogger('Flaneur');
    const browser = await launchStealthBrowser<undefined>({ ...options, logger });
    return serveBrowser(browser, { port: options.port, idleTimeoutMs: options.idleTimeoutMs, logger });
}
