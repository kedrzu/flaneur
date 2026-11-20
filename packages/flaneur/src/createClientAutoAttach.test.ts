import { expect, mock, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';

import { createClientAutoAttach } from './createClientAutoAttach.js';

test('a page is attached once, and a call while its attach is in flight settles only with it', async () => {
    const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
    const attach = mock((_targetId: string) => answered);
    const autoAttach = createClientAutoAttach({
        listPages: () => Promise.resolve(['p-1', 'p-2']),
        attach,
        logger: createTestLogger('test').logger,
    });

    let settled = 0;
    const turnedOn = autoAttach.set(true).then(() => settled++);
    await Bun.sleep(0);
    const again = autoAttach.attach('p-1').then(() => settled++);
    await Bun.sleep(0);
    expect(settled).toBe(0);
    answer();
    await Promise.all([turnedOn, again]);

    expect(settled).toBe(2);
    expect(attach.mock.calls).toEqual([['p-1'], ['p-2']]);
});

test('a failed attach is logged and tried again by a later call; while off, nothing is attached', async () => {
    const { logger, logs } = createTestLogger('test');
    const attach = mock((targetId: string) =>
        attach.mock.calls.length === 1
            ? Promise.reject(new Error(`${targetId} is driven by another client`))
            : Promise.resolve(),
    );
    const autoAttach = createClientAutoAttach({ listPages: () => Promise.resolve([]), attach, logger });

    await autoAttach.attach('p-1');
    await autoAttach.set(true);
    await autoAttach.attach('p-1');
    await autoAttach.attach('p-1');
    await autoAttach.set(false);
    await autoAttach.attach('p-2');

    expect(attach.mock.calls).toEqual([['p-1'], ['p-1']]);
    expect(logs.map(log => [log.level, log.message, log.data?.['targetId']])).toEqual([
        ['debug', 'A page could not be auto-attached', 'p-1'],
    ]);
});
