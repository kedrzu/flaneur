import type { Page } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

/** Two products opened from one listing, as a person compares them. */
export interface ProductLinks {
    /** Clicks the listing's first product link and remembers where it leads. */
    openFirst(): Promise<void>;
    /** Clicks the first product link leading elsewhere than the first: a card often links its product twice. */
    openAnother(): Promise<void>;
}

/**
 * Opens two different products from a listing whose product links `selector` matches.
 * @util
 */
export function openProducts(page: Page, selector: string): ProductLinks {
    let firstHref: string | null = null;

    return { openFirst, openAnother };

    async function openFirst() {
        const link = page.locator(selector).first();
        firstHref = await link.getAttribute('href');
        await link.click();
    }

    async function openAnother() {
        assert(firstHref != null, 'openAnother() before openFirst()');
        await page
            .locator(`${selector}:not([href=${JSON.stringify(firstHref)}])`)
            .first()
            .click();
    }
}
