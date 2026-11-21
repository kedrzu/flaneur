import { setTimeout as sleep } from 'node:timers/promises';

import type { Page } from 'playwright/test';

/** How far one turn of the wheel scrolls, in CSS pixels. */
const WHEEL_STEP_PX = 320;

/** The turns of the wheel a reading takes: down the page, then a little back up. */
const WHEEL_TURNS = [1, 1, 1, 1, -1];

/** The pause between turns: the time a person reads what the turn brought into view. */
const READ_PAUSE_MS = 900;

/**
 * Reads the page as a person does: the pointer over the content, a few turns of the wheel down with a pause after each,
 * and one back up. Scrolls with wheel events, not a script jump.
 * @util
 */
export async function readPage(page: Page) {
    const viewport = page.viewportSize() ?? { width: 1200, height: 800 };
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    for (const turn of WHEEL_TURNS) {
        await page.mouse.wheel(0, turn * WHEEL_STEP_PX);
        await sleep(READ_PAUSE_MS);
    }
}
