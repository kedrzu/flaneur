import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { assert } from '@nzyme/utils/assert.js';

import { createHumanInput } from './createHumanInput.js';
import { createSitePace } from './createSitePace.js';
import type { StealthBrowserServer } from './serveBrowser.js';
import { serveStealthBrowser } from './serveStealthBrowser.js';

/**
 * agent-browser, the pinned release, over flaneur's endpoint with the human input on, against a page whose own script
 * writes down every trace a site's sensor could see of the agent: attribute changes, untrusted events, focus with no
 * pointer or key before it, input with no key, a scroll with no wheel. The browser is Playwright's Chromium, headless
 * and without the sandbox, which CI runners do not allow. agent-browser is downloaded once into the temp folder; the
 * tests run on every platform with a pinned build, and a failed download fails them rather than hiding them.
 */
const AGENT_BROWSER_VERSION = '0.43.0';
/** The release's builds by `${process.platform}-${process.arch}`, with their SHA-256 as the release lists them. */
const AGENT_BROWSER_BUILDS: Record<string, string | undefined> = {
    'darwin-arm64': '05338a8eeddf0b3f9ebf0c87a6c21aedc10685608c68618e1a8483c43eae9c3f',
    'darwin-x64': '49a5ab27297213c1bc0005701a6a4542399abfc9d2cb7520ab519ebb94b8b13d',
    'linux-arm64': '34be55c2b92d8d199fb9d1d62a905ee5b6ac5b1f3e8c24e5b20597f370d905e5',
    'linux-x64': '8e69c9fb662514c9cf36e4911e94e913742ba066e55102486350e049dd847612',
};
const BROWSER_ARGS = ['--headless=new', '--no-sandbox'];
const TIMEOUT_MS = 90_000;

/** Records into `#trace` what a sensor would flag; `#done` lists the clicks, to show the actions happened. */
const DETECTOR_SCRIPT = `
    const trace = [];
    const done = [];
    const write = () => {
        document.getElementById('trace').textContent = JSON.stringify(trace);
        document.getElementById('done').textContent = JSON.stringify(done);
    };
    const last = { pointer: -Infinity, key: -Infinity, wheel: -Infinity };
    const since = kind => performance.now() - last[kind];
    const name = node => node.id || node.localName;
    addEventListener('pointerdown', () => { last.pointer = performance.now(); }, true);
    addEventListener('keydown', () => { last.key = performance.now(); }, true);
    addEventListener('wheel', () => { last.wheel = performance.now(); }, true);
    for (const type of ['pointerdown', 'mousedown', 'click', 'keydown', 'beforeinput', 'input', 'change', 'focus', 'select', 'scroll']) {
        addEventListener(type, event => {
            if (!event.isTrusted) {
                trace.push('untrusted ' + type + ' on ' + name(event.target));
            }
            write();
        }, true);
    }
    addEventListener('click', event => { done.push(name(event.target)); write(); }, true);
    addEventListener('focus', event => {
        if (event.target !== window && since('pointer') > 1000 && since('key') > 1000) {
            trace.push('focus with no pointer or key on ' + name(event.target));
            write();
        }
    }, true);
    addEventListener('input', event => {
        if (since('key') > 1000) {
            trace.push('input with no key on ' + name(event.target));
            write();
        }
    }, true);
    addEventListener('scroll', () => {
        if (since('wheel') > 1000) {
            trace.push('scroll with no wheel');
            write();
        }
    }, true);
    new MutationObserver(records => {
        for (const record of records) {
            trace.push('attribute ' + record.attributeName + ' on ' + name(record.target));
        }
        write();
    }).observe(document, { attributes: true, subtree: true });`;

/** agent-browser ships no build pinned here for this platform (Windows): its tests do not apply. */
const unsupported = AGENT_BROWSER_BUILDS[`${process.platform}-${process.arch}`] == null;
const executable = unsupported ? undefined : await installAgentBrowser();

let site: { server: Server; url: string };
let served: StealthBrowserServer;
let userDataDir: string;

beforeAll(async () => {
    site = await servePage();
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-agent-browser-'));
    served = await serveStealthBrowser({
        executablePath: chromium.executablePath(),
        userDataDir,
        args: BROWSER_ARGS,
        input: createHumanInput({ minTimeOnPageMs: 300, maxTimeOnPageMs: 600 }),
        pace: createSitePace({ intervalMs: 0 }),
        logger: createTestLogger('StealthBrowser').logger,
    });
}, TIMEOUT_MS);

afterAll(async () => {
    await served?.close();
    site?.server.closeAllConnections();
    site?.server.close();
    await rm(userDataDir, { recursive: true, force: true });
}, TIMEOUT_MS);

test.skipIf(unsupported)(
    'snapshot and find mark no element on the page, and still find the element',
    async () => {
        const agent = openAgent();
        try {
            await agent.run('open', site.url);
            const snapshot = await agent.run('snapshot', '-i');
            await agent.run('find', 'text', 'Go', 'click');
            await agent.run('find', 'label', 'Name', 'hover');

            // The element only a data attribute could tell agent-browser about: a div with a pointer cursor.
            expect(snapshot).toMatch(/"Card" \[ref=e\d+\] clickable/);
            expect(await agent.read('done')).toEqual(['go']);
            expect((await agent.read('trace')).filter(entry => entry.startsWith('attribute'))).toEqual([]);
        } finally {
            await agent.close();
        }
    },
    TIMEOUT_MS,
);

test.skipIf(unsupported)(
    "fill, type, focus and scrolls reach the page as a hand's clicks, keys and wheel, with no script's events",
    async () => {
        const agent = openAgent();
        try {
            await agent.run('open', site.url);
            await agent.run('fill', '#name', 'hello');
            await agent.run('type', '#name', '!');
            const value = await agent.run('get', 'value', '#name');
            await agent.run('scroll', 'down', '400');
            await agent.run('scrollintoview', '#far');
            const filled = { done: await agent.read('done'), trace: await agent.read('trace') };
            // `click` on a CSS selector out of view, which agent-browser scrolls to itself.
            await agent.run('open', site.url);
            await agent.run('focus', '#name');
            await agent.run('click', '#far');
            const clicked = { done: await agent.read('done'), trace: await agent.read('trace') };

            expect({ value: value.trim(), filled, clicked }).toEqual({
                value: 'hello!',
                filled: { done: ['name'], trace: [] },
                clicked: { done: ['name', 'far'], trace: [] },
            });
        } finally {
            await agent.close();
        }
    },
    TIMEOUT_MS,
);

/** An agent-browser session on the served browser. */
function openAgent() {
    assert(executable != null, 'agent-browser is installed');
    const env = {
        ...process.env,
        AGENT_BROWSER_CDP: served.endpoint,
        AGENT_BROWSER_SESSION: `flaneur-test-${crypto.randomUUID()}`,
        AGENT_BROWSER_NO_VERSION_CHECK: '1',
    };
    return { run, read, close: () => run('close') };

    /** Runs one command; its stdout. */
    async function run(...args: string[]) {
        assert(executable != null, 'agent-browser is installed');
        const child = Bun.spawn([executable, ...args], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);
        if (exitCode !== 0) {
            throw new Error(`agent-browser ${args.join(' ')} failed (exit ${exitCode}): ${stderr || stdout}`);
        }
        return stdout;
    }

    /** What the page wrote into the element `id`, read in the isolated world agent-browser's `eval` runs in. */
    async function read(id: string): Promise<string[]> {
        const reply: unknown = JSON.parse(await run('--json', 'eval', `document.getElementById('${id}').textContent`));
        const text = isReply(reply) ? reply.data.result : undefined;
        const parsed: unknown = JSON.parse(typeof text === 'string' && text !== '' ? text : '[]');
        assert(Array.isArray(parsed), 'The page writes a list');
        return parsed.map(String);
    }
}

/** agent-browser's `--json` reply of a command that succeeded. */
function isReply(reply: unknown): reply is { data: { result?: unknown } } {
    return typeof reply === 'object' && reply !== null && 'data' in reply && typeof reply.data === 'object';
}

/** Serves the detector page on `127.0.0.1`. */
async function servePage() {
    const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body>
            <button id="go">Go</button>
            <input id="name" aria-label="Name" value="old">
            <div id="card" style="cursor:pointer;width:200px" onclick="void 0">Card</div>
            <pre id="trace" hidden></pre>
            <pre id="done" hidden></pre>
            <div style="height:3000px"></div>
            <button id="far">Far</button>
            <script>${DETECTOR_SCRIPT}</script>
        </body></html>`);
    });
    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert(address != null && typeof address === 'object', 'A listening TCP server has an address');
    return { server, url: `http://127.0.0.1:${address.port}/` };
}

/**
 * The pinned agent-browser for this platform, downloaded into the temp folder unless it is there and checked against
 * its checksum; a download that does not match is never made executable.
 */
async function installAgentBrowser() {
    const target = `${process.platform}-${process.arch}`;
    const sha256 = AGENT_BROWSER_BUILDS[target];
    if (sha256 == null) {
        throw new Error(`No agent-browser build is pinned for ${target}`);
    }
    const folder = path.join(os.tmpdir(), 'flaneur-test-agent-browser', AGENT_BROWSER_VERSION);
    const file = path.join(folder, 'agent-browser');
    if (existsSync(file)) {
        return file;
    }
    await mkdir(folder, { recursive: true });
    const url = `https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/agent-browser-${target}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`agent-browser download failed: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (actual !== sha256) {
        throw new Error(`agent-browser download does not match the pinned checksum (got ${actual})`);
    }
    // Written aside and renamed, so a half-written file never passes for an installed one.
    const partial = `${file}.${crypto.randomUUID()}.partial`;
    try {
        await Bun.write(partial, bytes);
        await chmod(partial, 0o755);
        await rename(partial, file);
    } finally {
        await rm(partial, { force: true });
    }
    return file;
}
