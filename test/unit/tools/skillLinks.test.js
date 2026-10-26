'use strict';

/**
 * Skill discovery links (skills/README.md): every canonical skills/<name>/SKILL.md must be linked from each
 * supported agent directory as a symlink to exactly ../../skills/<name>, and those directories hold nothing else.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const DISCOVERY_DIRS = ['.agents/skills', '.claude/skills', '.opencode/skills'];

const canonicalSkills = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();

describe('skill discovery links', () => {
    it('finds canonical skills', () => {
        expect(canonicalSkills.length).toBeGreaterThan(0);
    });

    describe.each(DISCOVERY_DIRS)('%s', (dir) => {
        const abs = path.join(ROOT, dir);

        it.each(canonicalSkills)('links %s to its canonical skill', (name) => {
            const link = path.join(abs, name);
            const stat = fs.lstatSync(link, { throwIfNoEntry: false });
            expect(stat && stat.isSymbolicLink()).toBe(true);
            expect(fs.readlinkSync(link)).toBe(`../../skills/${name}`);
            expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(ROOT, 'skills', name)));
            expect(fs.existsSync(path.join(link, 'SKILL.md'))).toBe(true);
        });

        it('has no orphaned or extra entries', () => {
            expect(fs.readdirSync(abs).sort()).toEqual(canonicalSkills);
        });
    });
});
