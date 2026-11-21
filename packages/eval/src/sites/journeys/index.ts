import type { Journey } from '../defineJourney.js';
import { airbnb } from './airbnb.js';
import { amazon } from './amazon.js';
import { booking } from './booking.js';
import { chewy } from './chewy.js';
import { decathlon } from './decathlon.js';
import { etsy } from './etsy.js';
import { gamestop } from './gamestop.js';
import { google } from './google.js';
import { ikea } from './ikea.js';
import { kohls } from './kohls.js';
import { morele } from './morele.js';
import { nike } from './nike.js';
import { ocado } from './ocado.js';
import { otto } from './otto.js';
import { realestate } from './realestate.js';
import { redfin } from './redfin.js';
import { sephora } from './sephora.js';
import { skyscanner } from './skyscanner.js';
import { tripadvisor } from './tripadvisor.js';
import { vinted } from './vinted.js';
import { walmart } from './walmart.js';
import { xcite } from './xcite.js';
import { xkom } from './xkom.js';
import { zalando } from './zalando.js';
import { zara } from './zara.js';
import { zillow } from './zillow.js';

/** The journeys `sites.spec.ts` runs, one test each, in this order. */
export const JOURNEYS: readonly Journey[] = [
    decathlon,
    xkom,
    morele,
    ikea,
    vinted,
    tripadvisor,
    etsy,
    airbnb,
    kohls,
    zalando,
    zara,
    sephora,
    walmart,
    zillow,
    gamestop,
    skyscanner,
    realestate,
    nike,
    otto,
    chewy,
    booking,
    redfin,
    ocado,
    xcite,
    amazon,
    google,
];
