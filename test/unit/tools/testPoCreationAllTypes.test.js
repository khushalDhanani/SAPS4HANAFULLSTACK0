'use strict';

const { resolveExecutionMode } = require('../../../tools/test-po-creation-all-types');

describe('PO all-types tool execution mode', () => {
  it('defaults to local validation with no SAP draft or activation', () => {
    expect(resolveExecutionMode([])).toEqual({ type: null, createDraft: false, activate: false });
    expect(resolveExecutionMode(['--type', 'ZDOM'])).toEqual({ type: 'ZDOM', createDraft: false, activate: false });
  });

  it('enables draft creation only with --go', () => {
    expect(resolveExecutionMode(['--type', 'ZDOM', '--go'])).toEqual({
      type: 'ZDOM', createDraft: true, activate: false
    });
  });

  it('requires draft opt-in, separate activation confirmation, and one selected type', () => {
    expect(() => resolveExecutionMode(['--activate', '--confirm-activation', '--type', 'ZDOM']))
      .toThrow('--activate requires --go');
    expect(() => resolveExecutionMode(['--go', '--activate', '--type', 'ZDOM']))
      .toThrow('--confirm-activation');
    expect(() => resolveExecutionMode(['--go', '--activate', '--confirm-activation']))
      .toThrow('--type <type>');
    expect(() => resolveExecutionMode(['--confirm-activation']))
      .toThrow('--confirm-activation requires --activate');
  });

  it('rejects missing type values', () => {
    expect(() => resolveExecutionMode(['--type'])).toThrow('--type requires');
    expect(() => resolveExecutionMode(['--type', '--go'])).toThrow('--type requires');
  });
});
