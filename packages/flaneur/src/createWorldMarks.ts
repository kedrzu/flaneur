import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import type { IsolatedWorlds } from './createIsolatedWorlds.js';
import { WORLD_MARKS_KEY } from './createIsolatedWorlds.js';

/**
 * The data attributes a client's code set in the proxy's isolated world, as the client reads them over CDP: they
 * never reach the page's DOM (`WORLD_PRELUDE`), so the DOM domain's own answers would not have them.
 */
export interface WorldMarks {
    /** Answers `DOM.querySelector` or `DOM.querySelectorAll`, the world's marks counted. */
    query(method: string, params: Record<string, unknown>, sessionId: string | undefined): Promise<unknown>;
    /** Answers `DOM.describeNode`, adding the world's marks of a node a marked query returned to its attributes. */
    describeNode(params: Record<string, unknown>, sessionId: string | undefined): Promise<unknown>;
    /** Forgets a detached session. */
    forget(sessionId: string): void;
}

/** A selector that may name a data attribute. */
const DATA_ATTRIBUTE = /\[\s*data-/i;

/** Run on a root node in the world: the nodes under it matching the selector, marks counted; null with no mark named. */
const QUERY_MARKED = `function (selector) {
    return globalThis[Symbol.for('${WORLD_MARKS_KEY}')]?.query(this, selector) ?? null;
}`;

/** Run on a node in the world: its marks as a flat list of names and values, as `DOM.Node.attributes` lists them. */
const READ_MARKS = `function () {
    return globalThis[Symbol.for('${WORLD_MARKS_KEY}')]?.read(this) ?? [];
}`;

/**
 * Creates the CDP view of the world marks of one client. A selector naming a data attribute is run in the proxy's
 * world of the root's frame, where agent-browser's evaluations set the marks; one that names no mark the world holds
 * goes to the browser unchanged.
 * @__NO_SIDE_EFFECTS__
 */
export function createWorldMarks(
    sendCommand: (method: string, params?: object, sessionId?: string) => Promise<unknown>,
    worlds: Pick<IsolatedWorlds, 'send'>,
): WorldMarks {
    /** The nodes the last marked query of a session returned, by session. */
    const markedNodes = new Map<string, Set<number>>();

    return { query, describeNode, forget: sessionId => markedNodes.delete(sessionId) };

    async function query(method: string, params: Record<string, unknown>, sessionId: string | undefined) {
        const { nodeId, selector } = params;
        if (sessionId == null || typeof nodeId !== 'number' || typeof selector !== 'string') {
            return sendCommand(method, params, sessionId);
        }
        if (!DATA_ATTRIBUTE.test(selector)) {
            return sendCommand(method, params, sessionId);
        }
        const root = await resolve(nodeId, sessionId);
        let found: string | undefined;
        try {
            const reply = await sendCommand(
                'Runtime.callFunctionOn',
                { objectId: root, functionDeclaration: QUERY_MARKED, arguments: [{ value: selector }] },
                sessionId,
            );
            found = readObjectId(reply);
            if (found == null) {
                return await sendCommand(method, params, sessionId);
            }
            const nodeIds = await requestNodes(found, sessionId);
            markedNodes.set(sessionId, new Set(nodeIds));
            return method === 'DOM.querySelector' ? { nodeId: nodeIds[0] ?? 0 } : { nodeIds };
        } finally {
            await release([root, found], sessionId);
        }
    }

    async function describeNode(params: Record<string, unknown>, sessionId: string | undefined) {
        const reply = await sendCommand('DOM.describeNode', params, sessionId);
        const { nodeId } = params;
        if (sessionId == null || typeof nodeId !== 'number' || markedNodes.get(sessionId)?.has(nodeId) !== true) {
            return reply;
        }
        const node = isPlainObject(reply) ? reply['node'] : undefined;
        const attributes = isPlainObject(node) ? node['attributes'] : undefined;
        if (!isPlainObject(reply) || !isPlainObject(node) || !Array.isArray(attributes)) {
            return reply;
        }
        const objectId = await resolve(nodeId, sessionId);
        try {
            const read = await sendCommand(
                'Runtime.callFunctionOn',
                { objectId, functionDeclaration: READ_MARKS, returnByValue: true },
                sessionId,
            );
            const result = isPlainObject(read) ? read['result'] : undefined;
            const marks: unknown = isPlainObject(result) ? result['value'] : undefined;
            if (!Array.isArray(marks) || marks.length === 0) {
                return reply;
            }
            const listed: unknown[] = attributes;
            return { ...reply, node: { ...node, attributes: listed.concat(marks) } };
        } finally {
            await release([objectId], sessionId);
        }
    }

    /** A node's object in the proxy's world of its frame. */
    async function resolve(nodeId: number, sessionId: string) {
        const reply = await worlds.send({
            method: 'DOM.resolveNode',
            params: { nodeId },
            sessionId,
            contextParam: 'executionContextId',
        });
        const objectId = readObjectId(reply);
        if (objectId == null) {
            throw new TypeError('DOM.resolveNode gave no object');
        }
        return objectId;
    }

    /** The DOM nodes of an array of elements, in its order. */
    async function requestNodes(arrayId: string, sessionId: string) {
        const reply = await sendCommand('Runtime.getProperties', { objectId: arrayId, ownProperties: true }, sessionId);
        const properties = isPlainObject(reply) ? reply['result'] : undefined;
        const indexed: [number, string][] = [];
        for (const property of Array.isArray(properties) ? properties : []) {
            const name = isPlainObject(property) ? property['name'] : undefined;
            const objectId = isPlainObject(property) ? readObjectId({ result: property['value'] }) : undefined;
            if (typeof name === 'string' && /^\d+$/.test(name) && objectId != null) {
                indexed.push([Number(name), objectId]);
            }
        }
        const elements = indexed.toSorted(([a], [b]) => a - b).map(([, objectId]) => objectId);
        const nodeIds: number[] = [];
        try {
            for (const objectId of elements) {
                const requested = await sendCommand('DOM.requestNode', { objectId }, sessionId);
                const nodeId = isPlainObject(requested) ? requested['nodeId'] : undefined;
                if (typeof nodeId === 'number') {
                    nodeIds.push(nodeId);
                }
            }
        } finally {
            await release(elements, sessionId);
        }
        return nodeIds;
    }

    async function release(objectIds: (string | undefined)[], sessionId: string) {
        for (const objectId of objectIds) {
            if (objectId != null) {
                await sendCommand('Runtime.releaseObject', { objectId }, sessionId);
            }
        }
    }
}

/** The object id of a `Runtime.RemoteObject` reply (`{ result }` or `{ object }`); none for a primitive or null. */
function readObjectId(reply: unknown) {
    if (!isPlainObject(reply)) {
        return undefined;
    }
    const object = reply['result'] ?? reply['object'];
    const objectId = isPlainObject(object) ? object['objectId'] : undefined;
    return typeof objectId === 'string' ? objectId : undefined;
}
