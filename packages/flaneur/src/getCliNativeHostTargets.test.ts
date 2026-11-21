import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { writeCliConfig } from './cliConfig.js';
import { getCliNativeHostTargets } from './getCliNativeHostTargets.js';

const dirs: string[] = [];

afterEach(async () => {
    for (const dir of dirs.splice(0)) {
        await rm(dir, { recursive: true, force: true });
    }
});

test('adds the stored folders to the detected ones, once each', async () => {
    const { dataDir, home } = await createFolders();
    const configHome = path.join(home, 'config');
    const detected = path.join(configHome, 'vendor-browser');
    await mkdir(path.join(detected, 'Default', 'Extensions'), { recursive: true });
    await writeFile(path.join(detected, 'Local State'), '{}');
    const portable = path.join(home, 'portable');
    await writeCliConfig(dataDir, { browserDataDirs: [portable, detected], registryKeys: [] });

    const targets = await getCliNativeHostTargets({ dataDir, platform: 'linux', homeDir: home, configHome });

    expect(targets.browserDataDirs).toEqual([path.join(configHome, 'google-chrome'), detected, portable]);
});

test('adds the stored registry keys to the detected ones, once each in any case', async () => {
    const { dataDir, home } = await createFolders();
    await writeCliConfig(dataDir, {
        browserDataDirs: [],
        registryKeys: [
            'HKCU\\Software\\Opera Software\\NativeMessagingHosts',
            'hkcu\\software\\google\\chrome\\nativemessaginghosts',
        ],
    });

    const targets = await getCliNativeHostTargets({
        dataDir,
        platform: 'win32',
        homeDir: home,
        localAppData: path.join(home, 'Local'),
    });

    expect(targets.registryKeys).toEqual([
        'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
        'HKCU\\Software\\Chromium\\NativeMessagingHosts',
        'HKCU\\Software\\Opera Software\\NativeMessagingHosts',
    ]);
});

async function createFolders() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'flaneur-targets-'));
    dirs.push(root);
    const dataDir = path.join(root, 'data');
    const home = path.join(root, 'home');
    await mkdir(dataDir);
    await mkdir(home);
    return { dataDir, home };
}
