import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import { createLogger } from '@nzyme/logging/createLogger.js';
import type { Logger } from '@nzyme/logging/Logger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitFor } from '@nzyme/utils/waitFor.js';
import { withTimeout } from '@nzyme/utils/withTimeout.js';

import type { CdpPolicy } from './CdpTypes.js';
import { createOwnChromeConnection } from './createOwnChromeConnection.js';
import type { OwnChromeChannel } from './createOwnChromeConnection.js';
import type { SitePace } from './createSitePace.js';
import { createStealthBrowser } from './createStealthBrowser.js';
import type { StealthBrowser } from './createStealthBrowser.js';
import { findChrome } from './findChrome.js';
import { getBrowserLaunchCommand } from './getBrowserLaunchCommand.js';
import type { BrowserLaunchCommand } from './getBrowserLaunchCommand.js';
import type { OwnChromeFlaneurMessage } from './OwnChromeProtocol.js';
import { readRememberedBrowser } from './readRememberedBrowser.js';
import { registerNativeHost } from './registerNativeHost.js';

/** Where flaneur registers its native messaging host, how long it waits for Chrome, and what clients may do. */
export interface ConnectOwnChromeOptions<D = unknown> {
    /** flaneur's data folder: the host and its socket live in its `own-chrome` folder. */
    dataDir: string;
    /** The browsers' user data folders the host is registered in (macOS, Linux); found on disk by default. */
    browserDataDirs?: string[];
    /** The registry keys the host is registered under (Windows); found on disk by default. */
    registryKeys?: string[];
    /**
     * Starts the browser the extension last connected from (Google Chrome when none is known), once and without flags,
     * when the extension has not connected within 3 s; on by default.
     */
    launchBrowser?: boolean;
    /** How long to wait for the extension; 45 s by default, its 30 s retry and Chrome's start. */
    timeoutMs?: number;
    /** Judges each client request after the proxy's session and target checks and before its stealth rules. */
    policy?: CdpPolicy<D>;
    /** The human pace kept on every site; none: nothing waits. */
    pace?: SitePace;
    logger?: Logger;
}

/** Where to get the extension and what to switch on, for the error when it does not connect. */
const EXTENSION_URL = 'https://github.com/kedrzu/flaneur/blob/main/packages/flaneur/README.md#your-own-chrome';
const TIMEOUT_MS = 45_000;
/** How long the extension of a running Chrome gets before Chrome is taken for not running. */
const LAUNCH_AFTER_MS = 3000;
const RETRY_MS = 250;
/** How long the extension may take to greet flaneur once its host answered. */
const GREETING_TIMEOUT_MS = 15_000;
const NEWLINE = 0x0a;

/**
 * The user's own Chromium browser, driven through the flaneur extension. Registers the native messaging host, waits for
 * the extension to start it (starting the browser when it is not running), and resolves once the extension has greeted
 * flaneur. The browser keeps its own name; it is gone (`exited`) when the extension or Chrome goes away.
 *
 * Rejects when the extension does not connect within `timeoutMs`, saying where to install it, and
 * when another flaneur already uses this browser.
 */
export async function connectOwnChrome<D = unknown>(options: ConnectOwnChromeOptions<D>): Promise<StealthBrowser<D>> {
    const logger = options.logger ?? createLogger('OwnChrome');
    const { address } = await registerNativeHost({
        dataDir: options.dataDir,
        browserDataDirs: options.browserDataDirs,
        registryKeys: options.registryKeys,
        logger,
    });
    const hostDir = path.join(options.dataDir, 'own-chrome');
    const socket = await waitForHost(address, hostDir, options, logger);
    const { channel, isBusy } = createSocketChannel(socket, logger);

    let connection;
    try {
        // An extension that never answers would leave the start waiting for good.
        connection = await withTimeout({
            operation: createOwnChromeConnection(channel, logger),
            timeoutMs: GREETING_TIMEOUT_MS,
            onTimeout: () => {
                channel.close();
                throw new Error('The flaneur extension did not answer: reload it in chrome://extensions and retry');
            },
        });
    } catch (error) {
        if (isBusy()) {
            throw new Error('Another flaneur is already using your browser: stop it first', { cause: error });
        }
        throw error;
    }
    const executable = await readRememberedBrowser(hostDir, logger);
    if (executable != null) {
        logger.info('Connected to your browser', { executable });
    }
    try {
        return await createStealthBrowser<D>(connection, {
            brand: false,
            policy: options.policy,
            pace: options.pace,
            logger,
        });
    } catch (error) {
        await connection.close();
        throw error;
    }
}

/** Connects to the host once the extension has started it; starts the browser after a while when allowed. */
async function waitForHost<D>(address: string, hostDir: string, options: ConnectOwnChromeOptions<D>, logger: Logger) {
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    const started = Date.now();
    let launched = false;
    for (;;) {
        const socket = await tryConnect(address);
        if (socket) {
            return socket;
        }
        const elapsed = Date.now() - started;
        if (elapsed >= timeoutMs) {
            throw new Error(
                `Your browser did not connect to flaneur within ${Math.round(timeoutMs / 1000)} s: the flaneur extension ` +
                    `is not installed or not running in this browser. Open your browser with the extension, or install it ` +
                    `from ${EXTENSION_URL}.`,
            );
        }
        if (!launched && options.launchBrowser !== false && elapsed >= LAUNCH_AFTER_MS) {
            launched = true;
            await launchBrowser(hostDir, logger);
        }
        await waitFor(RETRY_MS);
    }
}

/** The socket to the host, or `null` while there is no host to answer. */
function tryConnect(address: string) {
    return new Promise<net.Socket | null>((resolve, reject) => {
        const socket = net.connect(address);
        socket.once('connect', () => {
            socket.removeAllListeners('error');
            resolve(socket);
        });
        socket.once('error', error => {
            if ('code' in error && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) {
                resolve(null);
            } else {
                reject(error);
            }
        });
    });
}

/**
 * Starts the browser as the user would, without flags: the one the extension last connected from, else Google Chrome,
 * else nothing, which is only logged: the user may open their browser themselves while flaneur waits.
 */
async function launchBrowser(hostDir: string, logger: Logger) {
    const remembered = await readRememberedBrowser(hostDir, logger);
    if (remembered != null) {
        logger.info('Starting your browser', { executable: remembered });
        if (await startBrowser(getBrowserLaunchCommand(remembered, process.platform), logger)) {
            return;
        }
    }
    const chrome = getChromeLaunchCommand();
    if (chrome == null) {
        logger.warn('No browser to start: open your browser with the flaneur extension');
        return;
    }
    logger.info('Starting Google Chrome');
    await startBrowser(chrome, logger);
}

function getChromeLaunchCommand(): BrowserLaunchCommand | undefined {
    if (process.platform === 'darwin') {
        return { command: 'open', args: ['-g', '-a', 'Google Chrome'] };
    }
    const executable = findChrome();
    return executable == null ? undefined : getBrowserLaunchCommand(executable, process.platform);
}

/** Starts the program detached; whether it could be started. A failure is logged. */
function startBrowser({ command, args }: BrowserLaunchCommand, logger: Logger) {
    return new Promise<boolean>(resolve => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore' });
        child.once('error', error => {
            logger.warn('The browser could not be started', { command, error });
            resolve(false);
        });
        child.once('spawn', () => {
            // `open` reports a browser it cannot find through its exit code.
            child.once('exit', code => {
                if (code != null && code !== 0) {
                    logger.warn('The browser could not be started', { command, code });
                }
            });
            child.unref();
            resolve(true);
        });
    });
}

/**
 * The host's socket as the extension's channel: one JSON message per line. The host's `busy` line, sent when another
 * flaneur holds the host, is kept back from the channel and reported by `isBusy`.
 */
function createSocketChannel(socket: net.Socket, logger: Logger) {
    const listeners = new Set<(message: unknown) => void>();
    let busy = false;
    let rest: Buffer = Buffer.alloc(0);
    const closed = new Promise<void>(resolve => {
        socket.once('close', () => resolve());
    });

    socket.on('error', error => logger.debug('The connection to the native host failed', { error }));
    socket.on('data', (chunk: Buffer) => {
        rest = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
        let end = rest.indexOf(NEWLINE);
        while (end !== -1) {
            receive(rest.subarray(0, end));
            rest = rest.subarray(end + 1);
            end = rest.indexOf(NEWLINE);
        }
    });

    const channel: OwnChromeChannel = {
        send,
        onMessage: listener => listeners.add(listener),
        closed,
        close: () => socket.end(),
    };
    return { channel, isBusy: () => busy };

    function send(message: OwnChromeFlaneurMessage) {
        socket.write(`${JSON.stringify(message)}\n`);
    }

    function receive(line: Buffer) {
        let message: unknown;
        try {
            message = JSON.parse(line.toString('utf8'));
        } catch {
            logger.warn('The native host sent a line that is not JSON');
            return;
        }
        if (isPlainObject(message) && message['type'] === 'busy') {
            busy = true;
            return;
        }
        for (const listener of listeners) {
            listener(message);
        }
    }
}
