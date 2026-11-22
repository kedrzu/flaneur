import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.google.com/';

/** Google Search, whose `/sorry/` reCAPTCHA page is its challenge: two searches and a second results page. */
export const google = defineAgentBrowserJourney({
    name: 'google.com',
    vendor: 'reCAPTCHA',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'Zaakceptuj wszystko');
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(ab, { role: 'combobox', name: /^Szukaj$/ }, 'pogoda kraków');
            await ab.waitForUrl(/\/search\?q=/);
        });
        await step('search again', async () => {
            await ab.scroll('down', 500);
            await ab.scroll('up', 500);
            await submitSearch(ab, { role: 'combobox', name: /^Szukaj$/ }, 'kubek termiczny');
            await ab.waitForUrl(/\/search\?q=kubek/);
        });
        await step('open results page 2', async () => {
            await ab.scroll('down', 1500);
            await ab.click({ role: 'link', name: /^(Strona|Page) 2$/ });
            await ab.waitForUrl(/[?&]start=10/);
        });
    },
});
