import type { AgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { booking } from './booking.js';
import { decathlon } from './decathlon.js';
import { google } from './google.js';
import { kohls } from './kohls.js';
import { leroymerlin } from './leroymerlin.js';
import { otto } from './otto.js';
import { realestate } from './realestate.js';
import { sephora } from './sephora.js';
import { skyscanner } from './skyscanner.js';
import { vinted } from './vinted.js';
import { walmart } from './walmart.js';
import { zara } from './zara.js';
import { zillow } from './zillow.js';

/**
 * The journeys `agentBrowser.spec.ts` runs, one test each, in the order of their Playwright twins: the sites where the
 * headless control was challenged and flaneur with Playwright passes, so a pass is evidence, and the DataDome and
 * AWS WAF sites.
 */
export const AGENT_BROWSER_JOURNEYS: readonly AgentBrowserJourney[] = [
    decathlon,
    vinted,
    leroymerlin,
    kohls,
    zara,
    sephora,
    walmart,
    zillow,
    skyscanner,
    realestate,
    otto,
    booking,
    google,
];
