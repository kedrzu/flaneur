/**
 * A number drawn uniformly from `[min, max)` with `random`, a source like `Math.random`.
 * @util
 */
export function randomBetween(random: () => number, min: number, max: number) {
    return min + random() * (max - min);
}
