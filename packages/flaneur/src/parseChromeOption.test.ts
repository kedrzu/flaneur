import { expect, test } from 'bun:test';

import { parseChromeOption } from './parseChromeOption.js';
import type { ChromeOption } from './parseChromeOption.js';

test.each<[string | undefined, ChromeOption]>([
    [undefined, { type: 'installed' }],
    ['installed', { type: 'installed' }],
    ['own', { type: 'own' }],
    ['testing', { type: 'testing' }],
    ['testing@150.0.7000.0', { type: 'testing', version: '150.0.7000.0' }],
    ['/opt/chromium/chrome', { type: 'path', path: '/opt/chromium/chrome' }],
    ['./chrome', { type: 'path', path: './chrome' }],
    ['C:\\Chromium\\chrome.exe', { type: 'path', path: 'C:\\Chromium\\chrome.exe' }],
])('reads %p', (value, expected) => {
    expect(parseChromeOption(value)).toEqual(expected);
});

test.each(['chromium', 'testing@', 'Testing'])('refuses %p instead of spawning it', value => {
    expect(() => parseChromeOption(value)).toThrow('--chrome');
});
