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

/**
 * Records into `#log` each press, with whether the menu was open under it, and each time the menu opened. The `css`
 * menu is the department bar's child, open while the bar or the menu is hovered; the `js` menu is the page's own, opened
 * by the bar's `mouseenter` and closed 200 ms after the pointer left both.
 */
const MENU_SCRIPT = `
    const log = [];
    const menu = document.getElementById('menu');
    const bar = document.getElementById('bar');
    const isOpen = () => getComputedStyle(menu).display !== 'none';
    const write = () => { document.getElementById('log').textContent = JSON.stringify(log); };
    let open = false;
    addEventListener('mousemove', () => {
        if (isOpen() !== open) {
            open = isOpen();
            if (open) { log.push('open'); write(); }
        }
    }, true);
    addEventListener('mousedown', event => { log.push('press ' + event.target.closest('[id]').id + (isOpen() ? ' over open menu' : '')); write(); }, true);
    if (document.body.className === 'js') {
        let timer;
        const show = () => { clearTimeout(timer); menu.hidden = false; };
        const hide = () => { timer = setTimeout(() => { menu.hidden = true; }, 200); };
        bar.addEventListener('mouseenter', show);
        menu.addEventListener('mouseenter', show);
        bar.addEventListener('mouseleave', hide);
        menu.addEventListener('mouseleave', hide);
    }`;

let site: { server: Server; url: string };
let served: StealthBrowserServer;
/** What the input logged, to tell when it found a cover over a target. */
const inputLogs = createTestLogger('HumanInput');
let userDataDir: string;

beforeAll(async () => {
    site = await servePage();
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-human-input-'));
    served = await serveStealthBrowser({
        executablePath: chromium.executablePath(),
        userDataDir,
        args: BROWSER_ARGS,
        input: createHumanInput({ logger: inputLogs.logger }),
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

/** How the `/menu` page's department bar opens its menu over the result, if at all (`serveMenu`). */
type MenuVariant = 'css' | 'js' | 'none';

for (const variant of ['css', 'js'] as const) {
    test(
        `a click from the header's search box lands on a result under a mega menu its way opened (${variant} hover)`,
        async () => {
            const { log, covers, menuVisible } = await clickResultUnderMenu(variant);

            const presses = log.filter(entry => entry.startsWith('press'));
            expect(presses).toEqual(['press search', 'press result']);
            // The way from the search box to the result opened the menu, which closed before the press.
            expect(log.slice(log.indexOf('press search'))).toContain('open');
            expect(covers).toBeGreaterThan(0);
            expect(menuVisible).toBe(false);
        },
        TIMEOUT_MS,
    );
}

test(
    'a result whose own hover changes what lies under the cursor is clicked at once, as nothing covers it',
    async () => {
        const { log, covers } = await clickResultUnderMenu('none');

        expect(log.filter(entry => entry.startsWith('press'))).toEqual(['press search', 'press result']);
        expect(covers).toBe(0);
    },
    TIMEOUT_MS,
);

/**
 * Clicks the `/menu` page's search box, fills it and clicks the result, through Playwright: what the page logged, how
 * many times the input found a cover over the target, and whether the menu shows at the end.
 */
async function clickResultUnderMenu(variant: MenuVariant) {
    const coversBefore = countCovers();
    const browser = await chromium.connectOverCDP(served.endpoint);
    try {
        const context = browser.contexts()[0];
        assert(context, 'connectOverCDP gives the default context');
        context.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS);
        const page = await context.newPage();
        await page.setViewportSize({ width: 800, height: 600 });
        await page.goto(`${site.url}menu?variant=${variant}`);

        await page.locator('#search').click();
        await page.locator('#search').fill('hammer');
        await page.locator('#result').click({ timeout: 15_000 });

        const parsed: unknown = JSON.parse((await page.locator('#log').textContent()) ?? '[]');
        assert(Array.isArray(parsed), 'The page logs a list');
        const log = parsed.filter(entry => typeof entry === 'string');
        const menuVisible = await page.locator('#menu').isVisible();
        await page.close();
        return { log, covers: countCovers() - coversBefore, menuVisible };
    } finally {
        await browser.close();
    }
}

function countCovers() {
    return inputLogs.logs.filter(entry => entry.message === 'A cover hides the target, moving off it').length;
}

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

/**
 * A header with a search box over a department bar, whose hover opens a mega menu (`MenuVariant`) over a result below;
 * the result's own hover shows another view of it, as a product card's second image.
 */
function serveMenu(url: URL) {
    const variant = readMenuVariant(url.searchParams.get('variant'));
    const menu = `<div id="menu" ${variant === 'css' ? '' : 'hidden'} style="position:absolute;left:0;top:${variant === 'js' ? 110 : 60}px;width:100%;height:360px;z-index:1;background:#ccc">Mega menu</div>`;
    return `<!doctype html><html><body class="${variant}" style="margin:0">
        <style>.css #menu { display: none } .css #bar:hover #menu { display: block } #menu[hidden] { display: none }</style>
        <input id="search" style="position:absolute;left:400px;top:10px;width:200px;height:28px">
        <nav id="bar" style="position:absolute;left:0;top:50px;width:100%;height:60px;z-index:1;background:#eee">
            Departments ${variant === 'css' ? menu : ''}
        </nav>
        ${variant === 'js' || variant === 'none' ? menu : ''}
        <style>#result span { display: block; height: 100% } #result:hover .still, #result:not(:hover) .hover { display: none }</style>
        <a id="result" href="#result" style="position:absolute;left:40px;top:150px;width:300px;height:40px">
            <span class="still">Hammer</span><span class="hover">Hammer, another view</span>
        </a>
        <pre id="log" style="position:absolute;left:0;top:900px"></pre>
        <script>${MENU_SCRIPT}</script>
    </body></html>`;
}

function readMenuVariant(value: string | null): MenuVariant {
    switch (value) {
        case 'js':
        case 'none':
            return value;
        default:
            return 'css';
    }
}

/**
 * Serves the recording page on `127.0.0.1`: four buttons around the viewport, two inputs and a button far below; and at
 * `/menu` the mega menu page (`serveMenu`).
 */
async function servePage() {
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/menu') {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(serveMenu(url));
            return;
        }
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
