import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/** The fields of a CDP `Frame` this package reads. */
export interface FrameFields {
    id: string;
    /** The origin of the frame's document; empty when the browser gave none. */
    securityOrigin: string;
}

/**
 * Reads the frames of a `Page.getFrameTree` reply, the main frame first, then breadth first; a frame with no id is
 * skipped.
 * @__NO_SIDE_EFFECTS__
 */
export function readFrameTree(reply: unknown): FrameFields[] {
    const frames: FrameFields[] = [];
    const pending: unknown[] = [isPlainObject(reply) ? reply['frameTree'] : undefined];
    while (pending.length > 0) {
        const tree = pending.shift();
        if (!isPlainObject(tree)) {
            continue;
        }
        const frame = readFrame(tree['frame']);
        if (frame != null) {
            frames.push(frame);
        }
        const children = tree['childFrames'];
        if (Array.isArray(children)) {
            const list: readonly unknown[] = children;
            pending.push(...list);
        }
    }
    return frames;
}

/**
 * Reads a CDP `Frame` (in a frame tree, or in `Page.frameNavigated`); `null` when it has no id.
 * @__NO_SIDE_EFFECTS__
 */
export function readFrame(frame: unknown): FrameFields | null {
    if (!isPlainObject(frame) || typeof frame['id'] !== 'string') {
        return null;
    }
    const { securityOrigin } = frame;
    return { id: frame['id'], securityOrigin: typeof securityOrigin === 'string' ? securityOrigin : '' };
}
