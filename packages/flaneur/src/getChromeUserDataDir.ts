import path from 'node:path';

import { getBrowsersRoot } from './getBrowsersRoot.js';
import type { BrowsersRootParams } from './getBrowsersRoot.js';

/**
 * The user data folder of the Google Chrome installed on this macOS or Linux computer, where it keeps its profiles and
 * reads the user's native messaging hosts from.
 * @__NO_SIDE_EFFECTS__
 */
export function getChromeUserDataDir(params: BrowsersRootParams = {}) {
    const root = getBrowsersRoot(params);
    return (params.platform ?? process.platform) === 'darwin'
        ? path.join(root, 'Google', 'Chrome')
        : path.join(root, 'google-chrome');
}
