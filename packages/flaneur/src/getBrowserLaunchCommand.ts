/** A program to start and its arguments. */
export interface BrowserLaunchCommand {
    command: string;
    args: string[];
}

/**
 * How to start the browser at `executable` as the user would, without flags. On macOS an executable inside a `.app`
 * bundle is opened through `open -g -a`, in the background; elsewhere the executable itself is run.
 */
export function getBrowserLaunchCommand(executable: string, platform: NodeJS.Platform): BrowserLaunchCommand {
    const bundle = platform === 'darwin' ? /^.*?\.app(?=\/)/i.exec(executable)?.[0] : undefined;
    if (bundle != null) {
        return { command: 'open', args: ['-g', '-a', bundle] };
    }
    return { command: executable, args: [] };
}
