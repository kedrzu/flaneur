import type { Journey } from '../defineJourney.js';
import { airbnb } from './airbnb.js';
import { amazon } from './amazon.js';
import { asos } from './asos.js';
import { booking } from './booking.js';
import { chewy } from './chewy.js';
import { costco } from './costco.js';
import { decathlon } from './decathlon.js';
import { decathlonLong } from './decathlonLong.js';
import { etsy } from './etsy.js';
import { euro } from './euro.js';
import { fiverr } from './fiverr.js';
import { gamestop } from './gamestop.js';
import { google } from './google.js';
import { googleRepeated } from './googleRepeated.js';
import { hertz } from './hertz.js';
import { hm } from './hm.js';
import { homedepot } from './homedepot.js';
import { ikea } from './ikea.js';
import { kaufland } from './kaufland.js';
import { kohls } from './kohls.js';
import { lego } from './lego.js';
import { leroymerlin } from './leroymerlin.js';
import { lowes } from './lowes.js';
import { morele } from './morele.js';
import { nike } from './nike.js';
import { notino } from './notino.js';
import { ocado } from './ocado.js';
import { otto } from './otto.js';
import { ottoLong } from './ottoLong.js';
import { realestate } from './realestate.js';
import { redfin } from './redfin.js';
import { seatgeek } from './seatgeek.js';
import { sephora } from './sephora.js';
import { skyscanner } from './skyscanner.js';
import { thalia } from './thalia.js';
import { tripadvisor } from './tripadvisor.js';
import { vinted } from './vinted.js';
import { walmart } from './walmart.js';
import { walmartLong } from './walmartLong.js';
import { xcite } from './xcite.js';
import { xkom } from './xkom.js';
import { zalando } from './zalando.js';
import { zalandoLong } from './zalandoLong.js';
import { zara } from './zara.js';
import { zillow } from './zillow.js';

/** The journeys `sites.spec.ts` runs, one test each, in this order. */
export const JOURNEYS: readonly Journey[] = [
    decathlon,
    xkom,
    morele,
    ikea,
    notino,
    lego,
    kaufland,
    thalia,
    vinted,
    tripadvisor,
    etsy,
    airbnb,
    leroymerlin,
    seatgeek,
    kohls,
    zalando,
    zara,
    sephora,
    euro,
    hm,
    asos,
    lowes,
    walmart,
    zillow,
    gamestop,
    skyscanner,
    homedepot,
    fiverr,
    realestate,
    nike,
    otto,
    chewy,
    costco,
    booking,
    redfin,
    ocado,
    xcite,
    hertz,
    amazon,
    google,
    decathlonLong,
    zalandoLong,
    walmartLong,
    ottoLong,
    googleRepeated,
];
