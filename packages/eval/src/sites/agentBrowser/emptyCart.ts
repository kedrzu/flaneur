import {
    CART_RENDER_MS,
    MAX_CART_REMOVALS,
    ONE_LESS_IN_CART,
    REMOVE_FROM_CART,
    SETTLE_MS,
    waitForChange,
} from '../utils/emptyCart.js';
import type { AgentBrowser } from './openAgentBrowser.js';

/**
 * `emptyCart` of the Playwright journeys, as an agent does it: reads the cart's controls from a snapshot and clicks the
 * last remove (or the last "one less" where there is none) while the snapshot changes after each click, at most
 * `MAX_CART_REMOVALS` times.
 * @util
 */
export async function emptyCart(ab: AgentBrowser) {
    const readSnapshot = async () =>
        JSON.stringify((await ab.snapshot()).elements.map(({ role, name }) => [role, name]));
    const countControls = async () => (await readRemoveControls(ab)).length;
    for (let removal = 0; removal < MAX_CART_REMOVALS; removal++) {
        // The cart may still be rendering, or reloading after the last click.
        const waitMs = removal === 0 ? CART_RENDER_MS : SETTLE_MS;
        if ((await countControls()) === 0 && !(await waitForChange(countControls, 0, waitMs))) {
            return;
        }
        const controls = await readRemoveControls(ab);
        const removes = controls.filter(({ name }) => REMOVE_FROM_CART.test(name));
        const target = (removes.length > 0 ? removes : controls).at(-1);
        if (target == null) {
            return;
        }
        const before = await readSnapshot();
        await ab.click(target.ref);
        if (!(await waitForChange(readSnapshot, before))) {
            return;
        }
    }
}

/** The cart's remove and "one less" controls in the current snapshot. */
async function readRemoveControls(ab: AgentBrowser) {
    const { elements } = await ab.snapshot();
    return elements.filter(
        element =>
            (element.role === 'button' || element.role === 'link') &&
            element.disabled !== true &&
            (REMOVE_FROM_CART.test(element.name) || ONE_LESS_IN_CART.test(element.name)),
    );
}
