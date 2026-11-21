import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.vinted.pl/';

/**
 * Vinted, behind Cloudflare and DataDome; counted as DataDome, whose challenge the site shows. No guest cart: a search
 * and an item.
 */
export const vinted = defineAgentBrowserJourney({
    name: 'vinted.pl',
    vendor: 'DataDome',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'Zgoda na wszystkie');
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(ab, { role: 'textbox', name: /^Przedmioty$/ }, 'plecak');
            await ab.waitForUrl(/\/catalog\?.*search_text=/);
        });
        await step('open an item', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /\/items\/\d+/ });
            await ab.waitForUrl(/\/items\/\d+/);
        });
    },
});
