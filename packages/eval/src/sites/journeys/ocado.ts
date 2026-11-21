import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';

const URL = 'https://www.ocado.com/';

/** Ocado behind AWS WAF: a category, one product into the guest trolley, the trolley. */
export const ocado = defineJourney({
    name: 'ocado.com',
    vendor: 'AWS WAF',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Accept' }).click();
            },
            { optional: true },
        );
        await step('open a category', async () => {
            await page.goto(`${URL}categories/fresh-chilled-food/milk-butter-eggs`, { referer: page.url() });
            await expect(page.getByRole('button', { name: /^Add .+ to trolley/ }).first()).toBeVisible();
        });
        await step('add to trolley', async () => {
            await page
                .getByRole('button', { name: /^Add .+ to trolley/ })
                .first()
                .click();
        });
        await step('open the trolley', async () => {
            await page
                .getByRole('link', { name: /trolley/i })
                .first()
                .click();
            await expect(page).toHaveURL(/trolley|basket/);
        });
    },
});
