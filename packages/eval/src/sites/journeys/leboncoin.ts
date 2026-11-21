import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.leboncoin.fr/';

/**
 * leboncoin behind DataDome: a search and an ad. Browse only; an ad's contact and the sign-in are never used. Its
 * hidden sign-in frame may get DataDome's CAPTCHA on the home page (2026-11-21), a nested challenge the timeline notes.
 */
export const leboncoin = defineJourney({
    name: 'leboncoin.fr',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            // The consent dialog comes up seconds after the page, sometimes later than an optional step waits, so it
            // is accepted whenever it shows, as a person does (an optional step beside this handler raced it). While it shows, the page under it is hidden from the accessibility tree. Its button is labelled
            // "Accepter" and reads "Accepter & Fermer".
            const accept = page.getByRole('button', { name: 'Accepter', exact: true });
            await page.addLocatorHandler(accept, () => accept.click());
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(
                page.getByRole('combobox', { name: 'Rechercher sur leboncoin' }).filter({ visible: true }).first(),
                'vélo',
            );
            await expect(page).toHaveURL(/\/recherche\?.*text=/);
        });
        await step('open an ad', async () => {
            await page.locator('a[href*="/ad/"]').first().click();
            await expect(page).toHaveURL(/\/ad\//);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
    },
});
