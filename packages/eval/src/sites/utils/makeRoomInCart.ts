import { expect } from 'playwright/test';
import type { Locator } from 'playwright/test';

import { emptyCart } from './emptyCart.js';

/** Options of `makeRoomInCart`. */
export interface MakeRoomInCartOptions {
    /** The header's link to the cart. */
    cartLink: Locator;
    /** The address of the cart's page. */
    cartUrl: RegExp;
    /** The address of the product page the journey comes back to. */
    productUrl: RegExp;
}

/** The most Back presses that lead from the emptied cart to the product: some carts add an entry per removal. */
const MAX_BACKS = 8;

/**
 * Empties a cart that is full from earlier runs and comes back to the product, as a person whose add was refused
 * looks in the cart, takes the items out and goes back. `emptyCart` at a journey's end keeps the cart from filling,
 * but one an earlier run left full (or a run that failed before emptying it) would refuse the add.
 * @util
 */
export async function makeRoomInCart({ cartLink, cartUrl, productUrl }: MakeRoomInCartOptions) {
    const page = cartLink.page();
    await cartLink.click();
    await expect(page).toHaveURL(cartUrl);
    await emptyCart(page);
    for (let back = 0; back < MAX_BACKS && !productUrl.test(page.url()); back++) {
        // A removal may still be reloading the cart, which a Back would abort.
        await page.waitForLoadState();
        await page.goBack();
    }
    await expect(page).toHaveURL(productUrl);
}
