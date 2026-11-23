/**
 * Sets the release version everywhere it is carried: `packages/flaneur/package.json`, its entry in
 * `bun.lock`, the Claude Code plugin manifest and the OpenCode skill catalog (which must match the
 * package, `scripts/pluginVersions.test.ts`). Run by `.github/workflows/release.yml`.
 *
 * Usage: `bun scripts/bumpVersion.ts <patch|minor|major|x.y.z>`. Prints the new version on stdout.
 * The files are edited as text, one `version` value each, so their formatting is untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** The part of `package.json` this script reads. */
interface VersionedManifest {
    version: string;
}

const current = readVersion();
const next = nextVersion(current, process.argv[2] ?? '');

replaceVersion('packages/flaneur/package.json', /^( {4}"version": )"[^"]+"/m);
replaceVersion('bun.lock', /("packages\/flaneur": \{\s+"name": "flaneur",\s+"version": )"[^"]+"/);
replaceVersion('plugin/.claude-plugin/plugin.json', /^( {4}"version": )"[^"]+"/m);
replaceVersion('plugin/skills/index.json', /("version": )"[^"]+"/g);

console.log(next);

function readVersion() {
    const manifest = JSON.parse(
        readFileSync(path.join(ROOT, 'packages/flaneur/package.json'), 'utf8'),
    ) as VersionedManifest;
    return manifest.version;
}

function nextVersion(from: string, bump: string) {
    const parts = SEMVER.exec(from);
    if (!parts) {
        throw new Error(`The current version ${from} is not x.y.z.`);
    }
    const major = Number(parts[1]);
    const minor = Number(parts[2]);
    const patch = Number(parts[3]);

    switch (bump) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        default:
            if (!SEMVER.test(bump)) {
                throw new Error(`Expected patch, minor, major or x.y.z, got "${bump}".`);
            }
            return bump;
    }
}

function replaceVersion(file: string, pattern: RegExp) {
    const fullPath = path.join(ROOT, file);
    const text = readFileSync(fullPath, 'utf8');
    if (!pattern.test(text)) {
        throw new Error(`No version found in ${file}.`);
    }
    pattern.lastIndex = 0;
    writeFileSync(fullPath, text.replace(pattern, `$1"${next}"`));
}
