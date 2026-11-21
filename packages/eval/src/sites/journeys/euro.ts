import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.euro.com.pl/';

/** RTV Euro AGD behind Akamai (`ak_bmsc`, `bm_sv`): a search, a product, the guest cart. */
export const euro = defineJourney({
    name: 'euro.com.pl',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(
                page.getByPlaceholder('Szukaj w RTV Euro AGD').filter({ visible: true }).first(),
                'słuchawki bezprzewodowe',
            );
            await expect(page).toHaveURL(/\/search2?\.bhtml\?keyword=/);
        });
        await step(
            'accept cookies on the results',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj' }).click();
            },
            { optional: true },
        );
        await step('open a product', async () => {
            await page
                .locator('a[href*="/sluchawki/"][href$=".bhtml"]')
                .filter({ hasText: /Słuchawki/ })
                .first()
                .click();
            await expect(page.getByRole('button', { name: 'Do koszyka' }).first()).toBeVisible();
        });
        await step('add to cart', async () => {
            // The page repeats the button in a sticky bar kept `inert` until it shows; a click there never lands.
            await page
                .getByRole('button', { name: 'Do koszyka' })
                .and(page.locator(':not([inert], [inert] *)'))
                .first()
                .click();
            // A product the eval profile's cart already holds is not added again: a dialog sends to the cart instead
            // of the added-to-cart page.
            await expect(toCart(page).first()).toBeVisible();
        });
        await step('open the cart', async () => {
            await toCart(page).first().click();
            await expect(page).toHaveURL(/\/cart\.bhtml/);
        });
    },
});

/** "Przejdź do koszyka": a link on the added-to-cart page, a button in the already-in-cart dialog. */
function toCart(page: Page) {
    const name = 'Przejdź do koszyka';
    return page.getByRole('link', { name }).or(page.getByRole('button', { name }));
}
