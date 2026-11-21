import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import type { Page } from 'playwright';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { createHumanInput } from './createHumanInput.js';
import type { StealthBrowserServer } from './serveBrowser.js';
import { serveStealthBrowser } from './serveStealthBrowser.js';

/**
 * Stock Playwright through the proxy with the human input on, against a page that records in its DOM what a behaviour
 * sensor sees of each click, key and wheel. The browser is Playwright's Chromium, headless and without the sandbox,
 * which CI runners do not allow.
 */
const BROWSER_ARGS = ['--headless=new', '--no-sandbox'];
const TIMEOUT_MS = 60_000;
const PLAYWRIGHT_TIMEOUT_MS = 30_000;
const BUTTONS = ['one', 'two', 'three', 'four'];

/** What the page records of a press: the moves since the previous press, and where it hit. */
interface RecordedClick {
    id: string;
    moves: number;
    travelled: number;
    dx: number;
    dy: number;
    trusted: boolean;
    /** Milliseconds since the navigation started. */
    at: number;
}

/** What the page records of a key event. */
interface RecordedKey {
    type: 'keydown' | 'keyup';
    key: string;
    at: number;
    trusted: boolean;
}

/** Everything the page recorded. */
interface Records {
    clicks: RecordedClick[];
    keys: RecordedKey[];
    wheels: number;
}

const RECORDER_SCRIPT = `
    const records = { clicks: [], keys: [], wheels: 0 };
    let path = [];
    const out = document.getElementById('records');
    const write = () => { out.textContent = JSON.stringify(records); };
    addEventListener('mousemove', event => { path.push([event.clientX, event.clientY]); });
    addEventListener('mousedown', event => {
        const box = event.target.getBoundingClientRect();
        let travelled = 0;
        for (let index = 1; index < path.length; index++) {
            travelled += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
        }
        records.clicks.push({
            id: event.target.id,
            moves: path.length,
            travelled,
            dx: event.clientX - (box.left + box.width / 2),
            dy: event.clientY - (box.top + box.height / 2),
            trusted: event.isTrusted,
            at: performance.now(),
        });
        path = [];
        write();
    });
    for (const type of ['keydown', 'keyup']) {
        addEventListener(type, event => {
            records.keys.push({ type, key: event.key, at: event.timeStamp, trusted: event.isTrusted });
            write();
        });
    }
    addEventListener('wheel', () => { records.wheels++; write(); });`;

let site: { server: Server; url: string };
let served: StealthBrowserServer;
let userDataDir: string;

beforeAll(async () => {
    site = await servePage();
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-human-input-'));
    served = await serveStealthBrowser({
        executablePath: chromium.executablePath(),
        userDataDir,
        args: BROWSER_ARGS,
        input: createHumanInput(),
        logger: createTestLogger('StealthBrowser').logger,
    });
}, TIMEOUT_MS);

afterAll(async () => {
    await served?.close();
    site?.server.closeAllConnections();
    site?.server.close();
    await rm(userDataDir, { recursive: true, force: true });
}, TIMEOUT_MS);

test(
    "Playwright's clicks, fill and scroll reach the page as a person's: paths, near-centre presses, key by key, wheel",
    async () => {
        const browser = await chromium.connectOverCDP(served.endpoint);
        try {
            const context = browser.contexts()[0];
            assert(context, 'connectOverCDP gives the default context');
            context.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS);
            const page = await context.newPage();
            await page.goto(site.url);

            for (const id of BUTTONS) {
                await page.locator(`#${id}`).click();
            }
            await page.locator('#text').fill('hello world');
            await page.locator('#polish').fill('Zażółć gęślą');
            await page.locator('#far').click();

            expect(await page.locator('#polish').inputValue()).toBe('Zażółć gęślą');
            expect(await page.locator('#text').inputValue()).toBe('hello world');
            const records = await readRecords(page);

            const clicks = records.clicks.filter(click => [...BUTTONS, 'far'].includes(click.id));
            expect(clicks.map(click => click.id)).toEqual([...BUTTONS, 'far']);
            for (const click of clicks) {
                expect(click.trusted).toBe(true);
                expect(click.moves).toBeGreaterThan(10);
                expect(click.travelled).toBeGreaterThan(0);
                expect(Math.hypot(click.dx, click.dy)).toBeLessThanOrEqual(3);
            }
            expect(clicks.some(click => click.dx !== 0 || click.dy !== 0)).toBe(true);
            expect(clicks[0]?.at).toBeGreaterThanOrEqual(1500);
            expect(records.wheels).toBeGreaterThan(5);

            const typed = records.keys.filter(key => key.trusted && key.key.length === 1);
            const downs = typed.filter(key => key.type === 'keydown');
            expect(downs.map(key => key.key).join('')).toBe('hello worldZażółć gęślą');
            for (const [index, down] of downs.entries()) {
                const up = typed.find(key => key.type === 'keyup' && key.key === down.key && key.at >= down.at);
                expect(up).toBeDefined();
                const previous = downs[index - 1];
                // The second text starts after a click's worth of time, not a key interval.
                if (previous != null && index !== 'hello world'.length) {
                    expect(down.at - previous.at).toBeGreaterThanOrEqual(30);
                    expect(down.at - previous.at).toBeLessThanOrEqual(300);
                }
            }
            await page.close();
        } finally {
            await browser.close();
        }
    },
    TIMEOUT_MS,
);

async function readRecords(page: Page): Promise<Records> {
    const text = await page.locator('#records').textContent();
    const parsed: unknown = JSON.parse(text ?? '{}');
    assert(isPlainObject(parsed), 'The page records an object');
    const { clicks, keys, wheels } = parsed;
    assert(Array.isArray(clicks) && Array.isArray(keys) && typeof wheels === 'number', 'The page records every kind');
    return {
        clicks: clicks.filter(
            (click): click is RecordedClick => isPlainObject(click) && typeof click['id'] === 'string',
        ),
        keys: keys.filter((key): key is RecordedKey => isPlainObject(key) && typeof key['key'] === 'string'),
        wheels,
    };
}

/** Serves the recording page on `127.0.0.1`: four buttons around the viewport, two inputs and a button far below. */
async function servePage() {
    const server = createServer((_request, response) => {
        const buttons = BUTTONS.map(
            (id, index) =>
                `<button id="${id}" style="position:absolute;left:${100 + 250 * index}px;top:${100 + 120 * (index % 2)}px;width:120px;height:40px">${id}</button>`,
        ).join('');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body>
            ${buttons}
            <input id="text" style="position:absolute;left:100px;top:400px">
            <input id="polish" style="position:absolute;left:400px;top:400px">
            <button id="far" style="position:absolute;left:300px;top:3000px;width:120px;height:40px">far</button>
            <pre id="records" style="position:absolute;left:0;top:3200px"></pre>
            <script>${RECORDER_SCRIPT}</script>
        </body></html>`);
    });
    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert(address != null && typeof address === 'object', 'A listening TCP server has an address');
    return { server, url: `http://127.0.0.1:${address.port}/` };
}
