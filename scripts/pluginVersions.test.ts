import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';

const ROOT = path.resolve(import.meta.dir, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin/skills');

/** The `index.json` OpenCode reads when `plugin/skills/` is added as a skill catalog. */
interface SkillCatalog {
    skills: {
        name: string;
        version: string;
        files: string[];
    }[];
}

/** The part of a `package.json` or Claude Code `plugin.json` this test reads. */
interface VersionedManifest {
    version: string;
}

const packageVersion = readJson<VersionedManifest>('packages/flaneur/package.json').version;

test('the Claude Code plugin has the package version', () => {
    expect(readJson<VersionedManifest>('plugin/.claude-plugin/plugin.json').version).toBe(packageVersion);
});

test('the OpenCode skill catalog lists every skill with the package version', () => {
    const catalog = readJson<SkillCatalog>('plugin/skills/index.json');
    const skillDirs = new Set(
        readdirSync(SKILLS_DIR).filter(name => existsSync(path.join(SKILLS_DIR, name, 'SKILL.md'))),
    );

    expect(new Set(catalog.skills.map(skill => skill.name))).toEqual(skillDirs);
    for (const skill of catalog.skills) {
        // OpenCode refreshes its cached copy only when `version` changes.
        expect(skill.version).toBe(packageVersion);
        expect(skill.files).toContain('SKILL.md');
        for (const file of skill.files) {
            expect(existsSync(path.join(SKILLS_DIR, skill.name, file))).toBe(true);
        }
    }
});

function readJson<T>(file: string): T {
    return JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as T;
}
