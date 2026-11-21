import os from 'node:os';
import path from 'node:path';

/** Where a folder is looked for; each part defaults to this computer's, and tests set them. */
export interface BrowsersRootParams {
    platform?: NodeJS.Platform;
    homeDir?: string;
    /** Linux: where applications keep their configuration; `$XDG_CONFIG_HOME` by default, else `~/.config`. */
    configHome?: string;
}

/**
 * The folder under which the Chromium browsers of macOS or Linux keep their user data folders: Application Support, or
 * the configuration folder.
 * @__NO_SIDE_EFFECTS__
 */
export function getBrowsersRoot(params: BrowsersRootParams = {}) {
    const home = params.homeDir ?? os.homedir();
    if ((params.platform ?? process.platform) === 'darwin') {
        return path.join(home, 'Library', 'Application Support');
    }
    return params.configHome ?? process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');
}
