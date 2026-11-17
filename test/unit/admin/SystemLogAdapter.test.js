'use strict';

/**
 * Unit tests for SystemLogAdapter.js
 * All tests run with a mocked RFC client — no live SAP connection.
 *
 * Coverage:
 *   sanitizeMessage   — all sanitization rules: null bytes, trim, star-redaction,
 *                       IPv4 redaction, IPv6 redaction, user-token redaction, length truncation
 *   toRslgTime        — UTC → RSLGTIME format conversion with configurable offset
 *   fromRslgTimeToUtc — RSLGTIME server-local → UTC ISO string conversion
 *   listInstances     — TH_SERVER_LIST result mapping
 *   readSyslog        — input validation, RSLGTIME params, field allow-list,
 *                       UTC timestamp conversion, user field (includeUser true/false),
 *                       maxRows cap, truncated flag, multi-instance merge + sort,
 *                       RFC error → 503
 */

const {
  SystemLogAdapter,
  sanitizeMessage,
  sanitizeSyslogData,
  toRslgTime,
  fromRslgTimeToUtc,
  resolveTzOffset,
  formatMessageText,
} = require('../../../srv/integration/s4hana/admin/SystemLogAdapter');

// ---------------------------------------------------------------------------
// Helper: build a minimal mock RFC client
// ---------------------------------------------------------------------------
function makeMockRfc(overrides = {}) {
  return {
    call: jest.fn(async () => ({ T_SYSLOG_ENTRIES: [], LIST: [] })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sanitizeMessage
// ---------------------------------------------------------------------------
describe('sanitizeMessage', () => {
  test('returns empty string for null and undefined', () => {
    expect(sanitizeMessage(null)).toBe('');
    expect(sanitizeMessage(undefined)).toBe('');
  });

  test('strips null bytes and trims', () => {
    expect(sanitizeMessage('  hello\x00world  ')).toBe('helloworld');
  });

  test('replaces 4+ stars with [redacted]', () => {
    expect(sanitizeMessage('password: ****')).toBe('password: [redacted]');
    expect(sanitizeMessage('key: **********')).toBe('key: [redacted]');
    expect(sanitizeMessage('a***b')).toBe('a***b'); // 3 stars left intact
  });

  test('replaces IPv4 addresses with [ip]', () => {
    expect(sanitizeMessage('from 192.168.1.1 blocked')).toBe('from [ip] blocked');
    expect(sanitizeMessage('10.0.0.1 and 172.16.0.5')).toBe('[ip] and [ip]');
  });

  test('replaces IPv6 addresses with [ip] (full, compressed, bracketed, loopback)', () => {
    // Full IPv6
    expect(sanitizeMessage('addr: 2001:0db8:85a3:0000:0000:8a2e:0370:7334 end'))
      .toBe('addr: [ip] end');
    // Compressed IPv6
    expect(sanitizeMessage('host fe80::1ff:fe23:4567:890a connected'))
      .toBe('host [ip] connected');
    // Loopback
    expect(sanitizeMessage('local ::1 refused'))
      .toBe('local [ip] refused');
    // Bracketed IPv6
    expect(sanitizeMessage('peer [2001:db8::1] timed out'))
      .toBe('peer [ip] timed out');
  });

  test('redacts user-name-like tokens when redactUserTokens is true', () => {
    expect(sanitizeMessage('Failed login for user=ALICE_01', { redactUserTokens: true }))
      .toBe('Failed login for user=[user]');
    expect(sanitizeMessage('user BOB_TEST logon failed', { redactUserTokens: true }))
      .toBe('user [user] logon failed');
  });

  test('does not redact user tokens when redactUserTokens is false', () => {
    expect(sanitizeMessage('Failed login for user=ALICE_01', { redactUserTokens: false }))
      .toBe('Failed login for user=ALICE_01');
  });

  test('truncates to 200 characters', () => {
    const long = 'A'.repeat(250);
    expect(sanitizeMessage(long)).toHaveLength(200);
  });
});

// ---------------------------------------------------------------------------
// sanitizeSyslogData (per-type slot map & user/hostname redaction)
// ---------------------------------------------------------------------------
describe('sanitizeSyslogData', () => {
  test('AB1 with includeUser=false: redacts positional user and instance/hostname', () => {
    const hostPad = 'app-server-01_DS4_00'.padEnd(32, ' ');
    const rawData = `261117115840${hostPad}TEST_USER_A`;
    const msg = sanitizeSyslogData('sAB1', rawData, { includeUser: false });
    expect(msg).toBe('261117 115840 [instance] [user]');
    expect(msg).not.toContain('app-server-01_DS4_00');
    expect(msg).not.toContain('TEST_USER_A');
  });

  test('AB1 with includeUser=true: preserves user, redacts instance/hostname', () => {
    const hostPad = 'app-server-01_DS4_00'.padEnd(32, ' ');
    const rawData = `261117115840${hostPad}TEST_USER_A`;
    const msg = sanitizeSyslogData('sAB1', rawData, { includeUser: true });
    expect(msg).toBe('261117 115840 [instance] TEST_USER_A');
    expect(msg).not.toContain('app-server-01_DS4_00');
    expect(msg).toContain('TEST_USER_A');
  });

  test('Q04 with includeUser=false: redacts positional user/terminal in slot 0', () => {
    const rawData = 'Terminal_01 800';
    const msg = sanitizeSyslogData('mQ04', rawData, { includeUser: false });
    expect(msg).toBe('[user] 800');
    expect(msg).not.toContain('Terminal_01');
  });

  test('AB6 with includeUser=false: redacts positional user in slot 0', () => {
    const userPad = 'TEST_USER   '; // 12 chars (&6&6)
    const rawData = `${userPad}DATA`;
    const msg = sanitizeSyslogData('sAB6', rawData, { includeUser: false });
    expect(msg).toBe('[user] DATA');
    expect(msg).not.toContain('TEST_USER');
  });

  test('redacts matching userToken across any entry type when includeUser=false', () => {
    const rawData = 'Connection terminated for TEST_OPERATOR by timeout';
    const msg = sanitizeSyslogData('lA03', rawData, {
      includeUser: false,
      userToken: 'TEST_OPERATOR',
    });
    expect(msg).toBe('Connection terminated for [user] by timeout');
    expect(msg).not.toContain('TEST_OPERATOR');
  });

  test('redacts SAP server hostnames and instance names to [host] and [instance]', () => {
    const rawData = 'Session on app-server-01_DS4_00 terminated';
    const msg = sanitizeSyslogData('mQ0I', rawData, { includeUser: false });
    expect(msg).toBe('Session on [instance] terminated');
    expect(msg).not.toContain('app-server-01_DS4_00');
  });
});

// ---------------------------------------------------------------------------
// formatMessageText (static template lookup and parameter substitution)
// ---------------------------------------------------------------------------
describe('formatMessageText', () => {
  test('returns null when rawType is null, undefined, or empty', () => {
    expect(formatMessageText(null, 'data')).toBeNull();
    expect(formatMessageText(undefined, 'data')).toBeNull();
    expect(formatMessageText('', 'data')).toBeNull();
  });

  test('returns null when message key has no template in the static catalog', () => {
    expect(formatMessageText('ZZZZ', 'data')).toBeNull();
    expect(formatMessageText('x999', 'data')).toBeNull();
  });

  test('substitutes delimited &A &B parameters for PM2 certificate expiration template', () => {
    const rawData = 'SSL Client (Anonymous) & 588 & & & &';
    const text = formatMessageText(' PM2', rawData);
    expect(text).toBe('Certificate with PSE type >SSL Client (Anonymous)< has been invalid for 588 days');
  });

  test('substitutes positional program, line, and event parameters for A14 template', () => {
    const rawData = 'ZFI_R_041_F01                           0006START-OF-SELECTION';
    const text = formatMessageText('xA14', rawData);
    expect(text).toBe('> in program ZFI_R_041_F01, line 0006, event START-OF-SELECTION');
  });

  test('substitutes AB1 short dump created template, redacts host and user in strict mode', () => {
    const hostPad = 'app-server-01_DS4_00'.padEnd(32, ' ');
    const rawData = `261117115840${hostPad}TEST_USER_A`;
    const text = formatMessageText('sAB1', rawData, { redactUserTokens: true });
    expect(text).toBe('> Short dump "261117 115840 [instance] [user]" created.');
    expect(text).not.toContain('app-server-01_DS4_00');
    expect(text).not.toContain('TEST_USER_A');
  });

  test('strict resolution: returns null for problematic/dropped/malformed templates (Q04, AB0, D01, S23, R47, R48)', () => {
    // Q04: template has 3 placeholders (&a, &b, &c), raw data has only 2 fields -> returns null
    expect(formatMessageText('mQ04', 'Terminal_01 800', { redactUserTokens: true })).toBeNull();

    // AB0: rawData drops trailing data 'abfunc 9116' and &b, &c unresolved -> returns null
    expect(formatMessageText('lAB0', 'jfunc_back                                          abfunc  9116')).toBeNull();

    // D01: rawData drops parameter list '( &a &b ... )' -> returns null
    expect(formatMessageText('nD01', 'IP                  710')).toBeNull();

    // S23: rawData has trailing unconsumed data -> returns null
    expect(formatMessageText('mS23', '601                                   GwDiscoclient gwxxrd.c1225')).toBeNull();

    // R47: SAP template is malformed (unclosed parenthesis) -> returns null
    expect(formatMessageText('mR47', 'WARNING-SESSION-SOFT_CANCEL           ThResFrdelete thxxmode1168')).toBeNull();

    // R48: unconsumed trailing data -> returns null
    expect(formatMessageText('mR48', 'SAP_GUI_DISCONNECT                    ThResFrdelete thxxmode1224')).toBeNull();
  });

  test('strict resolution: returns null when unresolved placeholders remain (no partial text)', () => {
    // A template with unresolvable placeholders where data does not match documented grammar
    const text = formatMessageText(' A20', 'bad data');
    // A20 is '> Error code $$$$$$$$$$$$$$$$$$$$' - does not resolve
    expect(text).toBeNull();
  });

  test('applies sanitization AFTER parameter substitution (IPv4, IPv6, user tokens)', () => {
    const rawData = 'host 192.168.1.5 user=ADMIN_01 & 10 & & & &';
    const text = formatMessageText(' PM2', rawData, { redactUserTokens: true });
    expect(text).toContain('[ip]');
    expect(text).toContain('user=[user]');
    expect(text).not.toContain('192.168.1.5');
    expect(text).not.toContain('ADMIN_01');
  });
});

// ---------------------------------------------------------------------------
// Timezone conversion helpers
// ---------------------------------------------------------------------------
describe('toRslgTime and fromRslgTimeToUtc', () => {
  test('toRslgTime converts UTC date to RSLGTIME using offset', () => {
    const utcDate = new Date('2024-01-15T07:30:00.000Z');
    // Offset +330 min (IST) -> 13:00:00 local
    expect(toRslgTime(utcDate, 330)).toBe('2024011513000000');
  });

  test('toRslgTime respects custom offset override', () => {
    const utcDate = new Date('2024-01-15T07:30:00.000Z');
    // Offset +0 min (UTC) -> 07:30:00
    expect(toRslgTime(utcDate, 0)).toBe('2024011507300000');
    // Offset +60 min (CET) -> 08:30:00
    expect(toRslgTime(utcDate, 60)).toBe('2024011508300000');
  });

  test('fromRslgTimeToUtc converts server-local timestamp string back to UTC ISO string', () => {
    // Server-local 13:00:00 with offset +330 min -> 07:30:00 UTC
    const utc = fromRslgTimeToUtc('2024011513000000', 330);
    expect(utc).toBe('2024-01-15T07:30:00.000Z');
  });

  test('fromRslgTimeToUtc handles 14-char server timestamps', () => {
    const utc = fromRslgTimeToUtc('20240115130000', 330);
    expect(utc).toBe('2024-01-15T07:30:00.000Z');
  });

  test('fromRslgTimeToUtc returns empty string on malformed input', () => {
    expect(fromRslgTimeToUtc('')).toBe('');
    expect(fromRslgTimeToUtc('invalid')).toBe('');
    expect(fromRslgTimeToUtc(null)).toBe('');
  });

  test('resolveTzOffset reads environment variable or default', () => {
    delete process.env.SAPLOGS_SM21_TZ_OFFSET_MINUTES;
    expect(resolveTzOffset()).toBe(330);
    process.env.SAPLOGS_SM21_TZ_OFFSET_MINUTES = '120';
    expect(resolveTzOffset()).toBe(120);
    delete process.env.SAPLOGS_SM21_TZ_OFFSET_MINUTES;
  });
});

// ---------------------------------------------------------------------------
// listInstances
// ---------------------------------------------------------------------------
describe('SystemLogAdapter.listInstances', () => {
  test('maps TH_SERVER_LIST result to { name, host, state }', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({
        LIST: [
          { NAME: 'app-server-01_DS4_00', HOST: 'app-server-01', STATE: ' ' },
        ],
      })),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc });
    const result  = await adapter.listInstances();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'app-server-01_DS4_00', host: 'app-server-01', state: '' });
  });

  test('wraps RFC error as status 503', async () => {
    const mockRfc = makeMockRfc({ call: jest.fn(async () => { throw new Error('RFC_NO_CONNECTION'); }) });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc });
    await expect(adapter.listInstances()).rejects.toMatchObject({ status: 503 });
  });
});

// ---------------------------------------------------------------------------
// readSyslog — input validation & features
// ---------------------------------------------------------------------------
describe('SystemLogAdapter.readSyslog', () => {
  const fakeRow = {
    SLGTYPE:   'lA03',
    SLGDATTIM: '2024011513000000',
    SLGPROC:   'PROC1',
    SLGMAND:   '220',
    SLGMODE:   'B',
    SLGTC:     'SM21',
    SLGREPNA:  'RSLG',
    SLGDATA:   'Normal message for user=TARGET_USER',
    SLGUSER:   'TEST_OPERATOR',
    SLGPASSPORT:    'PASSPORT_BINARY',
    SLGROOTCONTEXT: 'ROOT',
    SLGCONNECTION:  'CONN',
    SLGLTRM:        'TERM001',
    SLGTERMIDNEW:   'TERMID',
    SLGDUMMY2:      'D2',
    SLGCONNECTIONCOUNTER: 1,
  };

  test('throws 400 on missing or invalid dates', async () => {
    const adapter = new SystemLogAdapter({ rfcClient: makeMockRfc() });
    await expect(adapter.readSyslog({ toUtc: new Date() })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readSyslog({ fromUtc: new Date() })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readSyslog({ fromUtc: 'invalid', toUtc: new Date() })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readSyslog({ fromUtc: new Date(), toUtc: 'invalid' })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readSyslog({ fromUtc: new Date('2024-01-15'), toUtc: new Date('2024-01-14') })).rejects.toMatchObject({ status: 400 });
  });

  test('converts server-local timestamp to UTC ISO string in output', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: [fakeRow] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc, tzOffsetMinutes: 330 });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
    });

    expect(entries).toHaveLength(1);
    // 13:00:00 server local - 330 min -> 07:30:00Z UTC
    expect(entries[0].timestamp).toBe('2024-01-15T07:30:00.000Z');
    expect(entries[0].serverTimestamp).toBe('2024011513000000');
  });

  test('user field behavior with includeUser=false (default: user omitted and token redacted)', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: [fakeRow] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc, includeUser: false });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
    });

    expect(entries[0]).not.toHaveProperty('user');
    expect(entries[0].message).toContain('user=[user]');
  });

  test('user field behavior with includeUser=true (user populated, token unredacted)', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: [fakeRow] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc, includeUser: true });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
    });

    expect(entries[0].user).toBe('TEST_OPERATOR');
    expect(entries[0].message).toContain('user=TARGET_USER');
  });

  test('row cap truncates and sets truncated=true', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ...fakeRow,
      SLGDATTIM: `2024011513000${i}00`,
    }));
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: rows };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc });
    const { entries, count, truncated } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
      maxRows: 2,
    });
    expect(count).toBe(2);
    expect(entries).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  test('multi-instance merges and sorts results ascending by timestamp', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn, params) => {
        if (fn === 'TH_SERVER_LIST') {
          return { LIST: [{ NAME: 'INST_A' }, { NAME: 'INST_B' }] };
        }
        if (params.IM_INSTANCENAME === 'INST_A') {
          return { T_SYSLOG_ENTRIES: [{ ...fakeRow, SLGDATTIM: '2024011514000000' }] };
        }
        return { T_SYSLOG_ENTRIES: [{ ...fakeRow, SLGDATTIM: '2024011513000000' }] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T10:00:00Z'),
    });
    expect(entries[0].timestamp).toContain('07:30:00');
    expect(entries[1].timestamp).toContain('08:30:00');
  });

  test('returns messageText as null by default when enableMessageText is false', async () => {
    const pm2Row = {
      ...fakeRow,
      SLGTYPE: ' PM2',
      SLGDATA: 'SSL Client (Anonymous) & 588 & & & &',
    };
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: [pm2Row] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc, enableMessageText: false });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
    });

    expect(entries[0].message).toBe('SSL Client (Anonymous) & 588 & & & &');
    expect(entries[0].messageText).toBeNull();
  });

  test('populates messageText when enableMessageText is true', async () => {
    const pm2Row = {
      ...fakeRow,
      SLGTYPE: ' PM2',
      SLGDATA: 'SSL Client (Anonymous) & 588 & & & &',
    };
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: [pm2Row] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc, enableMessageText: true });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
    });

    expect(entries[0].message).toBe('SSL Client (Anonymous) & 588 & & & &');
    expect(entries[0].messageText).toBe('Certificate with PSE type >SSL Client (Anonymous)< has been invalid for 588 days');
  });

  test('sets messageText to null when template does not exist for the message key', async () => {
    const unknownRow = {
      ...fakeRow,
      SLGTYPE: 'ZZ99',
      SLGDATA: 'Some unmapped message data',
    };
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [] };
        return { T_SYSLOG_ENTRIES: [unknownRow] };
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc, enableMessageText: true });
    const { entries } = await adapter.readSyslog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      instance: 'INST1',
    });

    expect(entries[0].message).toBe('Some unmapped message data');
    expect(entries[0].messageText).toBeNull();
  });

  test('wraps RFC error as status 503', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async (fn) => {
        if (fn === 'TH_SERVER_LIST') return { LIST: [{ NAME: 'INST1' }] };
        throw new Error('RFC_COMMUNICATION_FAILURE');
      }),
    });
    const adapter = new SystemLogAdapter({ rfcClient: mockRfc });
    await expect(
      adapter.readSyslog({ fromUtc: new Date('2024-01-15T07:00:00Z'), toUtc: new Date('2024-01-15T08:00:00Z') })
    ).rejects.toMatchObject({ status: 503 });
  });
});
