import type { Journey } from '../defineJourney.js';
import { amazon } from './amazon.js';
import { decathlon } from './decathlon.js';
import { etsy } from './etsy.js';
import { google } from './google.js';
import { kohls } from './kohls.js';
import { realestate } from './realestate.js';
import { tripadvisor } from './tripadvisor.js';
import { vinted } from './vinted.js';
import { walmart } from './walmart.js';
import { zalando } from './zalando.js';
import { zillow } from './zillow.js';

/** The journeys `sites.spec.ts` runs, one test each, in this order. */
export const JOURNEYS: readonly Journey[] = [
    decathlon,
    vinted,
    kohls,
    zalando,
    walmart,
    zillow,
    tripadvisor,
    etsy,
    realestate,
    amazon,
    google,
];
