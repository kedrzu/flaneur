import { readCliConfig } from './cliConfig.js';
import { findNativeHostTargets } from './findNativeHostTargets.js';
import type { FindNativeHostTargetsParams, NativeHostTargets } from './findNativeHostTargets.js';

/**
 * Where the CLI registers the native messaging host: the browsers found on disk plus the ones `flaneur setup` stored in
 * the config, without duplicates. Throws when the config is broken.
 */
export async function getCliNativeHostTargets(params: FindNativeHostTargetsParams): Promise<NativeHostTargets> {
    const [found, config] = await Promise.all([findNativeHostTargets(params), readCliConfig(params.dataDir)]);
    return {
        browserDataDirs: unique([...found.browserDataDirs, ...config.browserDataDirs], dir => dir),
        registryKeys: unique([...found.registryKeys, ...config.registryKeys], key => key.toLowerCase()),
    };
}

/** `values` without repeats, the first spelling of each kept. */
function unique(values: string[], keyOf: (value: string) => string) {
    const seen = new Set<string>();
    return values.filter(value => {
        const key = keyOf(value);
        return !seen.has(key) && seen.add(key);
    });
}
