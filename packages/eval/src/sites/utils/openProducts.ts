import type { Locator, Page } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

/** Two products opened from one listing, as a person compares them. */
export interface ProductLinks {
    /** Clicks the listing's first product link and remembers where it leads. */
    openFirst(): Promise<void>;
    /** Clicks the first product link leading elsewhere than the first: a card often links its product twice. */
    openAnother(): Promise<void>;
}

/** How the product links of a listing are clicked. */
export interface OpenProductsOptions {
    /**
     * The link covers the whole card and the card's own controls (colour swatches) sit over its centre: it is clicked
     * where the product's image is, in the card's upper part.
     */
    clickImage?: boolean;
}

/** Where in a card-wide link its image is, as a share of the card's height from the top. */
const IMAGE_AT = 0.25;

/**
 * Opens two different products from a listing whose product links `selector` matches.
 * @util
 */
export function openProducts(page: Page, selector: string, options: OpenProductsOptions = {}): ProductLinks {
    let firstHref: string | null = null;

    return { openFirst, openAnother };

    async function openFirst() {
        const link = page.locator(selector).first();
        firstHref = await link.getAttribute('href');
        await clickLink(link);
    }

    async function openAnother() {
        assert(firstHref != null, 'openAnother() before openFirst()');
        await clickLink(page.locator(`${selector}:not([href=${JSON.stringify(firstHref)}])`).first());
    }

    async function clickLink(link: Locator) {
        if (options.clickImage !== true) {
            await link.click();
            return;
        }
        const box = await link.boundingBox();
        assert(box != null, 'A product link with no box');
        await link.click({ position: { x: box.width / 2, y: box.height * IMAGE_AT } });
    }
}
