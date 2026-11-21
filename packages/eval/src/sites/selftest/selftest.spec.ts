import { expect } from 'playwright/test';

import { createPageDriver } from '../../createPageDriver.js';
import { runShopProbe } from '../../runShopProbe.js';
import { checkShopScore } from '../checkShopScore.js';
import { defineJourney, JourneyFailure, runJourney } from '../defineJourney.js';
import { selftestTest as test } from './selftestTest.js';

test('a journey through the mini shop passes, skipping an absent cookie banner', async ({
    page,
    step,
    selftestOrigin,
}) => {
    await runJourney(createMiniShopJourney(selftestOrigin), page, step);
});

test('a journey that meets a HUMAN challenge fails as challenged', async ({ page, step, selftestOrigin }) => {
    const failure = await runJourney(createChallengeJourney(selftestOrigin), page, step).catch(
        (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(JourneyFailure);
    expect(failure).toMatchObject({ outcome: { class: 'challenged', vendor: 'HUMAN', step: 'search' } });
});

test('the shop probe reads the visit from a local Beanwright, which scores nothing offline', async ({
    page,
    selftestOrigin,
}) => {
    const driver = createPageDriver(
        page,
        () => Promise.resolve(page.context().browser()?.version() ?? 'unknown'),
        () => Promise.resolve(),
    );

    const visit = await runShopProbe({ driver, pauseMs: 0, label: 'selftest', shopUrl: `${selftestOrigin}/shop/` });

    expect(visit.actions.map(action => action.action)).toEqual(
        expect.arrayContaining([
            'page_list',
            'cookie_accept',
            'search',
            'add_to_cart',
            'order_invalid',
            'order_submit',
        ]),
    );
    expect(visit.actions.filter(action => action.error !== 'reCAPTCHA not loaded')).toEqual([]);
    expect(() => checkShopScore(visit, 0.5)).toThrow('reCAPTCHA v3 gave no score');
});

/** Search, a product, the cart; with a cookie banner the mini shop never shows. */
function createMiniShopJourney(origin: string) {
    return defineJourney({
        name: 'mini shop',
        vendor: 'HUMAN',
        url: `${origin}/`,
        run: async (page, step) => {
            await step('open the shop', async () => {
                await page.goto(`${origin}/`);
            });
            await step(
                'accept cookies',
                async () => {
                    await page.getByRole('button', { name: 'Accept all' }).click();
                },
                { optional: true },
            );
            await step('search', async () => {
                await page.getByRole('searchbox', { name: 'Search' }).fill('kettle');
                await page.keyboard.press('Enter');
            });
            await step('open a product', async () => {
                await page.getByRole('link', { name: 'Electric Kettle' }).click();
                await expect(page.getByRole('heading', { name: 'Electric Kettle' })).toBeVisible();
            });
            await step('add to cart', async () => {
                await page.getByRole('button', { name: 'Add to cart' }).click();
                await expect(page.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
            });
            await step('open the cart', async () => {
                await page.getByRole('link', { name: 'Cart (1)' }).click();
                await expect(page.getByRole('listitem')).toHaveText(['Electric Kettle']);
            });
        },
    });
}

/** Opens a page showing HUMAN's "Press & Hold", then tries to search on it. */
function createChallengeJourney(origin: string) {
    return defineJourney({
        name: 'challenge',
        vendor: 'HUMAN',
        url: `${origin}/challenge.html`,
        run: async (page, step) => {
            await step('open the site', async () => {
                await page.goto(`${origin}/challenge.html`);
            });
            await step('search', async () => {
                await page.getByRole('searchbox', { name: 'Search' }).fill('kettle');
            });
        },
    });
}
