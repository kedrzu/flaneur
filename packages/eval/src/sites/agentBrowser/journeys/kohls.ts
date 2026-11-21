import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.kohls.com/';

/** Kohl's behind Akamai: a search, a product in a size, the guest cart; never the checkout. */
export const kohls = defineAgentBrowserJourney({
    name: 'kohls.com',
    vendor: 'Akamai',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step('search', async () => {
            await submitSearch(ab, { role: 'searchbox', name: /^What are you looking for today\?$/ }, 'towels');
            await ab.waitForUrl(/\/search\.jsp\?(.*&)?search=towels/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /\/product\/prd-/ });
            await ab.findRef({ role: 'button', name: /^Add to Cart$/ });
        });
        await step(
            'choose a size',
            async () => {
                await ab.click({ role: 'button', name: /^Select size (?!.*out of stock)/ });
            },
            { optional: true },
        );
        await step('add to cart', async () => {
            // The product's own button comes first; the recommendations below carry an "Add to Cart" of their own.
            await ab.click({ role: 'button', name: /^Add to Cart$/ });
            await ab.findRef({ role: 'heading', name: /Added to Cart for Shipping/ });
        });
        await step('open the cart', async () => {
            await ab.clickRole('button', 'View Cart');
            await ab.waitForUrl(/\/checkout\/shopping_cart\.jsp/);
        });
    },
});
