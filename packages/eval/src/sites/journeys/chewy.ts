import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://www.chewy.com/';

/** Chewy behind Kasada, which has challenged the search outright: a search and a product. */
export const chewy = defineJourney({
    name: 'chewy.com',
    vendor: 'Kasada',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await typeText(page.getByRole('combobox', { name: 'Search' }), 'dog bowl');
            await page.getByRole('button', { name: 'Submit search' }).click();
            await expect(page).toHaveURL(/\/s\?query=|\/b\//);
        });
        await step('open a product', async () => {
            // A result is a link holding the product's heading; the header's hidden gift-card links hold none.
            await page
                .getByRole('link')
                .filter({ has: page.getByRole('heading', { level: 2 }) })
                .filter({ hasNotText: 'Sponsored' })
                .first()
                .click();
            await expect(page).toHaveURL(/\/dp\/\d+/);
        });
    },
});
