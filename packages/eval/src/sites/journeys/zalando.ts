import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.zalando.pl/';

/** Zalando behind Akamai: a search, a one-size product, the guest cart. */
export const zalando = defineJourney({
    name: 'zalando.pl',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page
                    .getByRole('button', { name: /^(Zaakceptuj|Akceptuj|Zgadzam się)/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step(
            'close the promotion',
            async () => {
                await page.getByRole('button', { name: 'Zamknij' }).first().click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'czapka zimowa');
            // Zalando lands a query on a catalog page or on a section's results.
            await expect(page).toHaveURL(/\/katalog\/|[?&]q=czapka/);
        });
        await step('open a product', async () => {
            await clickResult(page.locator('article a[href$=".html"]').first());
            await expect(page.getByRole('button', { name: 'Dodaj do koszyka' })).toBeVisible();
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
            await expect(page.getByRole('link', { name: /koszyk/i }).filter({ hasText: /[1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page
                .getByRole('link', { name: /koszyk/i })
                .filter({ hasText: /[1-9]/ })
                .click();
            await expect(page.getByRole('heading', { name: /koszyk/i }).first()).toBeVisible();
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
