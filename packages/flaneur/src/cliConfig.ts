import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/** What `flaneur setup` stores in `<dataDir>/config.json`: browsers that detection misses. */
export interface CliConfig {
    /** User data folders of browsers (macOS, Linux). */
    browserDataDirs: string[];
    /** Registry keys the native messaging host is registered under (Windows). */
    registryKeys: string[];
}

/** The only keys flaneur writes to: a native messaging hosts key of the current user's own software. */
const REGISTRY_KEY_PATTERN = /^HKCU\\Software(\\[^\\]+)+\\NativeMessagingHosts$/i;

/** The config's file in `dataDir`. */
export function getCliConfigPath(dataDir: string) {
    return path.join(dataDir, 'config.json');
}

/**
 * The config in `dataDir`; empty lists when there is no file. Throws, naming the file, when it is not JSON, has the
 * wrong shape or holds a registry key flaneur would not write to.
 */
export async function readCliConfig(dataDir: string): Promise<CliConfig> {
    const file = getCliConfigPath(dataDir);
    let content: string;
    try {
        content = await readFile(file, 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { browserDataDirs: [], registryKeys: [] };
        }
        throw new Error(`Cannot read the config ${file}`, { cause: error });
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (error) {
        throw new Error(`The config ${file} is not valid JSON: fix it or delete it`, { cause: error });
    }
    const browserDataDirs = isPlainObject(parsed) ? parsed['browserDataDirs'] : undefined;
    const registryKeys = isPlainObject(parsed) ? parsed['registryKeys'] : undefined;
    if (!isStringArray(browserDataDirs) || !isStringArray(registryKeys)) {
        throw new Error(
            `The config ${file} must be {"browserDataDirs": string[], "registryKeys": string[]}: fix it or delete it`,
        );
    }
    for (const key of registryKeys) {
        if (!isNativeMessagingHostsKey(key)) {
            throw new Error(`The config ${file} holds a registry key flaneur does not write to: ${key}`);
        }
    }
    return { browserDataDirs, registryKeys };
}

/** Replaces the config in `dataDir`. */
export async function writeCliConfig(dataDir: string, config: CliConfig) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(getCliConfigPath(dataDir), `${JSON.stringify(config, null, 4)}\n`);
}

/** Whether `key` is `HKCU\Software\…\NativeMessagingHosts`, the only place the host may be registered. */
export function isNativeMessagingHostsKey(key: string) {
    return REGISTRY_KEY_PATTERN.test(key);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}
