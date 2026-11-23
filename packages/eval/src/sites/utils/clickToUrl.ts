import { expect } from 'playwright/test';
import type { Locator } from 'playwright/test';

/** How long a click may take to change the URL before a person clicks again. */
const CLICK_ANSWER_MS = 10_000;

/**
 * Clicks a control that leads to another URL and, when the URL has not changed after a while, clicks it once more, as
 * a person does when a click changed nothing (Walmart's paging), then waits for `url`.
 * @util
 */
export async function clickToUrl(control: Locator, url: RegExp) {
    const page = control.page();
    const before = page.url();
    await control.click();
    const changed = await expect
        .poll(() => page.url(), { timeout: CLICK_ANSWER_MS })
        .not.toBe(before)
        .then(
            () => true,
            () => false,
        );
    if (!changed) {
        await control.click();
    }
    await expect(page).toHaveURL(url);
}
