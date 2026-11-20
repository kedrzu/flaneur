import os from 'node:os';
import path from 'node:path';

/**
 * The user data folder of the Google Chrome installed on this computer, where it keeps its profiles and, on macOS and
 * Linux, reads the user's native messaging hosts from.
 * @__NO_SIDE_EFFECTS__
 */
export function getChromeUserDataDir() {
    const home = os.homedir();
    switch (process.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
        case 'win32':
            return path.join(
                process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'),
                'Google',
                'Chrome',
                'User Data',
            );
        default:
            return path.join(process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config'), 'google-chrome');
    }
}
