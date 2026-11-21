import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openProducts } from '../utils/openProducts.js';
import { readPage } from '../utils/readPage.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.zalando.pl/';

/**
 * The long Zalando walk (Akamai): a search sorted by price, its second page, two products read (back between them), the
 * second in the guest cart.
 */
export const zalandoLong = defineJourney({
    name: 'zalando.pl long',
    vendor: 'Akamai',
    url: URL,
    tags: ['@long'],
    run: async (page, step) => {
        const products = openProducts(page, 'article a[href$=".html"]');
        const addToCart = page.getByRole('button', { name: 'Dodaj do koszyka' });

        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page
                    .getByRole('button', { name: /^(Zaakceptuj|Akceptuj|Zgadzam się)/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step(
            'close the promotion',
            async () => {
                await page.getByRole('button', { name: 'Zamknij' }).first().click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'czapka zimowa');
            await expect(page).toHaveURL(/\/katalog\/|[?&]q=czapka/);
        });
        await step('sort by price', async () => {
            await page.getByRole('button', { name: 'Sortuj' }).click();
            await page.getByText('Najwyższa cena', { exact: true }).click();
            await page.getByRole('button', { name: 'Zapisz filtr Sortuj' }).click();
            await expect(page).toHaveURL(/[?&]order=price/);
        });
        await step('open page 2', async () => {
            await page.getByRole('link', { name: 'następna strona' }).click();
            await expect(page).toHaveURL(/[?&]p=2/);
        });
        await step('open a product', async () => {
            await products.openFirst();
            await expect(addToCart).toBeVisible();
        });
        await step('read the product', async () => {
            await readPage(page);
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/[?&]p=2/);
        });
        await step('open another product', async () => {
            await products.openAnother();
            await expect(addToCart).toBeVisible();
        });
        await step('read the other product', async () => {
            await readPage(page);
        });
        await step(
            'choose a size',
            async () => {
                // A one-size product shows its size as text; another asks for one first.
                await page.getByRole('button', { name: /Wybierz rozmiar/ }).click();
                // A size out of stock offers a reminder instead.
                await page
                    .getByRole('listitem')
                    .filter({ has: page.getByRole('checkbox') })
                    .filter({ hasNotText: /przypomnienie/i })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step('add to cart', async () => {
            await addToCart.click();
            await expect(page.getByRole('link', { name: /koszyk/i }).filter({ hasText: /[1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page
                .getByRole('link', { name: /koszyk/i })
                .filter({ hasText: /[1-9]/ })
                .click();
            await expect(page.getByRole('heading', { name: /koszyk/i }).first()).toBeVisible();
        });
    },
});
