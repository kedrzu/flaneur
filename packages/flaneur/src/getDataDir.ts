import os from 'node:os';
import path from 'node:path';

/** The folder the CLI keeps its profile, config and Chrome for Testing in. */
const DATA_FOLDER = 'flaneur';

/** This computer's per-user app data folder for the CLI. */
export function getDataDir() {
    switch (process.platform) {
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', DATA_FOLDER);
        case 'win32':
            return path.join(process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), DATA_FOLDER);
        default:
            return path.join(process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share'), DATA_FOLDER);
    }
}
