import { expect, test } from 'bun:test';

import { readFlaneurMessage } from './readFlaneurMessage.js';
import type { CheckedDebuggerSend } from './readFlaneurMessage.js';

test('reads the operations of the protocol', () => {
    const send: CheckedDebuggerSend = {
        type: 'debugger.send',
        id: 3,
        targetId: 'T1',
        sessionId: 'S1',
        method: 'Runtime.evaluate',
        params: { expression: '1' },
    };
    expect(readFlaneurMessage({ ...send, extra: true })).toEqual(send);
    expect(readFlaneurMessage({ type: 'debugger.send', id: 4, targetId: 'T1', method: 'Page.enable' })).toEqual({
        type: 'debugger.send',
        id: 4,
        targetId: 'T1',
        method: 'Page.enable',
        params: {},
    });
    expect(readFlaneurMessage({ type: 'tabs.create', id: 1 })).toEqual({ type: 'tabs.create', id: 1 });
});

test('refuses anything else the native host sends', () => {
    const refused: unknown[] = [
        // Not operations: nothing but the options page changes the settings.
        { type: 'settings.set', id: 1, allowAgents: true },
        { type: 'scripting.executeScript', id: 1, targetId: 'T1' },
        // Operations with missing or wrong fields.
        { type: 'tabs.list' },
        { type: 'tabs.close', id: 1 },
        { type: 'tabs.create', id: 1, url: 42 },
        { type: 'debugger.attach', id: '1', targetId: 'T1' },
        { type: 'debugger.send', id: 1, targetId: 'T1', method: 'Page.enable', params: ['x'] },
        { type: 'debugger.send', id: 1, targetId: 'T1', method: 'Page.enable', sessionId: 7 },
        { type: 'hello', version: '1' },
        'hello',
        null,
    ];
    for (const value of refused) {
        expect(readFlaneurMessage(value)).toBeNull();
    }
});
