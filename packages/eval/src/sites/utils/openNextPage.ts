import { setTimeout as sleep } from 'node:timers/promises';

import type { Locator } from 'playwright/test';

import { clickToUrl } from './clickToUrl.js';

/** How far one turn of the wheel scrolls toward the paging, in CSS pixels. */
const WHEEL_STEP_PX = 400;

/** The most turns of the wheel the way down to the paging takes: a long listing is about 15 screens. */
const MAX_WHEEL_TURNS = 40;

/** The pause after a turn, while the rows it brought into view load. */
const TURN_PAUSE_MS = 400;

/** How long the paging must hold its place before the click: the listing's lazy rows and ads have loaded. */
const SETTLED_MS = 1000;

/**
 * Opens the listing's next page as a person does: the wheel down to the paging, a look until the rows above stop
 * loading and moving it, then the click (`clickToUrl`: a second one when the URL has not changed). Clicked at once
 * from the top of a listing still loading, OTTO's paging click landed on an advertised product and Walmart's changed
 * nothing.
 * @param control The paging's link or button to the next page.
 * @param url What the next page's URL matches.
 * @util
 */
export async function openNextPage(control: Locator, url: RegExp) {
    await wheelTo(control);
    await clickToUrl(control, url);
}

/** Turns the wheel until `control` is in the middle part of the viewport and has held its place for `SETTLED_MS`. */
async function wheelTo(control: Locator) {
    const page = control.page();
    const viewport = page.viewportSize() ?? { width: 1200, height: 800 };
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await control.waitFor();
    let last: number | null = null;
    for (let turn = 0; turn < MAX_WHEEL_TURNS; turn++) {
        const box = await control.boundingBox();
        if (box == null) {
            await sleep(TURN_PAUSE_MS);
            continue;
        }
        const middle = box.y + box.height / 2;
        if (middle < viewport.height * 0.25 || middle > viewport.height * 0.75) {
            const distance = middle - viewport.height / 2;
            await page.mouse.wheel(0, Math.sign(distance) * Math.min(Math.abs(distance), WHEEL_STEP_PX));
            await sleep(TURN_PAUSE_MS);
            last = null;
            continue;
        }
        if (last != null && Math.abs(last - middle) < 1) {
            return;
        }
        last = middle;
        await sleep(SETTLED_MS);
    }
}
