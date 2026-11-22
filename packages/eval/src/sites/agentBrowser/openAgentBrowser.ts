import { setTimeout as sleep } from 'node:timers/promises';

import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { AgentBrowserError, createAgentBrowserCli } from '../../createAgentBrowserCli.js';
import type { CreateAgentBrowserCliParams } from '../../createAgentBrowserCli.js';
import type { NamedCookie } from '../../vendorCookies.js';

/** An agent-browser session in its own tab of flaneur: the commands an agent runs, typed. */
export interface AgentBrowser {
    /**
     * `open <url>`: loads the page. A page that does not fire `load` within agent-browser's wait (Zara's home page
     * streams video) is taken as open, as an agent goes on reading it.
     */
    open(url: string): Promise<void>;
    /** `snapshot -i`, with `-u` the links' URLs, with `-s` scoped to a CSS selector: what the agent reads. */
    snapshot(options?: SnapshotOptions): Promise<Snapshot>;
    /**
     * Takes a snapshot until an element matches, as an agent looks again at a page still loading, and gives its ref
     * (`@e12`) for the commands after.
     * @throws {AgentBrowserError} With `missingTarget` when nothing matched within the action timeout.
     */
    findRef(query: ElementQuery): Promise<string>;
    /** As `findRef`, the whole element: its name and URL too. */
    findElement(query: ElementQuery): Promise<SnapshotElement>;
    /** `find role <role> click --name <name>`, tried again while nothing matches, within the action timeout. */
    clickRole(role: string, name: string, options?: ClickRoleOptions): Promise<void>;
    /**
     * `click <@ref|selector>`, tried again while the target is missing, within the action timeout. Given a query, each
     * try clicks the ref of a fresh snapshot, as an agent does when a re-rendered page dropped the ref it had.
     */
    click(target: string | ElementQuery): Promise<void>;
    /** `fill <@ref|selector> <text>`: clears the field and types the text. */
    fill(target: string, text: string): Promise<void>;
    /** `press <key>`, into the focused element. */
    press(key: string): Promise<void>;
    /** `scroll <direction> [px]`. */
    scroll(direction: 'up' | 'down', px?: number): Promise<void>;
    /** `back`. */
    back(): Promise<void>;
    /** `get url`. */
    url(): Promise<string>;
    /**
     * Reads `get url` until it matches, as an agent confirms where an action took it.
     * @returns The matching URL.
     */
    waitForUrl(pattern: RegExp): Promise<string>;
    /** `eval <expression>`, in flaneur's isolated world: it sees the DOM, not the page's scripts. */
    eval(expression: string): Promise<unknown>;
    /** `cookies get`: the cookies the browser sends to the current page. */
    cookies(): Promise<NamedCookie[]>;
    /** `screenshot <path>`. */
    screenshot(path: string): Promise<void>;
    /** Runs `action` with its commands looking for their target `timeoutMs` only, then restores the action timeout. */
    withActionTimeout(timeoutMs: number, action: () => Promise<void>): Promise<void>;
}

/** Options of `AgentBrowser.snapshot`. */
export interface SnapshotOptions {
    /** `-u`: the links' URLs. */
    urls?: boolean;
    /** `-s`: only the part of the page this CSS selector matches. */
    within?: string;
}

/** A snapshot of the interactive elements, as agent-browser prints it and as parsed. */
export interface Snapshot {
    text: string;
    elements: SnapshotElement[];
}

/** One element of a snapshot. */
export interface SnapshotElement {
    /** `@e12`. */
    ref: string;
    role: string;
    /** The accessible name; empty when it has none. */
    name: string;
    /** A link's URL, in a snapshot taken with `urls`. */
    url?: string;
    /** A checkbox's or radio's state. */
    checked?: boolean;
}

/** Which element `AgentBrowser.findRef` looks for: the first in the snapshot that matches every given field. */
export interface ElementQuery {
    role: string;
    name?: RegExp;
    /** A link's URL; the snapshot is taken with `-u`. */
    url?: RegExp;
    /** Only the part of the page this CSS selector matches. */
    within?: string;
}

/** Options of `AgentBrowser.clickRole`. */
export interface ClickRoleOptions {
    /** `--exact`: the whole name, case-sensitive; without it a case-insensitive substring. */
    exact?: boolean;
}

/** Options of `openAgentBrowser`. */
export interface OpenAgentBrowserParams extends CreateAgentBrowserCliParams {
    /** How long a command keeps trying to find its target, and `waitForUrl` to see its URL. */
    actionTimeoutMs: number;
}

/** A session of `openAgentBrowser`, with the means to end it. */
export interface AgentBrowserSession {
    ab: AgentBrowser;
    /** Closes the tabs the session opened and ends agent-browser's background process; flaneur's Chrome keeps running. */
    close(): Promise<void>;
}

/** Between two tries of a command whose target is missing, and two looks at the URL: an agent's next turn. */
const RETRY_MS = 1000;

/** agent-browser's error when a page it opened did not reach `load` in its wait. */
const LOAD_TIMEOUT = /Timed out after \d+ms waiting for load state 'load'/;

/** A line of `snapshot`: `- link "Cart (0)" [ref=e14, url=http://…]`. */
const SNAPSHOT_LINE = /^\s*- (\S+)(?: "((?:[^"\\]|\\.)*)")?(?: \[(.*?)\](?=:|$))?/;

/**
 * Opens an agent-browser session on flaneur in a tab of its own: its commands act on that tab, or on a tab a click in
 * it opened, which agent-browser moves to by itself.
 */
export async function openAgentBrowser(params: OpenAgentBrowserParams): Promise<AgentBrowserSession> {
    const cli = createAgentBrowserCli(params);
    let actionTimeoutMs = params.actionTimeoutMs;

    const before = await listTabs();
    await cli.json('tab', 'new');

    const ab: AgentBrowser = {
        open,
        snapshot,
        findRef: async query => (await findElement(query)).ref,
        findElement,
        clickRole: (role, name, options = {}) =>
            retryWhileMissing(() =>
                run('find', 'role', role, 'click', '--name', name, ...(options.exact ? ['--exact'] : [])),
            ),
        click: target =>
            retryWhileMissing(async () =>
                run('click', typeof target === 'string' ? target : (await findOnce(target)).ref),
            ),
        fill: (target, text) => retryWhileMissing(() => run('fill', target, text)),
        press: key => run('press', key),
        scroll: (direction, px) => run('scroll', direction, ...(px == null ? [] : [String(px)])),
        back: () => run('back'),
        url: readUrl,
        waitForUrl,
        eval: evaluate,
        cookies,
        screenshot: path => run('screenshot', path),
        withActionTimeout,
    };
    return { ab, close };

    async function close() {
        try {
            for (const tab of await listTabs()) {
                if (!before.includes(tab)) {
                    await cli.json('tab', 'close', tab);
                }
            }
        } finally {
            await cli.json('close');
        }
    }

    async function run(...args: string[]) {
        await cli.json(...args);
    }

    async function snapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
        const data = await cli.json(
            'snapshot',
            '-i',
            ...(options.urls ? ['-u'] : []),
            ...(options.within == null ? [] : ['-s', options.within]),
        );
        const text = typeof data['snapshot'] === 'string' ? data['snapshot'] : '';
        return { text, elements: parseSnapshot(text) };
    }

    async function open(url: string) {
        try {
            await run('open', url);
        } catch (error) {
            if (!(error instanceof AgentBrowserError) || !LOAD_TIMEOUT.test(error.message)) {
                throw error;
            }
        }
    }

    function findElement(query: ElementQuery) {
        return retryWhileMissing(() => findOnce(query));
    }

    async function findOnce(query: ElementQuery) {
        const { elements } = await snapshot({
            urls: query.url != null,
            ...(query.within == null ? {} : { within: query.within }),
        });
        const found = elements.find(
            element =>
                element.role === query.role &&
                (query.name == null || query.name.test(element.name)) &&
                (query.url == null || (element.url != null && query.url.test(element.url))),
        );
        if (found == null) {
            throw new AgentBrowserError('snapshot -i', `No element found: ${describeQuery(query)}`);
        }
        return found;
    }

    async function readUrl() {
        const { url } = await cli.json('get', 'url');
        if (typeof url !== 'string') {
            throw new TypeError('agent-browser get url gave no URL');
        }
        return url;
    }

    async function waitForUrl(pattern: RegExp) {
        const deadline = Date.now() + actionTimeoutMs;
        let url = await readUrl();
        while (!pattern.test(url)) {
            if (Date.now() > deadline) {
                throw new Error(`The URL ${url} did not match ${pattern} in ${actionTimeoutMs / 1000} s`);
            }
            await sleep(RETRY_MS);
            url = await readUrl();
        }
        return url;
    }

    async function evaluate(expression: string) {
        const data = await cli.json('eval', expression);
        if (!('result' in data)) {
            throw new Error('agent-browser eval gave no result');
        }
        return data['result'];
    }

    /**
     * agent-browser lists every cookie of the browser's default context; Playwright's `cookies(url)` gives those sent
     * to the page, which are the ones the timeline counts, so the others are left out by domain.
     */
    async function cookies(): Promise<NamedCookie[]> {
        const [data, url] = await Promise.all([cli.json('cookies', 'get'), readUrl()]);
        const host = URL.parse(url)?.hostname ?? '';
        const list = Array.isArray(data['cookies']) ? data['cookies'] : [];
        return list.flatMap(cookie => {
            if (!isPlainObject(cookie)) {
                return [];
            }
            const { name, value, domain } = cookie;
            if (typeof name !== 'string' || typeof value !== 'string' || typeof domain !== 'string') {
                return [];
            }
            const bare = domain.replace(/^\./, '');
            return host === bare || host.endsWith(`.${bare}`) ? [{ name, value }] : [];
        });
    }

    async function withActionTimeout(timeoutMs: number, action: () => Promise<void>) {
        const previous = actionTimeoutMs;
        actionTimeoutMs = timeoutMs;
        try {
            await action();
        } finally {
            actionTimeoutMs = previous;
        }
    }

    /** Tries `command` again while it fails on a missing target, until the action timeout; an agent snapshots and retries. */
    async function retryWhileMissing<T>(command: () => Promise<T>): Promise<T> {
        const deadline = Date.now() + actionTimeoutMs;
        for (;;) {
            try {
                return await command();
            } catch (error) {
                if (!(error instanceof AgentBrowserError) || !error.missingTarget || Date.now() > deadline) {
                    throw error;
                }
            }
            await sleep(RETRY_MS);
        }
    }

    /** The target ids of the open tabs. */
    async function listTabs() {
        const { tabs } = await cli.json('tab', 'list');
        return (Array.isArray(tabs) ? tabs : []).flatMap(tab =>
            isPlainObject(tab) && typeof tab['targetId'] === 'string' ? [tab['targetId']] : [],
        );
    }
}

/**
 * The elements with a ref in a `snapshot` text, in its order.
 * @__NO_SIDE_EFFECTS__
 */
export function parseSnapshot(text: string): SnapshotElement[] {
    const elements: SnapshotElement[] = [];
    for (const line of text.split('\n')) {
        const match = SNAPSHOT_LINE.exec(line);
        const [, role, quotedName, attributes] = match ?? [];
        if (role == null || attributes == null) {
            continue;
        }
        const fields = new Map(
            attributes.split(/, (?=[\w-]+=)/).map(field => {
                const at = field.indexOf('=');
                return [field.slice(0, at), field.slice(at + 1)] as const;
            }),
        );
        const ref = fields.get('ref');
        if (ref == null) {
            continue;
        }
        const url = fields.get('url');
        const checked = fields.get('checked');
        elements.push({
            ref: `@${ref}`,
            role,
            name: quotedName == null ? '' : unquote(quotedName),
            ...(url == null ? {} : { url }),
            ...(checked == null ? {} : { checked: checked === 'true' }),
        });
    }
    return elements;
}

/** A snapshot's quoted name, escapes undone. */
function unquote(quoted: string) {
    try {
        const name: unknown = JSON.parse(`"${quoted}"`);
        return typeof name === 'string' ? name : quoted;
    } catch {
        return quoted;
    }
}

function describeQuery(query: ElementQuery) {
    const parts = [
        query.role,
        ...(query.name == null ? [] : [`name ${query.name}`]),
        ...(query.url == null ? [] : [`url ${query.url}`]),
        ...(query.within == null ? [] : [`within ${query.within}`]),
    ];
    return parts.join(', ');
}
