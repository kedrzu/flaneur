import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';

import { readRememberedBrowser } from './readRememberedBrowser.js';

const dirs: string[] = [];

afterEach(async () => {
    for (const dir of dirs.splice(0)) {
        await rm(dir, { recursive: true, force: true });
    }
});

test('returns an absolute path to an existing file', async () => {
    const { dir, logger, logs } = await setup();
    await writeFile(path.join(dir, 'browser.json'), JSON.stringify({ executable: process.execPath }));

    expect(await readRememberedBrowser(dir, logger)).toBe(process.execPath);
    expect(logs).toEqual([]);
});

test('says nothing when there is no record', async () => {
    const { dir, logger, logs } = await setup();

    expect(await readRememberedBrowser(dir, logger)).toBeUndefined();
    expect(logs).toEqual([]);
});

test('ignores, with a warning, a relative path, a missing file, a folder and a malformed record', async () => {
    const { dir, logger, logs } = await setup();
    const contents = [
        JSON.stringify({ executable: 'chrome' }),
        JSON.stringify({ executable: path.join(dir, 'gone') }),
        JSON.stringify({ executable: dir }),
        JSON.stringify({ executable: 42 }),
        '{not json',
    ];
    for (const content of contents) {
        await writeFile(path.join(dir, 'browser.json'), content);
        expect(await readRememberedBrowser(dir, logger)).toBeUndefined();
    }

    expect(logs.filter(log => log.level === 'warn')).toHaveLength(contents.length);
});

async function setup() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-browser-'));
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    return { dir, ...createTestLogger('test') };
}
