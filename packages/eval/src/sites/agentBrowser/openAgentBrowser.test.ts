import { expect, test } from 'bun:test';

import { parseSnapshot } from './openAgentBrowser.js';
import type { SnapshotElement } from './openAgentBrowser.js';

test('reads the refs, roles, names, link URLs and checked states of a snapshot, skipping lines without a ref', () => {
    const text = [
        '- heading "Selftest shop" [level=1, ref=e3]',
        '- textbox "Imię" [disabled, ref=e21]: Jane [draft]',
        '- link "Say \\"hi\\"" [ref=e14, url=https://example.com/search?q=a, b&sort=1]',
        '- Iframe "reCAPTCHA" [ref=e27]',
        '  - checkbox "Nie jestem robotem" [checked=true, ref=e28]',
        '- button [ref=e4]',
        '- generic',
    ].join('\n');

    const expected: SnapshotElement[] = [
        { ref: '@e3', role: 'heading', name: 'Selftest shop' },
        { ref: '@e21', role: 'textbox', name: 'Imię' },
        { ref: '@e14', role: 'link', name: 'Say "hi"', url: 'https://example.com/search?q=a, b&sort=1' },
        { ref: '@e27', role: 'Iframe', name: 'reCAPTCHA' },
        { ref: '@e28', role: 'checkbox', name: 'Nie jestem robotem', checked: true },
        { ref: '@e4', role: 'button', name: '' },
    ];
    expect(parseSnapshot(text)).toEqual(expected);
});
