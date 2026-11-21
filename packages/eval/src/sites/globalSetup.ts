import path from 'node:path';

import { createSitePace } from 'flaneur';
import type { FullConfig } from 'playwright/test';

import { SITES_STATE_FOLDER, serveSitesBrowser } from './serveSitesBrowser.js';

/** The sites eval's global setup: flaneur on the eval's own profile, at the pace a person's flaneur keeps. */
export default function globalSetup(config: FullConfig) {
    return serveSitesBrowser(config, {
        userDataDir: path.join(SITES_STATE_FOLDER, 'profile'),
        pace: createSitePace(),
    });
}
