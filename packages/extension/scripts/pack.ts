/**
 * Packs the extension for the Chrome Web Store: `dist/flaneur-extension-<version>.zip` with only the files the
 * extension loads, and the manifest without its development `key`, which the store refuses (it signs with its own).
 * Run after `bundle` (`bun run pack` does both).
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/** Everything the manifest and the options page load, besides the manifest itself. */
const FILES = ['options.html', 'defaults.json', 'dist/serviceWorker.js', 'dist/options.js'];

const root = path.join(import.meta.dirname, '..');
const manifest: unknown = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (!isPlainObject(manifest) || typeof manifest['version'] !== 'string') {
    throw new Error('manifest.json has no version');
}
delete manifest['key'];

const stage = await mkdtemp(path.join(tmpdir(), 'flaneur-extension-'));
try {
    await mkdir(path.join(stage, 'dist'));
    for (const file of FILES) {
        await copyFile(path.join(root, file), path.join(stage, file));
    }
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 4));
    const zip = path.join(root, 'dist', `flaneur-extension-${manifest['version']}.zip`);
    await rm(zip, { force: true });
    execFileSync('zip', ['-r', '-X', zip, '.'], { cwd: stage, stdio: 'ignore' });
    console.log(zip);
} finally {
    await rm(stage, { recursive: true, force: true });
}
