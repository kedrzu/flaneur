import type { Logger } from '@nzyme/logging/Logger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { CdpError } from './CdpTypes.js';
import type { StealthBrowserCommand, StealthBrowserConnection, StealthBrowserExit } from './createStealthBrowser.js';
import { OWN_CHROME_PROTOCOL_VERSION, readOwnChromeMessage, readOwnChromeTab } from './OwnChromeProtocol.js';
import type {
    OwnChromeExtensionMessage,
    OwnChromeFlaneurMessage,
    OwnChromeHelloReply,
    OwnChromeRequest,
    OwnChromeTab,
} from './OwnChromeProtocol.js';

/** How messages reach the extension and back, whatever carries them (native messaging through a local host). */
export interface OwnChromeChannel {
    send(message: OwnChromeFlaneurMessage): void;
    /** Subscribes to every message of the extension, unchecked: it comes from another process. */
    onMessage(listener: (message: unknown) => void): void;
    /** Settles once the channel is gone, whichever end closed it. */
    closed: Promise<void>;
    close(): void;
}

/** A request to the extension waiting for its reply. */
interface PendingRequest {
    resolve(result: unknown): void;
    reject(error: Error): void;
}

/** A request without its id, which `request` numbers; one member of the union at a time. */
type WithoutId<R> = R extends OwnChromeRequest ? Omit<R, 'id'> : never;

/** A request as its caller writes it. */
type OwnChromeRequestBody = WithoutId<OwnChromeRequest>;

/** A session on a tab: one at a time per tab. */
interface TabSession {
    sessionId: string;
    /** Whether `Target.attachedToTarget` went out: until then the session is only reserved. */
    announced: boolean;
    /** Child sessions auto-attached under it, which end with it. */
    children: Set<string>;
}

/** A tab in scope and the one attachment flaneur keeps on it. */
interface OwnTab {
    info: OwnChromeTab;
    /** Created by flaneur, or opened by such a tab: attached for the whole connection, with focus emulation. */
    agent: boolean;
    attached: boolean;
    session?: TabSession;
    /** The attach and reset steps of the tab, run one after another. */
    queue: Promise<void>;
}

/** CDP: the method is unknown. */
const METHOD_NOT_FOUND = -32_601;
/** CDP: the parameters are wrong, e.g. an unknown target. */
const INVALID_PARAMS = -32_602;
/** CDP: a generic server error. */
const SERVER_ERROR = -32_000;
/** Never exited as a process: there is none of ours. */
const NO_EXIT: StealthBrowserExit = { code: null, signal: null };

/**
 * The browser-level CDP of the user's own Chrome over the extension's `channel`, for `createStealthBrowser`. The
 * extension's `chrome.debugger` reaches only tabs, so `Target.*` and `Browser.*` without a session are emulated here,
 * with the events real Chrome sends in the same order; any other method without a session gets a CDP error.
 *
 * A session is a virtual `sessionId` on the tab's one attachment, and a tab has at most one: a second
 * `Target.attachToTarget` is refused while it lives. It ends the moment its `Target.detachFromTarget` arrives; the tab
 * is then detached and attached again, which clears whatever the session left (domains, `Fetch`, scripts, bindings,
 * auto-attach, paused children), and an attach meanwhile waits for that. A tab flaneur creates, or a popup of one, is
 * attached as it appears and stays so with focus emulation, which keeps it visible and unthrottled in a covered window;
 * any other tab is attached only while a session lives. Closing detaches everything and closes no tab.
 *
 * Resolves once the extension has answered the greeting with the same protocol version; rejects, closing the channel,
 * otherwise.
 */
export async function createOwnChromeConnection(
    channel: OwnChromeChannel,
    logger: Logger,
): Promise<StealthBrowserConnection> {
    const listeners = new Set<(frame: string) => void>();
    const pending = new Map<number, PendingRequest>();
    const tabs = new Map<string, OwnTab>();
    /** Every session by id: the tab's own, and each child under it. */
    const sessions = new Map<string, OwnTab>();
    const greeting = Promise.withResolvers<OwnChromeHelloReply>();
    const ended = Promise.withResolvers<StealthBrowserExit>();
    let hello: OwnChromeHelloReply | undefined;
    let lastRequestId = 0;
    let lastSessionId = 0;
    let discovering = false;
    let closing = false;
    let running = true;

    channel.onMessage(handleMessage);
    void channel.closed.then(onChannelClosed);

    channel.send({ type: 'hello', version: OWN_CHROME_PROTOCOL_VERSION });
    try {
        hello = checkVersion(await greeting.promise);
        const listed = await request({ type: 'tabs.list' });
        const list: readonly unknown[] = isPlainObject(listed) && Array.isArray(listed['tabs']) ? listed['tabs'] : [];
        for (const item of list) {
            const tab = readOwnChromeTab(item);
            if (tab) {
                addTab(tab);
            }
        }
    } catch (error) {
        closing = true;
        channel.close();
        throw error;
    }
    logger.info('Connected to the extension', { version: hello.version, tabCount: tabs.size });

    return {
        send,
        onFrame: listener => listeners.add(listener),
        closed: ended.promise,
        close,
    };

    function send(command: StealthBrowserCommand) {
        void execute(command);
    }

    async function close() {
        if (closing || !running) {
            await ended.promise;
            return;
        }
        closing = true;
        // After a reset in flight, which would attach the tab again.
        await Promise.allSettled([...tabs.values()].map(tab => enqueue(tab, () => detachTab(tab))));
        channel.close();
        finish();
        await ended.promise;
    }

    async function execute(command: StealthBrowserCommand) {
        try {
            if (!running || closing) {
                throw new Error('The connection to the extension is closed');
            }
            const result =
                command.sessionId == null ? await runBrowserCommand(command) : await runSessionCommand(command);
            emit({ id: command.id, result });
        } catch (error) {
            if (error instanceof CdpError) {
                emit({ id: command.id, error: { code: error.code, message: error.message, data: error.data } });
            } else {
                const message = error instanceof Error ? error.message : 'The command failed';
                emit({ id: command.id, error: { code: SERVER_ERROR, message } });
            }
        }
    }

    function runBrowserCommand(command: StealthBrowserCommand) {
        const params: Record<string, unknown> = isPlainObject(command.params) ? command.params : {};
        switch (command.method) {
            case 'Target.setDiscoverTargets':
                return setDiscoverTargets(params['discover'] === true);
            case 'Target.getTargets':
                return { targetInfos: [...tabs.values()].map(toTargetInfo) };
            case 'Target.getTargetInfo':
                return { targetInfo: toTargetInfo(findTab(params['targetId'])) };
            case 'Target.createTarget':
                return createTarget(params['url']);
            case 'Target.closeTarget':
                return closeTarget(findTab(params['targetId']));
            case 'Target.attachToTarget':
                return attachToTarget(params);
            case 'Target.detachFromTarget':
                return detachFromTarget(params['sessionId']);
            case 'Target.activateTarget':
                return activate(findTab(params['targetId']));
            case 'Browser.getVersion':
                return getVersion();
            case 'Browser.close':
                // Answered first: the reply would not get out once the connection is closed.
                void close();
                return {};
            default:
                throw new CdpError({
                    code: METHOD_NOT_FOUND,
                    message: `${command.method} is not supported with --chrome own`,
                });
        }
    }

    async function runSessionCommand(command: StealthBrowserCommand) {
        const sessionId = command.sessionId;
        const tab = sessionId == null ? undefined : sessions.get(sessionId);
        if (sessionId == null || tab == null) {
            throw new CdpError({ code: INVALID_PARAMS, message: 'Session with given id not found' });
        }
        const { targetId } = tab.info;
        const isTabSession = tab.session?.sessionId === sessionId;
        if (isTabSession && command.method === 'Page.bringToFront') {
            return activate(tab);
        }
        const body: OwnChromeRequestBody = isTabSession
            ? { type: 'debugger.send', targetId, method: command.method, params: command.params }
            : { type: 'debugger.send', targetId, sessionId, method: command.method, params: command.params };
        return request(body);
    }

    function setDiscoverTargets(discover: boolean) {
        // Real Chrome announces every existing target when discovery starts, before its reply.
        if (discover && !discovering) {
            for (const tab of tabs.values()) {
                emit({ method: 'Target.targetCreated', params: { targetInfo: toTargetInfo(tab) } });
            }
        }
        discovering = discover;
        return {};
    }

    async function createTarget(url: unknown) {
        const created = await request(
            typeof url === 'string' && url !== '' ? { type: 'tabs.create', url } : { type: 'tabs.create' },
        );
        const info = readOwnChromeTab(isPlainObject(created) ? created['tab'] : undefined);
        if (!info) {
            throw new Error('The extension created a tab but did not describe it');
        }
        // Its `tab.created` may have come first, before flaneur knew the tab is its own.
        const tab = tabs.get(info.targetId) ?? addTab(info);
        makeAgentTab(tab);
        // A failed attach is the next session's to retry; the tab exists all the same.
        await tab.queue;
        return { targetId: info.targetId };
    }

    async function closeTarget(tab: OwnTab) {
        await request({ type: 'tabs.close', targetId: tab.info.targetId });
        return { success: true };
    }

    async function activate(tab: OwnTab) {
        await request({ type: 'tabs.activate', targetId: tab.info.targetId });
        return {};
    }

    async function attachToTarget(params: Record<string, unknown>) {
        const tab = findTab(params['targetId']);
        if (params['flatten'] !== true) {
            throw new CdpError({ code: INVALID_PARAMS, message: 'Only flat sessions are supported with --chrome own' });
        }
        if (tab.session) {
            throw new CdpError({
                code: SERVER_ERROR,
                message: `Target ${tab.info.targetId} is driven by another client; one session per page`,
            });
        }
        // Reserved at once, so a second attach meanwhile is refused; it waits behind a reset in flight.
        const session: TabSession = {
            sessionId: `own-session-${++lastSessionId}`,
            announced: false,
            children: new Set(),
        };
        tab.session = session;
        sessions.set(session.sessionId, tab);
        try {
            await enqueue(tab, () => attachTab(tab));
        } catch (error) {
            if (tab.session === session) {
                endSession(tab);
            }
            throw error;
        }
        if (tab.session !== session) {
            throw new CdpError({ code: SERVER_ERROR, message: `Target ${tab.info.targetId} went away` });
        }
        session.announced = true;
        // Before the reply, as in real Chrome: the core's registry claims the session on this event.
        emit({
            method: 'Target.attachedToTarget',
            params: { sessionId: session.sessionId, targetInfo: toTargetInfo(tab), waitingForDebugger: false },
        });
        return { sessionId: session.sessionId };
    }

    function detachFromTarget(sessionId: unknown) {
        const tab = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
        if (tab == null || tab.session?.sessionId !== sessionId) {
            throw new CdpError({ code: INVALID_PARAMS, message: 'No session with given id' });
        }
        // Released at once, so the next attach is not refused; it waits for the reset instead.
        endSession(tab);
        enqueue(tab, () => resetTab(tab)).catch((error: unknown) => {
            logger.debug('A tab could not be reset', { error, targetId: tab.info.targetId });
        });
        return {};
    }

    function getVersion() {
        const userAgent = hello?.userAgent ?? '';
        return {
            protocolVersion: '1.3',
            product: /Chrome\/[\d.]+/.exec(userAgent)?.[0] ?? 'Chrome',
            revision: '',
            userAgent,
            jsVersion: '',
        };
    }

    function handleMessage(value: unknown) {
        const message = readOwnChromeMessage(value);
        if (!message) {
            logger.warn('The extension sent a malformed message');
            return;
        }
        // Before the greeting nothing was asked and nothing is in scope.
        if (hello == null && message.type !== 'hello') {
            return;
        }
        dispatch(message);
    }

    function dispatch(message: OwnChromeExtensionMessage) {
        switch (message.type) {
            case 'hello':
                greeting.resolve(message);
                return;
            case 'reply':
                settle(message.id)?.resolve(message.result);
                return;
            case 'error':
                settle(message.id)?.reject(
                    new CdpError({ code: message.code ?? SERVER_ERROR, message: message.message }),
                );
                return;
            case 'tab.created':
                onTabCreated(message.tab);
                return;
            case 'tab.updated':
                onTabUpdated(message.tab);
                return;
            case 'tab.removed':
                onTabRemoved(message.targetId);
                return;
            case 'debugger.event':
                onDebuggerEvent(message.targetId, message.sessionId, message.method, message.params);
                return;
            case 'debugger.detached':
                onDebuggerDetached(message.targetId, message.reason);
                break;
        }
    }

    function onTabCreated(info: OwnChromeTab) {
        if (tabs.has(info.targetId)) {
            return;
        }
        const opener = info.openerId == null ? undefined : tabs.get(info.openerId);
        const tab = addTab(info);
        if (opener?.agent) {
            makeAgentTab(tab);
        }
    }

    function onTabUpdated(info: OwnChromeTab) {
        const tab = tabs.get(info.targetId);
        if (!tab || (tab.info.url === info.url && tab.info.title === info.title)) {
            return;
        }
        tab.info = { ...tab.info, url: info.url, title: info.title };
        if (discovering) {
            emit({ method: 'Target.targetInfoChanged', params: { targetInfo: toTargetInfo(tab) } });
        }
    }

    function onTabRemoved(targetId: string) {
        const tab = tabs.get(targetId);
        if (!tab) {
            return;
        }
        tab.attached = false;
        endSession(tab);
        tabs.delete(targetId);
        if (discovering) {
            emit({ method: 'Target.targetDestroyed', params: { targetId } });
        }
    }

    function onDebuggerDetached(targetId: string, reason: string) {
        const tab = tabs.get(targetId);
        if (!tab) {
            return;
        }
        logger.info('Chrome detached the debugger from a tab', { targetId, reason });
        tab.attached = false;
        endSession(tab);
    }

    /**
     * Passes an event of a tab's attachment to the session on it, under the session's id or its child's, and keeps
     * track of the children. With no session on the tab, it is what a session left behind, or focus emulation's own: dropped.
     */
    function onDebuggerEvent(targetId: string, childId: string | undefined, method: string, params: unknown) {
        const tab = tabs.get(targetId);
        const session = tab?.session;
        if (!tab || !session?.announced || (childId != null && !session.children.has(childId))) {
            return;
        }
        const child = isPlainObject(params) ? params['sessionId'] : undefined;
        if (method === 'Target.attachedToTarget' && typeof child === 'string') {
            session.children.add(child);
            sessions.set(child, tab);
        }
        emit({ method, params, sessionId: childId ?? session.sessionId });
        if (method === 'Target.detachedFromTarget' && typeof child === 'string') {
            session.children.delete(child);
            sessions.delete(child);
        }
    }

    function addTab(info: OwnChromeTab) {
        const tab: OwnTab = { info, agent: false, attached: false, queue: Promise.resolve() };
        tabs.set(info.targetId, tab);
        if (discovering) {
            emit({ method: 'Target.targetCreated', params: { targetInfo: toTargetInfo(tab) } });
        }
        return tab;
    }

    /** Attaches an agent tab for good: from now until the connection ends, with focus emulation. */
    function makeAgentTab(tab: OwnTab) {
        tab.agent = true;
        if (closing) {
            return;
        }
        enqueue(tab, () => attachTab(tab)).catch((error: unknown) => {
            logger.warn('A new tab could not be attached', { error, targetId: tab.info.targetId });
        });
    }

    /**
     * Ends the tab's session: its children's `Target.detachedFromTarget` on it, then its own. A session not yet
     * announced ends quietly; its attach fails.
     */
    function endSession(tab: OwnTab) {
        const session = tab.session;
        if (!session) {
            return;
        }
        tab.session = undefined;
        sessions.delete(session.sessionId);
        for (const child of session.children) {
            sessions.delete(child);
            emit({
                method: 'Target.detachedFromTarget',
                params: { sessionId: child },
                sessionId: session.sessionId,
            });
        }
        if (session.announced) {
            emit({
                method: 'Target.detachedFromTarget',
                params: { sessionId: session.sessionId, targetId: tab.info.targetId },
            });
        }
    }

    async function attachTab(tab: OwnTab) {
        if (tab.attached) {
            return;
        }
        await request({ type: 'debugger.attach', targetId: tab.info.targetId });
        tab.attached = true;
        if (tab.agent) {
            await request({
                type: 'debugger.send',
                targetId: tab.info.targetId,
                method: 'Emulation.setFocusEmulationEnabled',
                params: { enabled: true },
            });
        }
    }

    async function detachTab(tab: OwnTab) {
        if (!tab.attached) {
            return;
        }
        tab.attached = false;
        await request({ type: 'debugger.detach', targetId: tab.info.targetId });
    }

    /** Clears what a session left on the tab: an agent tab is attached afresh, any other left detached. */
    async function resetTab(tab: OwnTab) {
        await detachTab(tab);
        if (tab.agent && !closing) {
            await attachTab(tab);
        }
    }

    /** Runs `step` after the tab's earlier steps; its failure is the caller's, and does not stop later steps. */
    function enqueue(tab: OwnTab, step: () => Promise<void>) {
        const run = tab.queue.then(step);
        tab.queue = run.catch(() => {});
        return run;
    }

    function findTab(targetId: unknown) {
        const tab = typeof targetId === 'string' ? tabs.get(targetId) : undefined;
        if (!tab) {
            throw new CdpError({ code: INVALID_PARAMS, message: 'No target with given id found' });
        }
        return tab;
    }

    function toTargetInfo(tab: OwnTab) {
        const { targetId, url, title, openerId } = tab.info;
        return {
            targetId,
            type: 'page',
            title,
            url,
            attached: tab.session?.announced === true,
            canAccessOpener: false,
            ...(openerId == null ? {} : { openerId }),
        };
    }

    function request(body: OwnChromeRequestBody) {
        const id = ++lastRequestId;
        return new Promise<unknown>((resolve, reject) => {
            if (!running) {
                reject(new Error('The extension disconnected'));
                return;
            }
            pending.set(id, { resolve, reject });
            channel.send({ ...body, id });
        });
    }

    function settle(id: number) {
        const waiting = pending.get(id);
        pending.delete(id);
        return waiting;
    }

    function emit(message: object) {
        const frame = JSON.stringify(message);
        for (const listener of listeners) {
            listener(frame);
        }
    }

    function onChannelClosed() {
        if (!running) {
            return;
        }
        if (!closing) {
            logger.warn('The extension disconnected');
        }
        greeting.reject(new Error('The extension closed the connection before greeting flaneur'));
        finish();
    }

    function finish() {
        running = false;
        for (const waiting of pending.values()) {
            waiting.reject(new Error('The extension disconnected'));
        }
        pending.clear();
        ended.resolve(NO_EXIT);
    }
}

/** The extension's greeting, when it speaks this flaneur's protocol version; otherwise what to update. */
function checkVersion(reply: OwnChromeHelloReply) {
    if (reply.version === OWN_CHROME_PROTOCOL_VERSION) {
        return reply;
    }
    const update =
        reply.version < OWN_CHROME_PROTOCOL_VERSION
            ? 'update the flaneur extension in Chrome (chrome://extensions)'
            : 'update flaneur (npm install flaneur@latest)';
    throw new Error(
        `The flaneur extension speaks protocol version ${reply.version}, this flaneur speaks version ` +
            `${OWN_CHROME_PROTOCOL_VERSION}: ${update}`,
    );
}
