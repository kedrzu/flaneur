import { spawn } from 'node:child_process';

import { createLogger } from '@nzyme/logging/createLogger.js';
import type { Logger } from '@nzyme/logging/Logger.js';
import { assert } from '@nzyme/utils/assert.js';

import { buildStealthArgs } from './buildStealthArgs.js';
import type { CdpPolicy } from './CdpTypes.js';
import { connectBrowserPipe } from './connectBrowserPipe.js';
import type { HumanInput } from './createHumanInput.js';
import type { SitePace } from './createSitePace.js';
import { createStealthBrowser } from './createStealthBrowser.js';
import type { StealthBrowser } from './createStealthBrowser.js';
import type { StealthBrowserProxy } from './StealthBrowserProxy.js';

/** How the browser is launched, and what its clients may do. */
export interface LaunchStealthBrowserOptions<D = unknown> {
    /** The Chrome (or Chrome for Testing) binary. */
    executablePath: string;
    /** The profile folder: cookies and logins live here. */
    userDataDir: string;
    /** Appended to the base command line, e.g. `--headless=new`. */
    args?: string[];
    /** The HTTP proxy every request goes through, e.g. a VPN tunnel's; none: the browser connects directly. */
    proxy?: StealthBrowserProxy;
    /**
     * Judges each client request after the proxy's session and target checks and before its stealth rules, which no
     * policy can lift; `D` is the data the caller passes to `connect` for each client.
     */
    policy?: CdpPolicy<D>;
    /**
     * The human pace kept on every site, checked after the stealth rules: a command that loads a page waits for its
     * site's slot or is refused. Hand the same pace to the next launch to keep what it learned of blocks. None: nothing
     * waits.
     */
    pace?: SitePace;
    /**
     * Performs every client's input as a person would (`createHumanInput`): mouse paths, a dwell before a click, typing
     * key by key, wheeling into view. None: input goes as the client sent it.
     */
    input?: HumanInput;
    /** How long configuring the started browser, reading its identity included, may take; 15 s by default. */
    startTimeoutMs?: number;
    logger?: Logger;
}

/**
 * A launched browser driven over `--remote-debugging-pipe`, so no other local process can reach it. Every page and
 * worker in it names itself Google Chrome from its first script on.
 */
export interface LaunchedStealthBrowser<D = unknown> extends StealthBrowser<D> {
    pid: number;
}

/**
 * Launches the browser and resolves once it is ready: targets are discovered and the brand holds every new target, so
 * nothing reaches the browser before it is configured. When configuring fails or takes longer than `startTimeoutMs`
 * (a browser that never answers), the process is killed and the launch rejects.
 */
export async function launchStealthBrowser<D = unknown>(
    options: LaunchStealthBrowserOptions<D>,
): Promise<LaunchedStealthBrowser<D>> {
    const logger = options.logger ?? createLogger('StealthBrowser');
    const child = await spawnBrowser(options);
    const { pid } = child;
    assert(pid != null, 'The browser was spawned without a pid');
    const connection = connectBrowserPipe(child, logger);

    let browser: StealthBrowser<D>;
    try {
        browser = await createStealthBrowser<D>(connection, {
            brand: true,
            proxy: options.proxy,
            policy: options.policy,
            pace: options.pace,
            input: options.input,
            startTimeoutMs: options.startTimeoutMs,
            logger,
        });
    } catch (error) {
        logger.error('The browser could not be configured', { error, pid });
        child.kill('SIGKILL');
        await connection.closed;
        throw error;
    }
    logger.info('The browser started', { pid });
    return { ...browser, pid };
}

async function spawnBrowser<D>(options: LaunchStealthBrowserOptions<D>) {
    const args = buildStealthArgs({
        userDataDir: options.userDataDir,
        proxyServer: options.proxy?.server,
        args: options.args,
    });
    // fd 3 is what the browser reads commands from, fd 4 where it writes replies and events.
    const spawned = spawn(options.executablePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
        spawned.once('spawn', resolve);
        spawned.once('error', reject);
    });
    return spawned;
}
