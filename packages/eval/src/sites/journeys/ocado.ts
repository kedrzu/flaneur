import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.ocado.com/';

/** Ocado behind AWS WAF: a search, one product into the guest trolley, the trolley's quick view. */
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
        await step('search', async () => {
            await submitSearch(page.getByRole('search').getByRole('combobox'), 'semi skimmed milk');
            await expect(page).toHaveURL(/\/search/);
            await expect(page.getByRole('button', { name: /^Add .+ to trolley/ }).first()).toBeVisible();
        });
        await step('add to trolley', async () => {
            await page
                .getByRole('button', { name: /^Add .+ to trolley/ })
                .first()
                .click();
        });
        await step('open the trolley', async () => {
            // The trolley opens as a quick view over the page; its full page is the checkout, which a journey never enters.
            const trolley = page.getByRole('button', { name: /^Trolley £\d+\.\d+ - Open quick view trolley/ });
            await expect(trolley).not.toHaveAccessibleName(/^Trolley £0\.00/);
            await trolley.click();
        });
    },
});
