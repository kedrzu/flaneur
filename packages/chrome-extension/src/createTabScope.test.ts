import { expect, test } from 'bun:test';

import { createTabScope } from './createTabScope.js';

test('with scope agent, flaneur sees only the tabs it created and those they opened, for one connection', () => {
    const scope = createTabScope('agent');
    scope.addAgentTab(1);

    expect(scope.includes(createTab({ id: 1, url: 'https://shop.example/' }))).toBe(true);
    expect(scope.includes(createTab({ id: 2, url: 'https://mail.example/' }))).toBe(false);
    // A popup of an agent tab is one, and so is its own popup.
    expect(scope.includes(createTab({ id: 3, openerTabId: 1, url: 'https://pay.example/' }))).toBe(true);
    expect(scope.includes(createTab({ id: 4, openerTabId: 3 }))).toBe(true);
    // A tab the user opened from their own tab stays theirs.
    expect(scope.includes(createTab({ id: 5, openerTabId: 2, url: 'https://shop.example/' }))).toBe(false);

    const next = createTabScope('agent');
    expect(next.includes(createTab({ id: 1, url: 'https://shop.example/' }))).toBe(false);
    expect(next.includes(createTab({ id: 3, openerTabId: 1 }))).toBe(false);
});

test('with scope all, flaneur sees every web tab and none of Chrome or extension pages', () => {
    const scope = createTabScope('all');

    expect(scope.includes(createTab({ id: 1, url: 'https://mail.example/' }))).toBe(true);
    expect(scope.includes(createTab({ id: 2, url: '', pendingUrl: 'http://shop.example/' }))).toBe(true);
    expect(scope.includes(createTab({ id: 3, url: 'about:blank' }))).toBe(true);
    expect(scope.includes(createTab({ id: 4, url: 'chrome://newtab/' }))).toBe(false);
    expect(
        scope.includes(createTab({ id: 5, url: 'chrome-extension://goimhkigkmnddobemofljbnlmlgbikcl/options.html' })),
    ).toBe(false);
    expect(scope.includes(createTab({ id: 6, url: 'devtools://devtools/bundled/inspector.html' }))).toBe(false);
});

function createTab(fields: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
    return {
        index: 0,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: false,
        frozen: false,
        incognito: false,
        selected: false,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
        ...fields,
    };
}
