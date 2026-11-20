import { assert } from '@nzyme/utils/assert.js';
import { assertNever } from '@nzyme/utils/assertNever.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { CdpError, OWN_CHROME_PROTOCOL_VERSION } from 'flaneur';
import type {
    OwnChromeErrorReply,
    OwnChromeExtensionMessage,
    OwnChromeTab,
    OwnChromeTabListResult,
    OwnChromeTabResult,
} from 'flaneur';

import { createTabScope } from './createTabScope.js';
import type { TabScope } from './createTabScope.js';
import { isWebUrl } from './isWebUrl.js';
import { readFlaneurMessage } from './readFlaneurMessage.js';
import type { FlaneurRequest } from './readFlaneurMessage.js';
import { readSettings } from './readSettings.js';
import type { TabScopeKind } from './readSettings.js';

/** One native messaging port to flaneur, and what flaneur sees through it. */
interface Connection {
    port: chrome.runtime.Port;
    scope: TabScope;
    /** Whether flaneur's `hello` was answered: nothing goes out before. */
    greeted: boolean;
    /** The tabs flaneur knows of: listed, created, or announced by `tab.created`. Every other tab is refused. */
    visible: Set<number>;
    /** The tabs flaneur attached the debugger to, detached when the connection ends. */
    attached: Set<number>;
    /** The tab events, handled one after another so they reach flaneur in Chrome's order. */
    tabEvents: Promise<void>;
}

/** The native messaging host flaneur registers. */
const NATIVE_HOST = 'com.flaneur.own_chrome';
/** Retries the connection while no port is open: `chrome.alarms` allows no shorter period than 30 s. */
const RECONNECT_ALARM = 'reconnect';
const RECONNECT_MINUTES = 0.5;
/** CDP: the parameters are wrong, here an unknown target. */
const INVALID_PARAMS = -32_602;

let connection: Connection | undefined;
let connecting = false;
/** Raised by every settings change, so a connect that read the settings before it reads them again. */
let settingsGeneration = 0;
/** The window flaneur's tabs open in, created with the first of them. */
let agentWindow: Promise<chrome.windows.Window> | undefined;
/** Each tab's CDP `targetId`, the only name flaneur knows it by. */
const targetIds = new Map<number, string>();

// Listeners register synchronously at the top: Chrome wakes the worker only for events it listened to on its first run.
chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RECONNECT_ALARM) {
        void connect();
    }
});
chrome.storage.onChanged.addListener(onSettingsChanged);
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
chrome.windows.onRemoved.addListener(windowId => void onWindowRemoved(windowId));
chrome.tabs.onCreated.addListener(tab => queueTabEvent(current => announceTab(current, tab)));
chrome.tabs.onUpdated.addListener((_tabId, change, tab) =>
    queueTabEvent(current => onTabUpdated(current, change, tab)),
);
chrome.tabs.onRemoved.addListener(tabId => queueTabEvent(current => removeTab(current, tabId)));
chrome.debugger.onEvent.addListener(onDebuggerEvent);
chrome.debugger.onDetach.addListener(onDebuggerDetach);
// A worker started any other way (the extension enabled again) connects too; a second call meanwhile does nothing.
void connect();

/** Opens the port to flaneur when none is open, and keeps the alarm that retries it. */
async function connect(): Promise<void> {
    if (connection || connecting) {
        return;
    }
    connecting = true;
    const generation = settingsGeneration;
    let settings;
    try {
        settings = await readSettings();
    } finally {
        connecting = false;
    }
    if (generation !== settingsGeneration) {
        return connect();
    }
    open(settings.scope);
    // Once a port is open the alarm finds it and does nothing; it retries after the port closes.
    if (!(await chrome.alarms.get(RECONNECT_ALARM))) {
        await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_MINUTES });
    }
}

function open(scope: TabScopeKind) {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    const current: Connection = {
        port,
        scope: createTabScope(scope),
        greeted: false,
        visible: new Set(),
        attached: new Set(),
        tabEvents: Promise.resolve(),
    };
    connection = current;
    port.onMessage.addListener(message => void handleMessage(current, message));
    port.onDisconnect.addListener(() => {
        // Read, so Chrome does not report it unchecked: a missing host is the usual one, and the alarm retries.
        console.debug('flaneur: the native host disconnected', chrome.runtime.lastError?.message);
        end(current);
    });
}

/** Drops the connection; flaneur sees the port close. */
function disconnect() {
    if (connection) {
        const current = connection;
        current.port.disconnect();
        end(current);
    }
}

/** Forgets a connection, its agent tabs with it, and releases the tabs flaneur left attached. */
function end(current: Connection) {
    if (connection !== current) {
        return;
    }
    connection = undefined;
    showConnected(false);
    for (const tabId of current.attached) {
        chrome.debugger.detach({ tabId }).catch(() => {});
    }
}

/** A scope change drops the connection; flaneur connects again and sees the new scope. */
function onSettingsChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'local' || !('scope' in changes)) {
        return;
    }
    settingsGeneration++;
    disconnect();
    void connect();
}

async function handleMessage(current: Connection, value: unknown) {
    if (connection !== current) {
        return;
    }
    const message = readFlaneurMessage(value);
    if (message == null) {
        const id = isPlainObject(value) ? value['id'] : undefined;
        if (current.greeted && typeof id === 'number') {
            post(current, { type: 'error', id, message: 'Not an operation of the flaneur protocol' });
        }
        return;
    }
    if (message.type === 'hello') {
        // On a version mismatch too: flaneur tells the user which side to update.
        if (!current.greeted) {
            current.greeted = true;
            post(current, { type: 'hello', version: OWN_CHROME_PROTOCOL_VERSION, userAgent: navigator.userAgent });
            showConnected(true);
        }
        return;
    }
    if (!current.greeted) {
        return;
    }
    try {
        const result = await execute(current, message);
        post(current, { type: 'reply', id: message.id, result });
    } catch (error) {
        post(current, toErrorReply(message.id, error));
    }
}

async function execute(current: Connection, request: FlaneurRequest): Promise<unknown> {
    switch (request.type) {
        case 'tabs.create':
            return createTab(current, request.url ?? 'about:blank');
        case 'tabs.list':
            return listTabs(current);
        case 'tabs.close':
            await chrome.tabs.remove(await findTab(current, request.targetId));
            return {};
        case 'tabs.activate': {
            const tab = await chrome.tabs.update(await findTab(current, request.targetId), { active: true });
            assert(tab, 'The tab is gone');
            await chrome.windows.update(tab.windowId, { focused: true });
            return {};
        }
        case 'debugger.attach': {
            const tabId = await findTab(current, request.targetId);
            await chrome.debugger.attach({ tabId }, '1.3');
            current.attached.add(tabId);
            return {};
        }
        case 'debugger.detach': {
            const tabId = await findTab(current, request.targetId);
            current.attached.delete(tabId);
            await chrome.debugger.detach({ tabId });
            return {};
        }
        case 'debugger.send': {
            const tabId = await findTab(current, request.targetId);
            const target: chrome.debugger.DebuggerSession =
                request.sessionId == null ? { tabId } : { tabId, sessionId: request.sessionId };
            return (await chrome.debugger.sendCommand(target, request.method, request.params)) ?? {};
        }
        default:
            return assertNever(request);
    }
}

async function createTab(current: Connection, url: string): Promise<OwnChromeTabResult> {
    if (!isWebUrl(url)) {
        throw new Error('flaneur opens web pages only');
    }
    const tab = await openAgentTab(url);
    assert(tab.id, 'Chrome created a tab without an id');
    current.scope.addAgentTab(tab.id);
    current.visible.add(tab.id);
    const info = await describeTab(current, tab);
    assert(info, 'The new tab has no debugging target');
    return { tab: info };
}

/** A tab in the agent window, which opens unfocused with the first one, so the user's window keeps the focus. */
async function openAgentTab(url: string) {
    if (agentWindow) {
        const { id } = await agentWindow;
        assert(id, 'The agent window has no id');
        return await chrome.tabs.create({ windowId: id, url, active: true });
    }
    const created = chrome.windows.create({ focused: false, url }).then(window => {
        assert(window, 'Chrome did not create the agent window');
        return window;
    });
    agentWindow = created;
    try {
        const window = await created;
        const tab = window.tabs?.[0];
        assert(tab, 'Chrome created the agent window without a tab');
        return tab;
    } catch (error) {
        if (agentWindow === created) {
            agentWindow = undefined;
        }
        throw error;
    }
}

async function onWindowRemoved(windowId: number) {
    const removed = agentWindow;
    const window = await removed?.catch(() => undefined);
    if (window?.id === windowId && agentWindow === removed) {
        agentWindow = undefined;
    }
}

async function listTabs(current: Connection): Promise<OwnChromeTabListResult> {
    const tabs: OwnChromeTab[] = [];
    for (const tab of await chrome.tabs.query({})) {
        if (tab.id == null || !current.scope.includes(tab)) {
            continue;
        }
        const info = await describeTab(current, tab);
        if (info) {
            current.visible.add(tab.id);
            tabs.push(info);
        }
    }
    return { tabs };
}

/** The tab flaneur names by `targetId`, when it may see it; any other is unknown to it, as if it did not exist. */
async function findTab(current: Connection, targetId: string) {
    let tabId = findTabId(targetId);
    if (tabId == null) {
        await refreshTargetIds();
        tabId = findTabId(targetId);
    }
    if (tabId == null || !current.visible.has(tabId)) {
        throw new CdpError({ code: INVALID_PARAMS, message: 'No target with given id found' });
    }
    return tabId;
}

function findTabId(targetId: string) {
    for (const [tabId, id] of targetIds) {
        if (id === targetId) {
            return tabId;
        }
    }
    return undefined;
}

/** The tab as flaneur sees it; `null` for a tab Chrome cannot debug, which then stays out of sight. */
async function describeTab(current: Connection, tab: chrome.tabs.Tab): Promise<OwnChromeTab | null> {
    const targetId = tab.id == null ? undefined : await getTargetId(tab.id);
    if (targetId == null) {
        return null;
    }
    const info: OwnChromeTab = { targetId, url: tab.url || tab.pendingUrl || '', title: tab.title ?? '' };
    // An opener out of sight is not named.
    const openerId =
        tab.openerTabId != null && current.visible.has(tab.openerTabId) ? targetIds.get(tab.openerTabId) : undefined;
    return openerId == null ? info : { ...info, openerId };
}

async function getTargetId(tabId: number) {
    if (!targetIds.has(tabId)) {
        await refreshTargetIds();
    }
    return targetIds.get(tabId);
}

async function refreshTargetIds() {
    for (const target of await chrome.debugger.getTargets()) {
        if (target.tabId != null) {
            targetIds.set(target.tabId, target.id);
        }
    }
}

/** Runs a tab event's handling for the greeted connection, after the events before it. */
function queueTabEvent(handle: (current: Connection) => Promise<void>) {
    const current = connection;
    if (!current?.greeted) {
        return;
    }
    current.tabEvents = current.tabEvents.then(() => handle(current)).catch(() => {});
}

/** Tells flaneur of a tab that came into scope. */
async function announceTab(current: Connection, tab: chrome.tabs.Tab) {
    if (tab.id == null || current.visible.has(tab.id) || !current.scope.includes(tab)) {
        return;
    }
    const info = await describeTab(current, tab);
    if (info) {
        current.visible.add(tab.id);
        post(current, { type: 'tab.created', tab: info });
    }
}

/** A tab's URL may move it into scope or out of it (scope `all`); within scope flaneur hears of its URL and title. */
async function onTabUpdated(current: Connection, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
    if (tab.id == null) {
        return;
    }
    if (!current.visible.has(tab.id)) {
        await announceTab(current, tab);
    } else if (!current.scope.includes(tab)) {
        await removeTab(current, tab.id);
    } else if (change.url != null || change.title != null) {
        const info = await describeTab(current, tab);
        if (info) {
            post(current, { type: 'tab.updated', tab: info });
        }
    }
}

async function removeTab(current: Connection, tabId: number) {
    if (!current.visible.delete(tabId)) {
        return;
    }
    current.attached.delete(tabId);
    const targetId = await getTargetId(tabId);
    if (targetId != null) {
        post(current, { type: 'tab.removed', targetId });
    }
}

function onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params?: object) {
    const current = connection;
    const targetId = source.tabId == null ? undefined : targetIds.get(source.tabId);
    if (!current?.greeted || source.tabId == null || targetId == null || !current.visible.has(source.tabId)) {
        return;
    }
    post(
        current,
        source.sessionId == null
            ? { type: 'debugger.event', targetId, method, params: params ?? {} }
            : { type: 'debugger.event', targetId, sessionId: source.sessionId, method, params: params ?? {} },
    );
}

/** Chrome ended an attachment: the tab closed, or the user cancelled the debugging bar. Not fired for our detach. */
function onDebuggerDetach(source: chrome.debugger.Debuggee, reason: string) {
    const current = connection;
    const targetId = source.tabId == null ? undefined : targetIds.get(source.tabId);
    if (!current?.greeted || source.tabId == null || targetId == null || !current.attached.delete(source.tabId)) {
        return;
    }
    post(current, { type: 'debugger.detached', targetId, reason });
}

function post(current: Connection, message: OwnChromeExtensionMessage) {
    if (connection === current) {
        current.port.postMessage(message);
    }
}

/** A failed request as flaneur reads it; `chrome.debugger` reports a CDP error as its JSON, whose code is kept. */
function toErrorReply(id: number, error: unknown): OwnChromeErrorReply {
    if (error instanceof CdpError) {
        return { type: 'error', id, message: error.message, code: error.code };
    }
    const message = error instanceof Error ? error.message : 'The operation failed';
    const cdpError = parseJson(message);
    if (isPlainObject(cdpError) && typeof cdpError['code'] === 'number' && typeof cdpError['message'] === 'string') {
        return { type: 'error', id, message: cdpError['message'], code: cdpError['code'] };
    }
    return { type: 'error', id, message };
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** The badge tells the user an agent is connected to this Chrome. */
function showConnected(connected: boolean) {
    void chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
    void chrome.action.setBadgeBackgroundColor({ color: '#1a7f37' });
    void chrome.action.setTitle({ title: connected ? 'flaneur: an agent is connected' : 'flaneur' });
}
