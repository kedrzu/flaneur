import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.thalia.de/';

/** Thalia behind Cloudflare (`cf_clearance`; no HUMAN cookie on 2026-11-21): a search, a book, the guest cart. */
export const thalia = defineJourney({
    name: 'thalia.de',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Alles akzeptieren' }).click();
            },
            { optional: true },
        );
        await step(
            'stay on thalia.de',
            async () => {
                // A visitor from outside Germany is offered another country's shop.
                await page.getByRole('radio', { name: /^Deutschland/ }).check();
                await page.getByRole('button', { name: 'Auswählen' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(
                page.getByRole('searchbox', { name: 'Nach Titel, Autor, Stichwort oder ISBN suchen' }),
                'Der Zauberberg',
            );
            await expect(page).toHaveURL(/\/suche\?sq=/);
        });
        await step('open a book', async () => {
            await clickResult(
                page
                    .locator('a[href*="/artikeldetails/"]')
                    .filter({ hasText: /Zauberberg/ })
                    .first(),
            );
            await expect(page).toHaveURL(/\/artikeldetails\//);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'In den Warenkorb' }).first().click();
            await expect(page.getByRole('link', { name: 'Zum Warenkorb' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: 'Zum Warenkorb' }).click();
            await expect(page).toHaveURL(/\/warenkorb/);
            await expect(page.getByRole('heading', { name: 'Warenkorb', level: 1 })).toBeVisible();
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
