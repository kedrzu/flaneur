import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { WebSocketServer } from 'ws';
import type { RawData } from 'ws';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitUntil } from '@nzyme/utils/waitUntil.js';

import type { StealthBrowser } from './createStealthBrowser.js';
import { createSitePace } from './createSitePace.js';
import type { SitePaceClock } from './createSitePace.js';
import { launchStealthBrowser } from './launchStealthBrowser.js';
import type { StealthBrowserServer } from './serveBrowser.js';
import { serveStealthBrowser } from './serveStealthBrowser.js';

/**
 * Stock Playwright connected to the proxy with `connectOverCDP`, as an agent's script connects. The browser is
 * Playwright's Chromium, headless and without the sandbox, which CI runners do not allow.
 */
const BROWSER_ARGS = ['--headless=new', '--no-sandbox'];
const TIMEOUT_MS = 30_000;
/** Playwright's own timeout here: a hang fails with Playwright's error, well before the test's timeout. */
const PLAYWRIGHT_TIMEOUT_MS = 10_000;
/** How long a refusal may take: it must fail at once, not wait out Playwright's 30 s. */
const FAST_FAILURE_MS = 3000;
/** The pace's least time between two page loads of a site. */
const PACE_INTERVAL_MS = 5000;

/** Reports, in `#detections`, what the page's own scripts see of the client: an enabled Runtime and its globals. */
const DETECTOR_SCRIPT = `
    window.secret = 'page';
    const detections = { runtime: 0, pw: false, ticks: 0 };
    Error.prepareStackTrace = () => { detections.runtime++; return 'stack'; };
    setInterval(() => {
        // Serialised, which formats the stack through Error.prepareStackTrace, only while Runtime is enabled.
        console.debug(new Error('probe'));
        detections.pw = '__pw' in window;
        detections.ticks++;
        document.getElementById('detections').textContent = JSON.stringify(detections);
    }, 50);`;

/** What `DETECTOR_SCRIPT` writes to its page. */
interface Detections {
    runtime: number;
    pw: boolean;
    ticks: number;
}

/** The test's site, served on two hosts: two sites. */
interface Pages {
    server: Server;
    /** `http://127.0.0.1:<port>`. */
    home: string;
    /** `http://localhost:<port>`: another site, so a frame of it is cross-origin and a navigation to it cross-site. */
    other: string;
}

let pages: Pages;
let served: StealthBrowserServer;
/** A browser launched with a pace on a clock the test moves, served by group (`serveGroups`). */
let grouped: GroupedBrowser;

beforeAll(async () => {
    pages = await servePages();
    served = await serveStealthBrowser({
        executablePath: chromium.executablePath(),
        userDataDir: await mkdtemp(path.join(os.tmpdir(), 'flaneur-playwright-')),
        args: BROWSER_ARGS,
        logger: createTestLogger('StealthBrowser').logger,
    });
    grouped = await launchGroupedBrowser();
}, TIMEOUT_MS);

afterAll(async () => {
    await served?.close();
    await grouped?.close();
    pages?.server.closeAllConnections();
    pages?.server.close();
}, TIMEOUT_MS);

test(
    'drives the default context: locators, fill, evaluate, screenshot, ariaSnapshot, route, popup and frames',
    async () => {
        await withPlaywright(served.endpoint, async browser => {
            const context = browser.contexts()[0];
            assert(context, 'connectOverCDP gives the default context');
            const page = await context.newPage();
            try {
                await page.goto(`${pages.home}/`);

                await page.getByLabel('Name').fill('Ada');
                await page.getByRole('button', { name: 'Greet' }).click();
                expect(await page.locator('#greeting').textContent()).toBe('Hello, Ada');
                expect(await page.evaluate("document.querySelectorAll('button').length")).toBe(3);

                const screenshot = await page.screenshot();
                expect(screenshot.subarray(1, 4).toString('ascii')).toBe('PNG');
                expect(await page.locator('h1').ariaSnapshot()).toBe('- heading "Home" [level=1]');

                await page.route('**/api/data', route => route.fulfill({ body: 'intercepted' }));
                await page.getByRole('button', { name: 'Load data' }).click();
                await page.locator('#data', { hasText: 'intercepted' }).waitFor();

                const [popup, fromContext] = await Promise.all([
                    page.waitForEvent('popup'),
                    context.waitForEvent('page'),
                    page.getByRole('button', { name: 'Open popup' }).click(),
                ]);
                expect(fromContext).toBe(popup);
                await popup.waitForLoadState();
                expect(await popup.locator('h1').textContent()).toBe('Popup');
                await popup.close();

                const crossOrigin = page.frameLocator('#cross');
                await crossOrigin.getByRole('button', { name: 'Frame button' }).click();
                expect(await crossOrigin.locator('button').textContent()).toBe('Clicked in frame');

                const written = page.frameLocator('#written');
                await written.getByRole('button', { name: 'Written' }).click();
                expect(await written.locator('button').textContent()).toBe('Clicked');
            } finally {
                await page.close();
            }
        });
    },
    TIMEOUT_MS,
);

test(
    "the page never sees Playwright: no enabled Runtime, none of its globals, and evaluate none of the page's",
    async () => {
        await withPlaywright(served.endpoint, async browser => {
            const page = await newPage(browser);
            try {
                await page.goto(`${pages.home}/`);
                await page.evaluate('window.__pw = 1');

                expect(await page.evaluate('window.__pw')).toBe(1);
                expect(await page.evaluate('typeof window.secret')).toBe('undefined');
                // A few more of the detector's ticks, with Playwright's sessions all enabled.
                const { ticks } = await readDetections(page);
                await waitUntil(async () => (await readDetections(page)).ticks > ticks + 5, {
                    timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
                });
                expect(await readDetections(page)).toMatchObject({ runtime: 0, pw: false });
            } finally {
                await page.close();
            }
        });
    },
    TIMEOUT_MS,
);

test(
    'evaluate and locators right after a navigation, cross-site too, run in the new document',
    async () => {
        await withPlaywright(served.endpoint, async browser => {
            const page = await newPage(browser);
            try {
                for (const url of [`${pages.home}/next`, `${pages.other}/next`, `${pages.home}/next`]) {
                    const startedAt = Date.now();
                    await page.goto(url);
                    expect(await page.evaluate('location.href')).toBe(url);
                    expect(await page.locator('#marker').textContent()).toBe(new URL(url).host);
                    expect(Date.now() - startedAt).toBeLessThan(FAST_FAILURE_MS);
                }

                // A navigation the page makes itself, on a click: the locator waits for the new document.
                await page.getByRole('link', { name: 'Elsewhere' }).click();
                expect(await page.locator('#marker', { hasText: new URL(pages.other).host }).textContent()).toBe(
                    new URL(pages.other).host,
                );
                expect(await page.evaluate('location.href')).toBe(`${pages.other}/next`);
            } finally {
                await page.close();
            }
        });
    },
    TIMEOUT_MS,
);

test(
    "a second script sees the first one's open page and drives it",
    async () => {
        const url = `${pages.home}/next?reconnect`;
        await withPlaywright(served.endpoint, async browser => {
            const page = await newPage(browser);
            await page.goto(url);
        });

        await withPlaywright(served.endpoint, async browser => {
            const context = browser.contexts()[0];
            assert(context, 'connectOverCDP gives the default context');
            const page = context.pages().find(candidate => candidate.url() === url);
            assert(page, "The first script's page is there");
            try {
                expect(await page.evaluate('location.href')).toBe(url);
                await page.getByRole('link', { name: 'Elsewhere' }).click();
                await page.waitForURL(`${pages.other}/next`);
                expect(await page.locator('#marker').textContent()).toBe(new URL(pages.other).host);
            } finally {
                await page.close();
            }
        });
    },
    TIMEOUT_MS,
);

test(
    'a new browser context and an exposed function fail at once, saying why',
    async () => {
        await withPlaywright(served.endpoint, async browser => {
            let startedAt = Date.now();
            await expect(browser.newContext()).rejects.toThrow("browser contexts are the proxy's");
            expect(Date.now() - startedAt).toBeLessThan(FAST_FAILURE_MS);

            const page = await newPage(browser);
            try {
                startedAt = Date.now();
                await expect(page.exposeFunction('reportToClient', () => 1)).rejects.toThrow(
                    "page code must not call the client's functions",
                );
                expect(Date.now() - startedAt).toBeLessThan(FAST_FAILURE_MS);
            } finally {
                await page.close();
            }
        });
    },
    TIMEOUT_MS,
);

test(
    "a client of one group sees only its group's pages",
    async () => {
        const urlA = `${pages.home}/next?group-a`;
        await withPlaywright(grouped.endpoint('group-a'), async a => {
            const pageA = await newPage(a);
            await pageA.goto(urlA);

            await withPlaywright(grouped.endpoint('group-b'), async b => {
                const pageB = await newPage(b);
                expect(b.contexts()[0]?.pages()).toEqual([pageB]);
                expect(a.contexts()[0]?.pages()).toEqual([pageA]);
            });
            // A script connecting later is attached to its group's pages only.
            await withPlaywright(grouped.endpoint('group-b'), b => {
                expect(
                    b
                        .contexts()[0]
                        ?.pages()
                        .map(page => page.url()),
                ).toEqual(['about:blank']);
            });
        });
    },
    TIMEOUT_MS,
);

test(
    'a second navigation to a site waits for its pace',
    async () => {
        // Whatever earlier tests loaded is long past.
        grouped.clock.advance(60 * 60 * 1000);
        await withPlaywright(grouped.endpoint('pace'), async browser => {
            const page = await newPage(browser);
            await page.goto(`${pages.other}/next`);

            let arrived = false;
            const second = page.goto(`${pages.other}/next?again`).finally(() => {
                arrived = true;
            });
            await waitUntil(() => grouped.clock.pending() > 0, { timeoutMs: PLAYWRIGHT_TIMEOUT_MS });
            expect(arrived).toBe(false);

            grouped.clock.advance(PACE_INTERVAL_MS);
            await second;
            expect(page.url()).toBe(`${pages.other}/next?again`);
        });
    },
    TIMEOUT_MS,
);

/** Connects Playwright to `endpoint`, runs `script` and closes the connection, which leaves the pages open. */
async function withPlaywright(endpoint: string, script: (browser: Browser) => Promise<void> | void) {
    const browser = await chromium.connectOverCDP(endpoint);
    try {
        for (const context of browser.contexts()) {
            context.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS);
        }
        await script(browser);
    } finally {
        await browser.close();
    }
}

async function newPage(browser: Browser) {
    const context = browser.contexts()[0];
    assert(context, 'connectOverCDP gives the default context');
    return context.newPage();
}

async function readDetections(page: Page): Promise<Detections> {
    const text = await page.locator('#detections').textContent();
    const parsed: unknown = text == null || text === '' ? {} : JSON.parse(text);
    assert(isPlainObject(parsed), 'The detector writes an object');
    const { runtime, pw, ticks } = parsed;
    return {
        runtime: typeof runtime === 'number' ? runtime : 0,
        pw: pw === true,
        ticks: typeof ticks === 'number' ? ticks : 0,
    };
}

/** Serves the test's pages on `127.0.0.1`, reached by two hosts. */
async function servePages(): Promise<Pages> {
    const server = createServer(handlePage);
    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert(address != null && typeof address === 'object', 'A listening TCP server has an address');
    return { server, home: `http://127.0.0.1:${address.port}`, other: `http://localhost:${address.port}` };
}

function handlePage(request: IncomingMessage, response: ServerResponse) {
    const host = request.headers.host ?? '';
    const { pathname } = new URL(request.url ?? '/', `http://${host}`);
    const otherHost = host.startsWith('localhost')
        ? host.replace('localhost', '127.0.0.1')
        : host.replace('127.0.0.1', 'localhost');
    switch (pathname) {
        case '/':
            return sendHtml(
                response,
                `<title>Home</title><h1>Home</h1>
                <label>Name <input id="name"></label>
                <button onclick="greeting.textContent = 'Hello, ' + document.getElementById('name').value">Greet</button>
                <p id="greeting"></p>
                <button onclick="fetch('/api/data').then(r => r.text()).then(t => { data.textContent = t; })">Load data</button>
                <p id="data"></p>
                <button onclick="window.open('/popup')">Open popup</button>
                <iframe id="cross" src="http://${otherHost}/frame"></iframe>
                <iframe id="written"></iframe>
                <pre id="detections"></pre>
                <script>
                    const written = document.getElementById('written').contentDocument;
                    written.open();
                    written.write('<button onclick="this.textContent = \\'Clicked\\'">Written</button>');
                    written.close();
                    ${DETECTOR_SCRIPT}
                </script>`,
            );
        case '/popup':
            return sendHtml(response, '<title>Popup</title><h1>Popup</h1>');
        case '/frame':
            return sendHtml(response, `<button onclick="this.textContent = 'Clicked in frame'">Frame button</button>`);
        case '/next':
            return sendHtml(
                response,
                `<title>Next</title><p id="marker">${host}</p><a href="http://${host.startsWith('localhost') ? host : otherHost}/next">Elsewhere</a>`,
            );
        case '/api/data':
            response.writeHead(200, { 'content-type': 'text/plain' }).end('real data');
            return;
        default:
            response.writeHead(404).end();
    }
}

function sendHtml(response: ServerResponse, body: string) {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html><body>${body}</body></html>`);
}

/** A launched browser whose clients connect to `endpoint(group)` and join that group, paced on `clock`. */
interface GroupedBrowser {
    endpoint(group: string): string;
    clock: FakeClock;
    close(): Promise<void>;
}

/**
 * Launches a browser with a pace on a fake clock and serves it as `serveBrowser` does, but with the group in the path,
 * which `serveBrowser` has no way to give.
 */
async function launchGroupedBrowser(): Promise<GroupedBrowser> {
    const work = await mkdtemp(path.join(os.tmpdir(), 'flaneur-playwright-'));
    const clock = createFakeClock();
    const browser: StealthBrowser<undefined> = await launchStealthBrowser<undefined>({
        executablePath: chromium.executablePath(),
        userDataDir: path.join(work, 'profile'),
        args: BROWSER_ARGS,
        pace: createSitePace({ clock, intervalMs: PACE_INTERVAL_MS }),
        logger: createTestLogger('StealthBrowser').logger,
    });
    const sockets = new WebSocketServer({ noServer: true });
    const server = createServer();
    server.on('upgrade', (request, socket, head) => {
        const group = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1);
        sockets.handleUpgrade(request, socket, head, ws => {
            const client = browser.connect(ws, { group, data: undefined });
            ws.on('message', message => {
                client.receive(toText(message));
            });
            ws.on('close', () => client.close());
        });
    });
    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert(address != null && typeof address === 'object', 'A listening TCP server has an address');

    return {
        endpoint: group => `ws://127.0.0.1:${address.port}/${group}`,
        clock,
        async close() {
            for (const client of sockets.clients) {
                client.terminate();
            }
            sockets.close();
            server.closeAllConnections();
            server.close();
            await browser.close();
            await rm(work, { recursive: true, force: true });
        },
    };
}

/** A text frame as a string; `ws` hands it over as a buffer, or a list of them when fragmented. */
function toText(message: RawData) {
    if (Array.isArray(message)) {
        return Buffer.concat(message).toString('utf8');
    }
    return message instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(message)).toString('utf8')
        : message.toString('utf8');
}

/** A clock the test moves: its timers fire only on `advance`. */
interface FakeClock extends SitePaceClock {
    advance(ms: number): void;
    /** How many timers wait to fire. */
    pending(): number;
}

function createFakeClock(): FakeClock {
    let now = Date.now();
    const timers: { at: number; callback: () => void }[] = [];
    return {
        now: () => now,
        setTimeout(callback, ms) {
            timers.push({ at: now + ms, callback });
        },
        advance(ms) {
            now += ms;
            for (const timer of timers.splice(0)) {
                if (timer.at <= now) {
                    timer.callback();
                } else {
                    timers.push(timer);
                }
            }
        },
        pending: () => timers.length,
    };
}
