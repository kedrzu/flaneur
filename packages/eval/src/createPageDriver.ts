import type { Page } from 'playwright';

import type { EvalDriver } from './StealthEvalTypes.js';

/** Wraps a Playwright page as an `EvalDriver`; the caller owns the browser, so it supplies the version and what `close` does. */
export function createPageDriver(
    page: Page,
    browserVersion: () => Promise<string>,
    close: () => Promise<void>,
): EvalDriver {
    return {
        open: async url => {
            await page.goto(url);
        },
        click: selector => page.click(selector),
        type: (selector, text) => page.fill(selector, text),
        press: key => page.keyboard.press(key),
        select: async (selector, value) => {
            await page.selectOption(selector, value);
        },
        // Playwright fills a date input from an ISO date.
        pickDate: (selector, isoDate) => page.fill(selector, isoDate),
        scrollBy: px => page.mouse.wheel(0, px),
        scrollTo: selector => page.locator(selector).scrollIntoViewIfNeeded(),
        evaluate: expression => page.evaluate(expression),
        cookieNames: async () => (await page.context().cookies(page.url())).map(cookie => cookie.name),
        browserVersion,
        close,
    };
}
