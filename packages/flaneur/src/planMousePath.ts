import { randomBetween } from './randomBetween.js';

/** A point in a page's viewport, in CSS pixels. */
export interface Point {
    x: number;
    y: number;
}

/** A point the cursor passes, `delayMs` after the one before it. */
export interface MousePathPoint extends Point {
    delayMs: number;
}

/** Where a path goes, and the source of its randomness. */
export interface PlanMousePathParams {
    from: Point;
    to: Point;
    /** Uniform in `[0, 1)`, like `Math.random`. */
    random: () => number;
}

/** Below this distance the cursor just goes there: a hand does not draw a path of a pixel or two. */
const MIN_PATH_PX = 3;
/** Fitts' law, `a + b·log2(1 + D/W)`, with a target `W` px wide: about 150 ms for a few pixels, 650 ms across a screen. */
const FITTS_A_MS = 100;
const FITTS_B_MS = 95;
const FITTS_WIDTH_PX = 20;
const MIN_DURATION_MS = 150;
const MAX_DURATION_MS = 700;
/** How often a mouse reports a move: 60 to 125 Hz. */
const MIN_STEP_MS = 8;
const MAX_STEP_MS = 16;
/** How far a point may stray from the curve: a hand's tremor, and the sensor's rounding. */
const NOISE_PX = 0.5;
/** How far the curve bends away from the straight line, as a share of the distance. */
const MIN_BEND = 0.03;
const MAX_BEND = 0.2;
/**
 * How often the curve bends to the side that takes it across rows first (down from a header, up from a footer) rather
 * than along the row it starts in, where a page's bars hold what hovering opens.
 */
const ACROSS_ROW_CHANCE = 0.8;
/**
 * The time warp that brings the velocity peak forward, `t^0.8`: a hand reaches its top speed at about 40 % of a move
 * and spends the rest homing in, so it leaves where it started sooner than it settles where it ends.
 */
const EARLY_PEAK = 0.8;
/** How often a longer move overshoots the target and comes back. */
const OVERSHOOT_CHANCE = 0.15;
const MIN_OVERSHOOT_DISTANCE_PX = 80;
const MAX_OVERSHOOT_PX = 25;

/**
 * The points a person's cursor passes from `from` to `to`, ending exactly at `to`: a cubic Bézier curve with a random
 * bend, usually to the side that leaves the start's row first, travelled with a minimum-jerk velocity profile whose peak
 * comes at about 40 % of the time (a quick start, a slow end) over a time Fitts' law gives the distance, reported
 * every 8 to 16 ms with half a pixel of noise. One move in about seven of more than 80 px
 * overshoots the target by a few pixels and comes back. Intermediate points are whole pixels, as a mouse reports
 * them, and a point equal to the one before is not reported.
 */
export function planMousePath({ from, to, random }: PlanMousePathParams): MousePathPoint[] {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance < MIN_PATH_PX) {
        return [{ ...to, delayMs: randomBetween(random, MIN_STEP_MS, MAX_STEP_MS) }];
    }
    const duration = findDuration(distance, random);
    if (distance < MIN_OVERSHOOT_DISTANCE_PX || random() >= OVERSHOOT_CHANCE) {
        return planCurve(from, to, duration, random);
    }

    const along = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
    const beyond = Math.min(MAX_OVERSHOOT_PX, distance * randomBetween(random, 0.03, 0.08));
    const aside = beyond * randomBetween(random, -0.4, 0.4);
    const past = {
        x: Math.round(to.x + along.x * beyond - along.y * aside),
        y: Math.round(to.y + along.y * beyond + along.x * aside),
    };
    const correction = planCurve(past, to, randomBetween(random, 80, 160), random);
    const [first, ...rest] = correction;
    const pause = randomBetween(random, 30, 90);
    return [
        ...planCurve(from, past, duration, random),
        ...(first == null ? [] : [{ ...first, delayMs: first.delayMs + pause }]),
        ...rest,
    ];
}

/** Fitts' law for the distance, give or take 15 %. */
function findDuration(distance: number, random: () => number) {
    const fitts = FITTS_A_MS + FITTS_B_MS * Math.log2(1 + distance / FITTS_WIDTH_PX);
    const duration = fitts * randomBetween(random, 0.85, 1.15);
    return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, duration));
}

function planCurve(from: Point, to: Point, duration: number, random: () => number): MousePathPoint[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    // The bend's side and size; both control points lean the same way, so the curve is an arc, not an S.
    const normal = distance === 0 ? { x: 0, y: 0 } : { x: -dy / distance, y: dx / distance };
    const across = Math.sign(normal.y * dy);
    const side = across !== 0 && random() < ACROSS_ROW_CHANCE ? across : random() < 0.5 ? -1 : 1;
    const bend = side * distance * randomBetween(random, MIN_BEND, MAX_BEND);
    const control1 = controlPoint(
        from,
        dx,
        dy,
        normal,
        randomBetween(random, 0.2, 0.4),
        bend * randomBetween(random, 0.6, 1.2),
    );
    const control2 = controlPoint(
        from,
        dx,
        dy,
        normal,
        randomBetween(random, 0.6, 0.8),
        bend * randomBetween(random, 0.6, 1.2),
    );

    const points: MousePathPoint[] = [];
    let elapsed = 0;
    let delayMs = 0;
    for (;;) {
        const step = randomBetween(random, MIN_STEP_MS, MAX_STEP_MS);
        elapsed += step;
        delayMs += step;
        if (elapsed >= duration) {
            break;
        }
        const progress = minimumJerk((elapsed / duration) ** EARLY_PEAK);
        const point = {
            x: Math.round(
                bezier(from.x, control1.x, control2.x, to.x, progress) + randomBetween(random, -NOISE_PX, NOISE_PX),
            ),
            y: Math.round(
                bezier(from.y, control1.y, control2.y, to.y, progress) + randomBetween(random, -NOISE_PX, NOISE_PX),
            ),
        };
        const last = points.at(-1) ?? from;
        if (point.x !== last.x || point.y !== last.y) {
            points.push({ ...point, delayMs });
            delayMs = 0;
        }
    }
    // The end is always reported; a point on it just before is not.
    const last = points.at(-1);
    if (last != null && last.x === to.x && last.y === to.y) {
        points.pop();
        delayMs += last.delayMs;
    }
    points.push({ x: to.x, y: to.y, delayMs });
    return points;
}

function controlPoint(from: Point, dx: number, dy: number, normal: Point, share: number, offset: number): Point {
    return { x: from.x + dx * share + normal.x * offset, y: from.y + dy * share + normal.y * offset };
}

/** The share of the way covered at `time` (0 to 1) when a move minimises jerk: `10t³ − 15t⁴ + 6t⁵`. */
function minimumJerk(time: number) {
    return time * time * time * (10 - 15 * time + 6 * time * time);
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
