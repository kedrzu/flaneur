import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';

import type { StealthBrowserServer } from './serveBrowser.js';
import { serveStealthBrowser } from './serveStealthBrowser.js';

/** A real Chromium, Playwright's, headless and without the sandbox, which CI runners do not allow. */
const TIMEOUT_MS = 20_000;

let server: StealthBrowserServer;
let port: string;

beforeAll(async () => {
    server = await serveStealthBrowser({
        executablePath: chromium.executablePath(),
        userDataDir: await mkdtemp(path.join(os.tmpdir(), 'flaneur-serve-')),
        args: ['--headless=new', '--no-sandbox'],
        logger: createTestLogger('StealthBrowser').logger,
    });
    port = new URL(server.endpoint).port;
}, TIMEOUT_MS);

afterAll(async () => {
    await server.close();
}, TIMEOUT_MS);

test('accepts a CDP client at the endpoint', async () => {
    const socket = new WebSocket(server.endpoint);
    const opened = await new Promise<boolean>(resolve => {
        socket.addEventListener('open', () => resolve(true));
        socket.addEventListener('error', () => resolve(false));
    });
    socket.close();

    expect(opened).toBe(true);
});

test('refuses an upgrade with a wrong token, on another path or with an Origin header', async () => {
    const token = new URL(server.endpoint).pathname;

    expect(await upgrade(`/${crypto.randomUUID()}`)).toBe(401);
    expect(await upgrade(`${token}/json/version`)).toBe(404);
    expect(await upgrade('/')).toBe(404);
    expect(await upgrade(token, { origin: 'https://site.test' })).toBe(403);
    expect(await upgrade(token, { origin: 'null' })).toBe(403);
});

test('listens on 127.0.0.1 only', async () => {
    expect(new URL(server.endpoint).hostname).toBe('127.0.0.1');

    const otherHosts = ['[::1]'];
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses ?? []) {
            if (address.family === 'IPv4' && !address.internal) {
                otherHosts.push(address.address);
            }
        }
    }
    for (const host of otherHosts) {
        await expect(fetch(`http://${host}:${port}/`)).rejects.toThrow();
    }
});

test(
    'goes idle only once no client command came for the idle timeout',
    async () => {
        const idleServer = await serveStealthBrowser({
            executablePath: chromium.executablePath(),
            userDataDir: await mkdtemp(path.join(os.tmpdir(), 'flaneur-serve-idle-')),
            args: ['--headless=new', '--no-sandbox'],
            idleTimeoutMs: 1000,
            logger: createTestLogger('StealthBrowser').logger,
        });
        try {
            const socket = new WebSocket(idleServer.endpoint);
            await new Promise(resolve => {
                socket.addEventListener('open', resolve);
            });
            // Commands every 400 ms for 2.4 s, more than twice the timeout, keep it serving.
            for (let id = 1; id <= 6; id++) {
                socket.send(JSON.stringify({ id, method: 'Browser.getVersion' }));
                await Bun.sleep(400);
            }
            expect(await isSettled(idleServer.idle)).toBe(false);

            // An open socket that sends nothing does not count.
            await Bun.sleep(1500);
            expect(await isSettled(idleServer.idle)).toBe(true);
            socket.close();
        } finally {
            await idleServer.close();
        }
    },
    TIMEOUT_MS,
);

/** Whether `promise` has already resolved, checked without waiting for it. */
function isSettled(promise: Promise<void>) {
    return Promise.race([promise.then(() => true), Bun.sleep(0).then(() => false)]);
}

/** The status of a WebSocket upgrade request to `pathname`. */
async function upgrade(pathname: string, headers: Record<string, string> = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        headers: {
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': btoa(crypto.randomUUID().slice(0, 16)),
            ...headers,
        },
    });
    return response.status;
}
