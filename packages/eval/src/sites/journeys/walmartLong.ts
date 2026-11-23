import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { emptyCart } from '../utils/emptyCart.js';
import { openProducts } from '../utils/openProducts.js';
import { readPage } from '../utils/readPage.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.walmart.com/';

/**
 * The long Walmart walk (HUMAN): a search sorted by best sellers, its second page, two products read (back between
 * them), an add from the listing, the guest cart.
 */
export const walmartLong = defineJourney({
    name: 'walmart.com long',
    vendor: 'HUMAN',
    url: URL,
    tags: ['@long'],
    run: async (page, step) => {
        // The results' own card links (`from=/search`), not a colour swatch's, nor a sponsored tile's, which goes
        // through an ad redirect (`/sp/track?…/ip/…`) and once left the page standing for 30 s after the click. The card
        // link spans the card, its swatches over its centre.
        const products = openProducts(page, 'a[href^="/ip/"][href*="from=/search"]', { clickImage: true });

        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Search' }), 'towels');
            await expect(page).toHaveURL(/\/search\?q=towels/);
        });
        await step('sort by best sellers', async () => {
            await page.getByRole('button', { name: /^Sort by/ }).click();
            // The radio is a 1 px input under its label, which takes the click.
            await page.locator('label[for="best_seller"]').click();
            await expect(page).toHaveURL(/[?&]sort=best_seller/);
        });
        await step('open page 2', async () => {
            await page.getByRole('button', { name: 'Next Page' }).click();
            await expect(page).toHaveURL(/[?&]page=2/);
        });
        await step('open a product', async () => {
            await products.openFirst();
            await expect(page).toHaveURL(/\/ip\//);
        });
        await step('read the product', async () => {
            await readPage(page);
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/[?&]page=2/);
        });
        await step('open another product', async () => {
            await products.openAnother();
            await expect(page).toHaveURL(/\/ip\//);
        });
        await step('read the other product', async () => {
            await readPage(page);
        });
        await step('back to the results again', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/[?&]page=2/);
        });
        await step('add to cart', async () => {
            await page
                .getByRole('button', { name: /^Add to cart - / })
                .first()
                .click();
            await expect(page.getByRole('button', { name: /Cart contains [1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: /Cart contains [1-9]/ }).click();
            await expect(page).toHaveURL(/\/cart/);
        });
        // The eval profile keeps its cart from run to run: what the journey added comes out again.
        await step(
            'empty the cart',
            async () => {
                await emptyCart(page);
            },
            { optional: true },
        );
    },
});
