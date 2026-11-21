import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';

const URL = 'https://www.realestate.com.au/buy';

/** realestate.com.au behind Kasada: a suburb search and its listings. */
export const realestate = defineAgentBrowserJourney({
    name: 'realestate.com.au',
    vendor: 'Kasada',
    url: URL,
    run: async (ab, step) => {
        await step('open the buy page', async () => {
            await ab.open(URL);
        });
        await step('search a suburb', async () => {
            await ab.fill(await ab.findRef({ role: 'combobox', name: /Search for properties/ }), 'Richmond, VIC 3121');
            await ab.click({ role: 'option', name: /Richmond, VIC 3121/ });
            await ab.clickRole('button', 'Search', { exact: true });
            await ab.waitForUrl(/\/buy\/.*in-richmond/);
        });
        await step('see the listings', async () => {
            await ab.scroll('down', 400);
            await ab.findRef({ role: 'link', url: /\/property-/ });
        });
    },
});
