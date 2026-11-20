import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBrowsersRoot } from './getBrowsersRoot.js';
import { getChromeUserDataDir } from './getChromeUserDataDir.js';

/** Where to look for browsers; `dataDir` is flaneur's own, whose profile must not be mistaken for a browser. */
export interface FindNativeHostTargetsParams {
    dataDir: string;
    platform?: NodeJS.Platform;
    homeDir?: string;
    /** Linux: where applications keep their configuration; `$XDG_CONFIG_HOME` by default, else `~/.config`. */
    configHome?: string;
    /** Windows: `%LOCALAPPDATA%`. */
    localAppData?: string;
}

/** The places that take a native messaging host: user data folders (macOS, Linux) or registry keys (Windows). */
export interface NativeHostTargets {
    browserDataDirs: string[];
    registryKeys: string[];
}

const GOOGLE_CHROME_KEY = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts';
const CHROMIUM_KEY = 'HKCU\\Software\\Chromium\\NativeMessagingHosts';
const WINDOWS_USER_DATA = 'User Data';

/**
 * Finds the Chromium browsers installed for this user, without a catalogue of them: a folder two levels below the
 * platform's application data root that holds `Local State` and `Default/Extensions` is a browser's user data folder
 * (an Electron app has the first but not the second). Google Chrome is always in the result, even before it has a
 * profile, and on Windows Chromium too. Nothing inside `dataDir` is returned: flaneur's launched profile looks like a
 * browser's.
 *
 * macOS and Linux use the folders, Windows the registry keys derived from `%LOCALAPPDATA%\<Vendor>\<Product>\User Data`
 * and `%LOCALAPPDATA%\<Product>\User Data`.
 */
export async function findNativeHostTargets(params: FindNativeHostTargetsParams): Promise<NativeHostTargets> {
    if ((params.platform ?? process.platform) === 'win32') {
        const localAppData =
            params.localAppData ??
            process.env['LOCALAPPDATA'] ??
            path.join(params.homeDir ?? os.homedir(), 'AppData', 'Local');
        const found = await findBrowserDataDirs(localAppData, params.dataDir, WINDOWS_USER_DATA);
        const derived = found.map(dir => deriveRegistryKey(localAppData, dir));
        return {
            browserDataDirs: [],
            registryKeys: unique([GOOGLE_CHROME_KEY, CHROMIUM_KEY, ...derived], key => key.toLowerCase()),
        };
    }
    const found = await findBrowserDataDirs(getBrowsersRoot(params), params.dataDir);
    return {
        browserDataDirs: unique([path.resolve(getChromeUserDataDir(params)), ...found], dir => dir),
        registryKeys: [],
    };
}

/** The browsers' user data folders one or two levels below `root` (in their `subfolder`, when given). */
async function findBrowserDataDirs(root: string, dataDir: string, subfolder = '') {
    const levelOne = await listDirectories(root);
    const levelTwo = (await Promise.all(levelOne.map(listDirectories))).flat();
    const found: string[] = [];
    for (const parent of [...levelOne, ...levelTwo]) {
        const dir = path.resolve(parent, subfolder);
        if (!isInside(dir, dataDir) && (await isBrowserDataDir(dir))) {
            found.push(dir);
        }
    }
    return found;
}

/** Subfolders of `dir`; none when it cannot be read: macOS keeps some folders from programs without consent. */
async function listDirectories(dir: string) {
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter(entry => entry.isDirectory()).map(entry => path.join(dir, entry.name));
    } catch {
        return [];
    }
}

async function isBrowserDataDir(dir: string) {
    const [localState, extensions] = await Promise.all([
        stat(path.join(dir, 'Local State')).then(
            info => info.isFile(),
            () => false,
        ),
        stat(path.join(dir, 'Default', 'Extensions')).then(
            info => info.isDirectory(),
            () => false,
        ),
    ]);
    return localState && extensions;
}

/** `HKCU\Software\<Vendor>\<Product>\NativeMessagingHosts` for `<root>\<Vendor>\<Product>\User Data`; Vivaldi has no vendor. */
function deriveRegistryKey(root: string, userDataDir: string) {
    const names = path.relative(path.resolve(root), path.dirname(userDataDir)).split(path.sep);
    return `HKCU\\Software\\${names.join('\\')}\\NativeMessagingHosts`;
}

function isInside(target: string, folder: string) {
    const relative = path.relative(path.resolve(folder), path.resolve(target));
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function unique(values: string[], keyOf: (value: string) => string) {
    return [...new Map(values.map(value => [keyOf(value), value] as const)).values()];
}
