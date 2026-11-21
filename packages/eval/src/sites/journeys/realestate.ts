import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://www.realestate.com.au/buy';

/** realestate.com.au behind Kasada: a suburb search and its listings. */
export const realestate = defineJourney({
    name: 'realestate.com.au',
    vendor: 'Kasada',
    url: URL,
    run: async (page, step) => {
        await step('open the buy page', async () => {
            await page.goto(URL);
        });
        await step('search a suburb', async () => {
            await typeText(page.getByRole('combobox', { name: 'Search for properties' }), 'Richmond, VIC 3121');
            await page
                .getByRole('option', { name: /Richmond, VIC 3121/ })
                .first()
                .click();
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await expect(page).toHaveURL(/\/buy\/.*in-richmond/);
        });
        await step('see the listings', async () => {
            await expect(page.locator('a[href*="/property-"]').first()).toBeVisible();
        });
    },
});
