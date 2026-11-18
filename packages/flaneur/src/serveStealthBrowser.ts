import { randomUUID } from 'node:crypto';
import { createServer, STATUS_CODES } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';

import { WebSocketServer } from 'ws';
import type { RawData } from 'ws';

import { createLogger } from '@nzyme/logging/createLogger.js';
import { assert } from '@nzyme/utils/assert.js';

import { launchStealthBrowser } from './launchStealthBrowser.js';
import type { LaunchStealthBrowserOptions, StealthBrowser } from './launchStealthBrowser.js';

/** How the browser is launched and where it is served. */
export interface ServeStealthBrowserOptions extends LaunchStealthBrowserOptions<undefined> {
    /** The local port to listen on; any free one by default. */
    port?: number;
}

/** A browser served over a WebSocket. */
export interface StealthBrowserServer {
    /** The URL a CDP client connects to: `ws://127.0.0.1:<port>/<token>`. Whoever has it drives the browser. */
    endpoint: string;
    browser: StealthBrowser<undefined>;
    /** Stops the server, closing every client, and closes the browser. */
    close(): Promise<void>;
}

/** WebSocket close code: the message's type is not one the server accepts. */
const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Launches the browser and serves it to CDP clients on `127.0.0.1` only, at a path holding a random token. An upgrade
 * with any `Origin` header is refused, so no web page the user opens can reach it; one on another path is refused
 * too. Each socket is a client of its own with no group: it sees every page but the proxy's own. The browser is
 * launched before the server listens, so no client ever waits for it. Runs on Node and Bun alike.
 */
export async function serveStealthBrowser(options: ServeStealthBrowserOptions): Promise<StealthBrowserServer> {
    const logger = options.logger ?? createLogger('Flaneur');
    const browser = await launchStealthBrowser<undefined>({ ...options, logger });
    const token = randomUUID();

    const sockets = new WebSocketServer({ noServer: true });
    const server = createServer((_request, response) => {
        response.writeHead(426, { 'content-type': 'text/plain' }).end('A WebSocket upgrade is expected');
    });
    server.on('upgrade', (request, socket, head) => {
        const refusal = checkUpgrade(request, token);
        if (refusal) {
            socket.end(
                `HTTP/1.1 ${refusal} ${STATUS_CODES[refusal]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
            );
            return;
        }
        sockets.handleUpgrade(request, socket, head, ws => {
            const client = browser.connect(ws, { data: undefined });
            ws.on('message', (message, isBinary) => {
                if (isBinary) {
                    ws.close(CLOSE_UNSUPPORTED_DATA, 'CDP messages are text');
                } else {
                    client.receive(toText(message));
                }
            });
            ws.on('close', () => client.close());
        });
    });

    let port: number;
    try {
        port = await listen(server, options.port ?? 0);
    } catch (error) {
        await browser.close();
        throw error;
    }

    logger.info('The browser is served', { port });
    return {
        endpoint: `ws://127.0.0.1:${port}/${token}`,
        browser,
        close,
    };

    async function close() {
        for (const client of sockets.clients) {
            client.terminate();
        }
        sockets.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => {
            server.close(() => resolve());
        });
        await browser.close();
    }
}

/** Starts listening on `127.0.0.1` and resolves with the port taken. */
function listen(server: Server, port: number) {
    return new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            const address = server.address();
            assert(address && typeof address === 'object', 'A listening TCP server has an address');
            resolve(address.port);
        });
    });
}

/** A text frame as a string; `ws` hands it over as a buffer, or a list of them when fragmented. */
function toText(message: RawData) {
    if (Array.isArray(message)) {
        return Buffer.concat(message).toString('utf8');
    }
    if (message instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(message)).toString('utf8');
    }
    return message.toString('utf8');
}

/** The HTTP status refusing an upgrade, or `null` when it may go ahead. */
function checkUpgrade(request: IncomingMessage, token: string) {
    // A web page's WebSocket always sends Origin; a CDP client does not. A page must never reach the browser.
    if (request.headers.origin !== undefined) {
        return 403;
    }
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (pathname === `/${token}`) {
        return null;
    }
    // A single path segment is a token, a wrong one; anything else is a path the server does not have.
    if (/^\/[^/]+$/.test(pathname)) {
        return 401;
    }
    return 404;
}
