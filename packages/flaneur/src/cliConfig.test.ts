import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { isNativeMessagingHostsKey, readCliConfig, writeCliConfig } from './cliConfig.js';

const dirs: string[] = [];

afterEach(async () => {
    for (const dir of dirs.splice(0)) {
        await rm(dir, { recursive: true, force: true });
    }
});

test('reads back what it wrote, and empty lists when there is no file', async () => {
    const dataDir = await createDataDir();
    expect(await readCliConfig(dataDir)).toEqual({ browserDataDirs: [], registryKeys: [] });

    const config = {
        browserDataDirs: ['/opt/browser/data'],
        registryKeys: ['HKCU\\Software\\Opera Software\\NativeMessagingHosts'],
    };
    await writeCliConfig(dataDir, config);

    expect(await readCliConfig(dataDir)).toEqual(config);
});

test('names the file when it is broken', async () => {
    const dataDir = await createDataDir();
    const file = path.join(dataDir, 'config.json');
    const broken = [
        '{not json',
        '[]',
        JSON.stringify({ browserDataDirs: [], registryKeys: 'HKCU' }),
        JSON.stringify({ browserDataDirs: [1], registryKeys: [] }),
        JSON.stringify({ browserDataDirs: [] }),
    ];
    for (const content of broken) {
        await writeFile(file, content);
        await expect(readCliConfig(dataDir)).rejects.toThrow(file);
    }
});

test('rejects, naming the file, a registry key outside HKCU Software NativeMessagingHosts', async () => {
    const dataDir = await createDataDir();
    const file = path.join(dataDir, 'config.json');
    for (const key of BAD_KEYS) {
        await writeFile(file, JSON.stringify({ browserDataDirs: [], registryKeys: [key] }));
        await expect(readCliConfig(dataDir)).rejects.toThrow(file);
    }
});

test('accepts a key of the right form in any case', () => {
    expect(isNativeMessagingHostsKey('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts')).toBe(true);
    expect(isNativeMessagingHostsKey('hkcu\\software\\Vivaldi\\nativemessaginghosts')).toBe(true);
});

/** Keys that would write outside the user's native messaging hosts, or not to a hosts key at all. */
const BAD_KEYS = [
    'HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\Software\\NativeMessagingHosts',
    'HKCU\\Software\\\\NativeMessagingHosts',
    'HKCU\\Software\\Google\\NativeMessagingHosts\\Extra',
    'HKCU\\Software\\Google\\NativeMessagingHosts\\..\\Run',
    'HKCU\\Software\\Google\\NativeMessagingHosts\n',
    '',
];

async function createDataDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-config-'));
    dirs.push(dir);
    return dir;
}
