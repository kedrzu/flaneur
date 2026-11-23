import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.vinted.pl/';

/** The item opened: one of the second row or below, away from the header. */
const LOWER_RESULT = 8;

/**
 * Vinted, behind Cloudflare and DataDome; counted as DataDome, whose challenge the site shows. No guest cart: a search
 * and an item.
 */
export const vinted = defineJourney({
    name: 'vinted.pl',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zgoda na wszystkie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('textbox', { name: 'Przedmioty' }), 'plecak');
            await expect(page).toHaveURL(/\/catalog\?.*search_text=/);
        });
        await step('open an item', async () => {
            // The search can leave the header's catalog menu open over the first items, its backdrop covering the page,
            // and the way to an item of the first row, right under the header, opens it again (2026-11-22, three runs):
            // a person opens one further down.
            await clickResult(page.locator('a[href*="/items/"]').nth(LOWER_RESULT), {
                menuBackdrop: page.locator('[class*="catalog-dropdown__background"]'),
            });
            await expect(page).toHaveURL(/\/items\/\d+/);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
    },
});
