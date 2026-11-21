import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '@nzyme/logging/Logger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/**
 * The browser executable the native host recorded in `browser.json` in `hostDir`, or `undefined` when there is none.
 * Only an absolute path to an existing file counts: anything else is ignored with a warning, as flaneur starts what
 * this returns.
 */
export async function readRememberedBrowser(hostDir: string, logger: Logger) {
    const file = path.join(hostDir, 'browser.json');
    let content: string;
    try {
        content = await readFile(file, 'utf8');
    } catch {
        return undefined;
    }
    let executable: unknown;
    try {
        const parsed: unknown = JSON.parse(content);
        executable = isPlainObject(parsed) ? parsed['executable'] : undefined;
    } catch {
        // Falls through to the warning.
    }
    if (typeof executable === 'string' && path.isAbsolute(executable) && (await isFile(executable))) {
        return executable;
    }
    logger.warn('Ignoring the remembered browser: it is not an absolute path to an existing file', { file });
    return undefined;
}

async function isFile(file: string) {
    return stat(file).then(
        info => info.isFile(),
        () => false,
    );
}
