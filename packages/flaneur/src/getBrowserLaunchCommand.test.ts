import { expect, test } from 'bun:test';

import { getBrowserLaunchCommand } from './getBrowserLaunchCommand.js';
import type { BrowserLaunchCommand } from './getBrowserLaunchCommand.js';

test('on macOS opens the .app bundle of the executable in the background', () => {
    const expected: BrowserLaunchCommand = { command: 'open', args: ['-g', '-a', '/Applications/Arc.app'] };

    expect(getBrowserLaunchCommand('/Applications/Arc.app/Contents/MacOS/Arc', 'darwin')).toEqual(expected);
});

test('on macOS takes the outer bundle when the path holds a nested one', () => {
    const executable = '/Users/me/Apps/Brave Browser.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper';
    const expected: BrowserLaunchCommand = { command: 'open', args: ['-g', '-a', '/Users/me/Apps/Brave Browser.app'] };

    expect(getBrowserLaunchCommand(executable, 'darwin')).toEqual(expected);
});

test('runs an executable outside a bundle, and on other platforms, with no flags', () => {
    const linux: BrowserLaunchCommand = { command: '/opt/vivaldi/vivaldi', args: [] };
    const windows: BrowserLaunchCommand = { command: 'C:\\Edge\\msedge.exe', args: [] };

    expect(getBrowserLaunchCommand('/opt/vivaldi/vivaldi', 'darwin')).toEqual(linux);
    expect(getBrowserLaunchCommand('/opt/vivaldi/vivaldi', 'linux')).toEqual(linux);
    expect(getBrowserLaunchCommand('C:\\Edge\\msedge.exe', 'win32')).toEqual(windows);
    expect(getBrowserLaunchCommand('/tmp/x.app/Contents/MacOS/x', 'linux').command).toBe('/tmp/x.app/Contents/MacOS/x');
});
