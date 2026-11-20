import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

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
import type { OwnChromeFlaneurMessage } from './OwnChromeProtocol.js';
import { registerNativeHost } from './registerNativeHost.js';

/** Where flaneur registers its native messaging host, how long it waits for Chrome, and what clients may do. */
export interface ConnectOwnChromeOptions<D = unknown> {
    /** flaneur's data folder: the host and its socket live in its `own-chrome` folder. */
    dataDir: string;
    /** The Chrome user data folder the host is registered in (macOS, Linux); Google Chrome's by default. */
    chromeUserDataDir?: string;
    /** The registry key the host is registered under (Windows); Google Chrome's by default. */
    registryKey?: string;
    /** Starts Google Chrome, once and without flags, when its extension has not connected within 3 s; on by default. */
    launchChrome?: boolean;
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

const execFileAsync = promisify(execFile);

/**
 * The user's own Google Chrome, driven through the flaneur extension. Registers the native messaging host, waits for
 * the extension to start it (starting Chrome when it is not running), and resolves once the extension has greeted
 * flaneur. The browser keeps its own name; it is gone (`exited`) when the extension or Chrome goes away.
 *
 * Rejects when the extension does not connect within `timeoutMs`, saying how to install it and allow agents, and
 * when another flaneur already uses this Chrome.
 */
export async function connectOwnChrome<D = unknown>(options: ConnectOwnChromeOptions<D>): Promise<StealthBrowser<D>> {
    const logger = options.logger ?? createLogger('OwnChrome');
    const { address } = await registerNativeHost(options);
    const socket = await waitForHost(address, options, logger);
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
            throw new Error('Another flaneur is already using your Chrome: stop it first', { cause: error });
        }
        throw error;
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

/** Connects to the host once the extension has started it; starts Chrome after a while when allowed. */
async function waitForHost<D>(address: string, options: ConnectOwnChromeOptions<D>, logger: Logger) {
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
                `Your Chrome did not connect to flaneur within ${Math.round(timeoutMs / 1000)} s. Install the flaneur ` +
                    `extension (${EXTENSION_URL}) and switch on "Allow agents to use this Chrome" in its options.`,
            );
        }
        if (!launched && options.launchChrome !== false && elapsed >= LAUNCH_AFTER_MS) {
            launched = true;
            await launchChrome(logger);
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

/** Starts Google Chrome as the user would, without flags; on macOS in the background. */
async function launchChrome(logger: Logger) {
    logger.info('Starting Google Chrome');
    if (process.platform === 'darwin') {
        try {
            await execFileAsync('open', ['-g', '-a', 'Google Chrome']);
        } catch (error) {
            throw new Error('Google Chrome is not installed', { cause: error });
        }
        return;
    }
    const executable = findChrome();
    if (executable == null) {
        throw new Error('Google Chrome is not installed');
    }
    const child = spawn(executable, [], { detached: true, stdio: 'ignore' });
    child.on('error', error => logger.warn('Google Chrome could not be started', { error }));
    child.unref();
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
