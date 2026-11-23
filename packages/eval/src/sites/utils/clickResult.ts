import { setTimeout as sleep } from 'node:timers/promises';

import { expect } from 'playwright/test';
import type { Locator } from 'playwright/test';

/** Options of `clickResult`. */
export interface ClickResultOptions {
    /** Where in the target to click, from its top-left corner; its centre by default. */
    position?: { x: number; y: number };
    /**
     * The backdrop of a menu that stays open whatever the pointer does once its way opened it (nike.com's header menu,
     * vinted.pl's catalog, chewy.com's "Not in the U.S.?": a backdrop that belongs to the header and covers the page):
     * clicked when it shows once the pointer rests, as a person clicks beside an open menu to close it.
     */
    menuBackdrop?: Locator;
}

/** How far above the view's bottom edge the pointer pauses under the result. */
const BOTTOM_MARGIN_PX = 40;

/** How long a hover menu the pointer passed through takes to close once the pointer left it. */
const MENU_CLOSE_MS = 1000;

/**
 * Clicks a result of a search, coming to it from below. After a search the pointer rests in the header, and a path
 * straight from there to a result crosses the header's items, whose hover opens a menu or a popover over the results
 * (lowes.com's department flyout, nike.com's menu, chewy.com's "Not in the U.S.?"); Playwright's click then waits on
 * the cover until it times out. A person moves on into the page instead: the pointer goes down to the bottom of the
 * view under the result, where it hovers nothing of the header, rests while a menu it passed through closes, and goes
 * up to the result.
 * @util
 */
export async function clickResult(target: Locator, options: ClickResultOptions = {}) {
    const page = target.page();
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    if (box != null && viewport != null) {
        const x = Math.min(Math.max(box.x + box.width / 2, 0), viewport.width - 1);
        await page.mouse.move(x, viewport.height - BOTTOM_MARGIN_PX);
        await sleep(MENU_CLOSE_MS);
    }
    if (options.menuBackdrop != null && (await options.menuBackdrop.isVisible())) {
        await options.menuBackdrop.click();
        await expect(options.menuBackdrop).toBeHidden();
    }
    await target.click({ position: options.position });
}
