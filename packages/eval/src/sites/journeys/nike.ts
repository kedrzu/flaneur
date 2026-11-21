import { expect } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
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
            await openLink(page.locator('a[href*="/pl/t/"]').first());
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
    },
});
