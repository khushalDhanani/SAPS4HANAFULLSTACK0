'use strict';

/** Sharded suites must cover every screen/flow exactly once, or a case would silently never run (or run twice). */

const { SCREENS, SHARDS: SUBMIT_SHARDS } = require('../../e2e/negative/verifySubmitFailures.e2e');
const { FLOWS, SHARDS: ACTION_SHARDS } = require('../../e2e/negative/verifyActionFailures.e2e');

const matches = (shards, label) => shards.filter((s) => new RegExp(s.only, 'i').test(label)).map((s) => s.name);

describe('E2E suite shards', () => {
    it.each(SCREENS.map((s) => s.label))('submit failures: %s belongs to exactly one shard', (label) => {
        expect(matches(SUBMIT_SHARDS, label)).toHaveLength(1);
    });

    it.each(FLOWS.map((f) => f.label))('action failures: %s belongs to exactly one shard', (label) => {
        expect(matches(ACTION_SHARDS, label)).toHaveLength(1);
    });

    it('keeps kit flows (shared module-level failure mode) in a single shard', () => {
        const kitShards = new Set(FLOWS.filter((f) => f.kit).map((f) => matches(ACTION_SHARDS, f.label)[0]));
        expect(kitShards.size).toBe(1);
    });

    it('has no shard that matches nothing', () => {
        SUBMIT_SHARDS.forEach((s) => expect(SCREENS.some((x) => new RegExp(s.only, 'i').test(x.label))).toBe(true));
        ACTION_SHARDS.forEach((s) => expect(FLOWS.some((x) => new RegExp(s.only, 'i').test(x.label))).toBe(true));
    });
});
