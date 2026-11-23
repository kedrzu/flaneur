import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.fiverr.com/';

/** A point on the backdrop left of the sign-up dialog, which is centred and narrower than the viewport. */
const SIDE_OF_DIALOG = { x: 40, y: 400 };

/** Fiverr behind HUMAN (`_px3`, its `px-cdn.net` client): a search and one gig. No order, no account. */
export const fiverr = defineJourney({
    name: 'fiverr.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            // A visitor who looks around gets a "Create a new account" dialog over the results (2026-11-23), with no
            // close button: a person presses Escape, then clicks beside it. It is dismissed whenever it shows.
            const signUp = page.getByRole('dialog').getByRole('heading', { name: 'Create a new account' });
            await page.addLocatorHandler(signUp, async () => {
                await page.keyboard.press('Escape');
                if (await signUp.isVisible()) {
                    await page.mouse.click(SIDE_OF_DIALOG.x, SIDE_OF_DIALOG.y);
                }
            });
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                // The banner covers the bottom of the results.
                await page.getByRole('dialog', { name: 'Privacy' }).getByRole('button', { name: 'Accept' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Search for any service' }).first(), 'logo design');
            await expect(page).toHaveURL(/\/search\/gigs\?query=logo/);
        });
        await step('open a gig', async () => {
            // A gig opens in a new tab.
            const gig = await clickIntoNewTab(page.getByRole('link', { name: 'Go to gig' }).first(), step);
            await expect(gig.getByRole('heading', { level: 1 })).toContainText(/^I will/);
        });
    },
});
