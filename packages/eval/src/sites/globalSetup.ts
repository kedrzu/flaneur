import path from 'node:path';

import { createHumanInput, createSitePace } from 'flaneur';
import type { FullConfig } from 'playwright/test';

import { SITES_STATE_FOLDER, serveSitesBrowser } from './serveSitesBrowser.js';

/** Another Chrome profile for one run, e.g. a fresh one to tell a profile's reputation from the browser's behaviour. */
const PROFILE_VARIABLE = 'FLANEUR_SITES_PROFILE';
/** `0` drives the run without flaneur's human input, as a client's own input arrives: the A/B of the input layer. */
const HUMAN_INPUT_VARIABLE = 'FLANEUR_SITES_HUMAN_INPUT';

/**
 * The sites eval's global setup: flaneur on the eval's own profile (or the one `FLANEUR_SITES_PROFILE` names), at the
 * pace a person's flaneur keeps and with its human input, as the CLI starts it (`FLANEUR_SITES_HUMAN_INPUT=0`: without).
 */
export default function globalSetup(config: FullConfig) {
    return serveSitesBrowser(config, {
        userDataDir: process.env[PROFILE_VARIABLE] ?? path.join(SITES_STATE_FOLDER, 'profile'),
        pace: createSitePace(),
        ...(process.env[HUMAN_INPUT_VARIABLE] === '0' ? {} : { input: createHumanInput() }),
    });
}
