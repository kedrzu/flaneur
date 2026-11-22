import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';

const URL = 'https://www.zillow.com/';

/** Zillow behind HUMAN: a place search, its listings, one home. No cart. */
export const zillow = defineAgentBrowserJourney({
    name: 'zillow.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'skip the listing type question',
            async () => {
                await ab.clickRole('button', 'Skip this question');
            },
            { optional: true },
        );
        await step('search', async () => {
            await ab.fill(await ab.findRef({ role: 'combobox', name: /^Search$/ }), 'Denver, CO');
            // Enter alone does not search here; the button does.
            await ab.clickRole('button', 'Submit Search');
        });
        // After a search Zillow may ask which listings to show before it shows any.
        await step(
            'choose homes for sale',
            async () => {
                await ab.clickRole('button', 'For sale', { exact: true });
            },
            { optional: true },
        );
        await step('see the results', async () => {
            await ab.waitForUrl(/\/homes\//);
        });
        await step('open a home', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /\/homedetails\// });
            await ab.waitForUrl(/\/homedetails\/.+_zpid/);
        });
    },
});
