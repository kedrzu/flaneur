import type { Locator } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

/**
 * Opens a link's target in the same tab, with the current page as the referrer, as following the link does. For links
 * a click does not follow: a listing that opens items in a new tab, or one whose click handler swallows the navigation.
 * @util
 */
export async function openLink(link: Locator) {
    const page = link.page();
    const href = await link.getAttribute('href');
    assert(href, 'the link has no href');
    // A heavy page may never fire `load`; the journey's next assertion waits for what it needs.
    await page.goto(new URL(href, page.url()).href, { referer: page.url(), waitUntil: 'domcontentloaded' });
}
