import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.decathlon.pl/';

/** Decathlon behind Cloudflare: a search, a product with no size to pick, the guest cart. */
export const decathlon = defineAgentBrowserJourney({
    name: 'decathlon.pl',
    vendor: 'Cloudflare',
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
            await submitSearch(ab, { role: 'searchbox', name: /^Szukaj$/ }, 'bidon');
            await ab.waitForUrl(/\/search\?Ntt=/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /\/p\// });
            await ab.findRef({ role: 'button', name: /Dodaj do koszyka/ });
        });
        await step('add to cart', async () => {
            await ab.clickRole('button', 'Dodaj do koszyka');
            await ab.findRef({ role: 'heading', name: /Dodano do koszyka/ });
        });
        await step('open the cart', async () => {
            await ab.clickRole('link', 'Przejdź do koszyka');
            await ab.waitForUrl(/\/checkout\/cart/);
        });
    },
});
