import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, test } from 'bun:test';
import { chromium } from 'playwright';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitFor } from '@nzyme/utils/waitFor.js';
import { waitUntil } from '@nzyme/utils/waitUntil.js';

import { connectOwnChrome } from './connectOwnChrome.js';
import { registerNativeHost } from './registerNativeHost.js';
import { serveBrowser } from './serveBrowser.js';

/**
 * `--chrome own` end to end: Chrome for Testing with a window, the flaneur extension loaded from a copy carrying the
 * test's own `defaults.json`, and no debugging flag, so only the extension's `chrome.debugger` touches the pages. The
 * pages report their own state to the test's server; reading it through any other debugger would change what is
 * measured. Needs the build: the extension's bundle and the native host.
 *
 * A tab in the background of its window is `hidden` unless focus emulation keeps it `visible`: that is how a page shows
 * whether a debugger with emulation is attached to it.
 */
const EXTENSION_DIR = path.join(import.meta.dir, '../../extension');
const HOST_NAME = 'com.flaneur.own_chrome';
/**
 * Windows: where Chrome for Testing looks for the host is not documented; the host is registered under each candidate.
 * The first is the one `connectOwnChrome` registers again on every connect.
 */
const REGISTRY_KEYS = [
    'HKCU\\Software\\Google\\Chrome for Testing\\NativeMessagingHosts',
    'HKCU\\Software\\Chromium\\NativeMessagingHosts',
];
/** Long enough for the extension's 30 s reconnect alarm, after a session ends. */
const RECONNECT_TIMEOUT_MS = 45_000;
/** How long a page in a background tab takes to report its new state: hidden pages run timers once a second. */
const SETTLE_MS = 1500;

const execFileAsync = promisify(execFile);
const cleanups: (() => Promise<unknown> | void)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
        await cleanup();
    }
});

test('with agents not allowed in the extension, gives up after the time limit saying what to do', async () => {
    const pages = servePages();
    const chrome = await startChrome({ settings: { allowAgents: false, scope: 'agent' }, url: pages.url('user') });
    // Chrome has started, and with it the extension, which would have connected by now if allowed.
    await pages.next('user');

    await expect(chrome.connect(5000)).rejects.toThrow(
        /did not connect to flaneur within 5 s\. Install the flaneur extension \(https:\/\/\S+\) and switch on "Allow agents/,
    );
}, 30_000);

test('drives agent tabs unseen and visible in the background, sees only the tabs its scope allows, and leaves every tab open and detached when it closes', async () => {
    const pages = servePages();
    const chrome = await startChrome({ settings: { allowAgents: true, scope: 'all' }, url: pages.url('user-a') });
    await pages.next('user-a');

    // Scope "all": the user's tabs, open before the session and opened during it.
    const first = await chrome.connect();
    await first.cdp.send('Target.setDiscoverTargets', { discover: true });
    const userA = findTarget(readTargets(await first.cdp.send('Target.getTargets', {})), pages.url('user-a'));
    await chrome.openTab(pages.url('user-b'));
    await pages.next('user-b');
    await waitUntil(() => findCreated(first.cdp.events, pages.url('user-b')), { timeoutMs: 5000, onTimeout: () => {} });

    expect(findCreated(first.cdp.events, pages.url('user-a'))).toBe(userA);
    expect(findCreated(first.cdp.events, pages.url('user-b'))).toBeString();
    // The background tab of the user's window: what a page without emulation reports.
    expect(await pages.next('user-a', Date.now() + SETTLE_MS)).toMatchObject({ visibility: 'hidden' });

    const userSession = await attach(first.cdp, userA);
    await first.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, userSession);
    expect(await pages.next('user-a', Date.now() + SETTLE_MS)).toMatchObject({ visibility: 'visible' });

    // Agent tabs: the first is in the background of the agent window once the second opens, and the agent window is
    // never the active one.
    const agent1 = await createTarget(first.cdp, 'about:blank');
    const session1 = await attach(first.cdp, agent1);
    await first.cdp.send('Page.navigate', { url: pages.url('agent-1') }, session1);
    const agent2 = await createTarget(first.cdp, pages.url('agent-2'));
    await pages.next('agent-2');

    expect(await pages.next('agent-1', Date.now() + SETTLE_MS)).toMatchObject({
        visibility: 'visible',
        webdriver: false,
    });

    const center = await first.cdp.send(
        'Runtime.evaluate',
        {
            expression: `window.flaneurIsolated = 1;
                document.body.dataset.agent = 'yes';
                const box = document.querySelector('button').getBoundingClientRect();
                ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })`,
            returnByValue: true,
        },
        session1,
    );
    const { x, y } = readPoint(center);
    for (const type of ['mousePressed', 'mouseReleased']) {
        await first.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, session1);
    }

    // The script ran in an isolated world: the page shares its DOM, not its globals.
    expect(await pages.settle('agent-1', report => report.clicks === 1)).toMatchObject({
        clicks: 1,
        marker: 'yes',
        isolatedLeak: 'undefined',
        visibility: 'visible',
        webdriver: false,
    });

    await first.cdp.send('Target.activateTarget', { targetId: agent1 });
    const closed = Date.now();
    await first.server.close();

    // Every tab stays open, and the debugger's focus emulation is gone: a tab in the background has no focus again.
    // Focus, not visibility: Chrome does not recompute a tab's visibility when the emulation goes. Which agent tab is
    // the active one after `activateTarget` depends on the desktop (macOS lets no app in the background come to the
    // front), so only the one in the background is asserted.
    expect(await pages.next('agent-1', closed + SETTLE_MS)).toBeDefined();
    expect(await pages.next('agent-2', closed + SETTLE_MS)).toMatchObject({ focus: false });
    expect(await pages.next('user-a', closed + SETTLE_MS)).toMatchObject({ focus: false });
    expect(await pages.next('user-b', closed + SETTLE_MS)).toBeDefined();

    // Scope "agent tabs only", on the extension's next connection, which its 30 s retry makes: the tabs of the last
    // session are the user's now.
    await chrome.setSettings({ allowAgents: true, scope: 'agent' });
    const second = await chrome.connect(RECONNECT_TIMEOUT_MS);
    await second.cdp.send('Target.setDiscoverTargets', { discover: true });
    const listed = readTargets(await second.cdp.send('Target.getTargets', {}));
    await chrome.openTab(pages.url('user-c'));
    await pages.next('user-c');
    const agent3 = await createTarget(second.cdp, pages.url('agent-3'));
    await attach(second.cdp, agent3);
    await pages.next('agent-3');
    await waitFor(500);

    expect(listed).toEqual([]);
    expect(readCreated(second.cdp.events)).toEqual([agent3]);
    await expect(attach(second.cdp, userA)).rejects.toThrow(/No target with given id found/);
    await expect(attach(second.cdp, agent2)).rejects.toThrow(/No target with given id found/);
}, 90_000);

/** Pages that report their state to the test: visibility, `navigator.webdriver`, trusted clicks, the DOM and globals. */
function servePages() {
    const reports: PageReport[] = [];
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const page = url.searchParams.get('id');
            if (url.pathname === '/page' && page != null && /^[\w-]+$/.test(page)) {
                return new Response(renderPage(page), { headers: { 'content-type': 'text/html' } });
            }
            if (url.pathname === '/report' && request.method === 'POST') {
                const report = readReport(await request.json());
                if (report) {
                    reports.push(report);
                }
                return new Response('');
            }
            return new Response('Not found', { status: 404 });
        },
    });
    cleanups.push(() => server.stop(true));

    return {
        url: (page: string) => `http://127.0.0.1:${server.port}/page?id=${page}`,
        next,
        settle,
    };

    /** The page's first report received at `since` or later: its state then, and proof it is still open. */
    async function next(page: string, since = 0) {
        let found: PageReport | undefined;
        await waitUntil(
            () => {
                found = reports.find(report => report.page === page && report.receivedAt >= since);
                return found;
            },
            {
                timeoutMs: 10_000,
                onTimeout: () => {
                    throw new Error(`The page ${page} reported nothing`);
                },
            },
        );
        assert(found);
        return found;
    }

    /** The page's latest report once it matches, or after 5 s the latest one, which the test's assertion judges. */
    async function settle(page: string, matches: (report: PageReport) => boolean) {
        await waitUntil(() => reports.some(report => report.page === page && matches(report)), {
            timeoutMs: 5000,
            onTimeout: () => {},
        });
        return reports.findLast(report => report.page === page && matches(report)) ?? (await next(page));
    }
}

/** What a test page says of itself. */
interface PageReport {
    page: string;
    visibility: string;
    webdriver: boolean;
    clicks: number;
    /** `typeof` the global an isolated-world script sets: `undefined` while the script stays out of the page's world. */
    isolatedLeak: string;
    focus: boolean;
    /** The DOM attribute the same script sets, which the page does see. */
    marker: string | null;
    receivedAt: number;
}

function renderPage(page: string) {
    return `<!doctype html><title>${page}</title>
<button style="position: fixed; left: 40px; top: 40px; width: 160px; height: 60px">Click me</button>
<script>
let clicks = 0;
document.querySelector('button').addEventListener('click', event => {
    if (event.isTrusted) clicks++;
    report();
});
document.addEventListener('visibilitychange', report);
setInterval(report, 250);
report();
function report() {
    fetch('/report', {
        method: 'POST',
        body: JSON.stringify({
            page: ${JSON.stringify(page)},
            visibility: document.visibilityState,
            focus: document.hasFocus(),
            webdriver: navigator.webdriver,
            clicks,
            isolatedLeak: typeof window.flaneurIsolated,
            marker: document.body.dataset.agent ?? null,
        }),
    });
}
</script>`;
}

function readReport(value: unknown): PageReport | undefined {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const { page, visibility, focus, webdriver, clicks, isolatedLeak, marker } = value;
    if (
        typeof page !== 'string' ||
        typeof visibility !== 'string' ||
        typeof webdriver !== 'boolean' ||
        typeof clicks !== 'number' ||
        typeof isolatedLeak !== 'string' ||
        typeof focus !== 'boolean' ||
        !(typeof marker === 'string' || marker === null)
    ) {
        return undefined;
    }
    return { page, visibility, focus, webdriver, clicks, isolatedLeak, marker, receivedAt: Date.now() };
}

/** What the extension starts with: its settings before the user changes any. */
interface ExtensionDefaults {
    allowAgents: boolean;
    scope: 'agent' | 'all';
}

interface StartChromeOptions {
    settings: ExtensionDefaults;
    /** The user's tab Chrome opens with. */
    url: string;
}

/**
 * Chrome for Testing with a window and a fresh profile, the extension loaded from a copy with `settings` as its
 * defaults, and the native host registered before Chrome starts: the extension connects at startup, and then only
 * every 30 s.
 */
async function startChrome(options: StartChromeOptions) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-own-'));
    cleanups.push(() => rm(tempDir, { recursive: true, force: true, maxRetries: 5 }));
    const dataDir = path.join(tempDir, 'data');
    const profileDir = path.join(tempDir, 'profile');
    const extensionDir = path.join(tempDir, 'extension');
    await copyExtension(extensionDir);
    await setSettings(options.settings);

    for (const registryKey of process.platform === 'win32' ? REGISTRY_KEYS : [undefined]) {
        await registerNativeHost({ dataDir, chromeUserDataDir: profileDir, registryKey });
        if (registryKey != null) {
            cleanups.push(() => execFileAsync('reg', ['delete', `${registryKey}\\${HOST_NAME}`, '/f']).catch(() => {}));
        }
    }

    const chrome = Bun.spawn(
        [
            chromium.executablePath(),
            ...getChromeArgs(profileDir),
            `--load-extension=${extensionDir}`,
            '--no-default-browser-check',
            options.url,
        ],
        { stdout: 'ignore', stderr: 'ignore' },
    );
    cleanups.push(async () => {
        chrome.kill();
        await chrome.exited;
    });

    return { connect, setSettings, openTab };

    /** Connects flaneur once the extension has, and serves it to a raw CDP client. */
    async function connect(timeoutMs = 10_000) {
        const { logger } = createTestLogger('OwnChrome');
        const browser = await connectOwnChrome({
            dataDir,
            chromeUserDataDir: profileDir,
            registryKey: REGISTRY_KEYS[0],
            launchChrome: false,
            timeoutMs,
            logger,
        });
        const server = await serveBrowser(browser, { logger });
        cleanups.push(() => server.close());
        const cdp = await connectCdp(server.endpoint);
        return { server, cdp };
    }

    /** The extension reads its defaults at each connection, from the folder Chrome loaded it from. */
    async function setSettings(settings: ExtensionDefaults) {
        await writeFile(path.join(extensionDir, 'defaults.json'), JSON.stringify(settings));
    }

    /** Opens a tab as the user would, outside flaneur: the running Chrome takes the URL from a second start. */
    async function openTab(url: string) {
        await execFileAsync(chromium.executablePath(), [...getChromeArgs(profileDir), url], { timeout: 10_000 });
    }
}

/** Copies the built extension, whose `defaults.json` the test then writes. */
async function copyExtension(target: string) {
    if (!existsSync(path.join(EXTENSION_DIR, 'dist', 'serviceWorker.js'))) {
        throw new Error(`The extension is not built in ${EXTENSION_DIR}: run \`bun run build\` first`);
    }
    await mkdir(path.join(target, 'dist'), { recursive: true });
    for (const file of ['manifest.json', 'options.html', 'icons', 'dist/serviceWorker.js', 'dist/options.js']) {
        await cp(path.join(EXTENSION_DIR, file), path.join(target, file), { recursive: true });
    }
}

/** The flags for Chrome on this system, with the profile; no debugging flag: only the extension may debug. */
function getChromeArgs(profileDir: string) {
    const args = [`--user-data-dir=${profileDir}`, '--no-first-run'];
    if (process.platform === 'darwin') {
        args.push('--use-mock-keychain');
    } else if (process.platform === 'linux') {
        // CI runners do not allow Chrome's sandbox, and have no keyring.
        args.push('--no-sandbox', '--password-store=basic');
    }
    return args;
}

async function createTarget(cdp: CdpTestClient, url: string) {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    assert(typeof targetId === 'string', 'Creating a target gives its id');
    return targetId;
}

async function attach(cdp: CdpTestClient, targetId: string) {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    assert(typeof sessionId === 'string', 'Attaching gives a session');
    return sessionId;
}

/** A target as the test tells them apart. */
interface TargetSummary {
    targetId: string;
    url: string;
}

function readTargets(result: Record<string, unknown>) {
    const targets: TargetSummary[] = [];
    for (const info of Array.isArray(result['targetInfos']) ? result['targetInfos'] : []) {
        const target = readTarget(info);
        if (target) {
            targets.push(target);
        }
    }
    return targets;
}

function readTarget(info: unknown): TargetSummary | undefined {
    if (!isPlainObject(info) || typeof info['targetId'] !== 'string' || typeof info['url'] !== 'string') {
        return undefined;
    }
    return { targetId: info['targetId'], url: info['url'] };
}

function findTarget(targets: TargetSummary[], url: string) {
    const target = targets.find(candidate => candidate.url === url);
    assert(target, `No target at ${url}`);
    return target.targetId;
}

/** The ids of the targets `Target.targetCreated` announced, in order. */
function readCreated(events: CdpTestEvent[]) {
    const created: string[] = [];
    for (const event of events) {
        const target = event.method === 'Target.targetCreated' ? readTarget(event.params['targetInfo']) : undefined;
        if (target) {
            created.push(target.targetId);
        }
    }
    return created;
}

/** The id of the target `Target.targetCreated` announced at `url`, before or after it loaded. */
function findCreated(events: CdpTestEvent[], url: string) {
    for (const event of events) {
        const target = event.method === 'Target.targetCreated' ? readTarget(event.params['targetInfo']) : undefined;
        if (target?.url === url) {
            return target.targetId;
        }
    }
    return undefined;
}

function readPoint(evaluated: Record<string, unknown>) {
    const result = evaluated['result'];
    const value = isPlainObject(result) ? result['value'] : undefined;
    assert(isPlainObject(value), 'The script returns a point');
    const { x, y } = value;
    assert(typeof x === 'number' && typeof y === 'number', 'The point has coordinates');
    return { x, y };
}

/** An event a CDP client received. */
interface CdpTestEvent {
    method: string;
    params: Record<string, unknown>;
}

type CdpTestClient = Awaited<ReturnType<typeof connectCdp>>;

/** A raw CDP client over Bun's WebSocket: `send` resolves with the command's result, rejects on its error. */
async function connectCdp(endpoint: string) {
    const socket = new WebSocket(endpoint);
    const pending = new Map<number, { resolve(result: Record<string, unknown>): void; reject(error: Error): void }>();
    const events: CdpTestEvent[] = [];
    let lastId = 0;
    socket.addEventListener('message', event => {
        const message: unknown = JSON.parse(String(event.data));
        if (!isPlainObject(message)) {
            return;
        }
        const { id, method, params, result, error } = message;
        if (typeof id !== 'number') {
            if (typeof method === 'string' && isPlainObject(params)) {
                events.push({ method, params });
            }
            return;
        }
        const waiting = pending.get(id);
        pending.delete(id);
        if (isPlainObject(result)) {
            waiting?.resolve(result);
        } else {
            waiting?.reject(new Error(JSON.stringify(error)));
        }
    });
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
    });

    return {
        events,
        send(method: string, params: object, sessionId?: string) {
            const id = ++lastId;
            socket.send(JSON.stringify({ id, method, params, sessionId }));
            return new Promise<Record<string, unknown>>((resolve, reject) => {
                pending.set(id, { resolve, reject });
            });
        },
    };
}
