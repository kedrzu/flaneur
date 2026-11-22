import { expect } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.nike.com/pl/';

/** Nike behind Akamai and Kasada (whose challenge decides): a search, a product in a size, the guest cart. */
export const nike = defineJourney({
    name: 'nike.com',
    vendor: 'Kasada',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj wszystkie' }).click();
            },
            { optional: true },
        );
        await step(
            'close the welcome back modal',
            async () => {
                await page.getByRole('button', { name: 'Close Modal' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await page.getByRole('button', { name: 'Wyszukaj' }).click();
            await submitSearch(page.getByRole('searchbox', { name: 'Wyszukaj produkty' }), 'air max');
            await expect(page).toHaveURL(/\/pl\/w\?q=/);
        });
        await step('open a product', async () => {
            // The card's overlay link lies under its image, which has a link of its own: a person clicks the image.
            // The header's menu opens over the results on the pointer's way and stays open, Escape or not; its scrim
            // closes it on a click. It still opened again on the click's way in most runs of 2026-11-22: open.
            await clickResult(page.locator('a.product-card__img-link-overlay[href*="/pl/t/"]').first(), {
                menuBackdrop: page.getByTestId('scrim'),
            });
            await expect(page).toHaveURL(/\/pl\/t\//);
        });
        await step('choose a size', async () => {
            // The search leaves the header's menu open over the page.
            await page.keyboard.press('Escape');
            await page.mouse.move(400, 600);
            // The radio is hidden under its label, which takes the click.
            const size = page.getByRole('group', { name: /Wybierz rozmiar/ }).getByRole('radio', { disabled: false });
            const id = await size.first().getAttribute('id');
            assert(id, 'the size radio has no id');
            await page.locator(`label[for="${id}"]`).click();
            await expect(size.first()).toBeChecked();
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
        });
        await step('open the cart', async () => {
            await page
                .getByRole('link', { name: /Wyświetl koszyk/ })
                .or(page.getByRole('button', { name: /Wyświetl koszyk/ }))
                .first()
                .click();
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
