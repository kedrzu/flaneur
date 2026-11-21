import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
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
            await openLink(page.locator('a[href*="/dp/"]').first());
            await expect(page).toHaveURL(/\/dp\/\d+/);
        });
    },
});
