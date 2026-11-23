'use strict';

const USH02_PAGE_SIZE = 500;
const USH02_KEY_FIELDS = ['MANDT', 'BNAME', 'MODBE', 'TCODE', 'REPID'];

const sapLiteral = (value) => String(value).trim().toUpperCase().replace(/'/g, "''");

const historyKeyParts = (row) => USH02_KEY_FIELDS.map((field) => String(row[field] || '').trim());
const historyCursor = (row) => ({
  at: `${row.MODDA}${row.MODTI}`,
  key: JSON.stringify(historyKeyParts(row)),
});

function compareHistoryRows(a, b) {
  const atOrder = `${a.MODDA}${a.MODTI}`.localeCompare(`${b.MODDA}${b.MODTI}`);
  if (atOrder) return atOrder;
  const aKey = historyKeyParts(a);
  const bKey = historyKeyParts(b);
  for (let i = 0; i < aKey.length; i++) {
    const order = aKey[i].localeCompare(bKey[i]);
    if (order) return order;
  }
  return 0;
}

function compareHistoryCursor(row, cursor) {
  const atOrder = `${row.MODDA}${row.MODTI}`.localeCompare(cursor.at);
  if (atOrder) return atOrder;
  const key = JSON.parse(cursor.key || '[]');
  if (!key.length) return 1;
  const rowKey = historyKeyParts(row);
  for (let i = 0; i < rowKey.length; i++) {
    const order = rowKey[i].localeCompare(String(key[i] || ''));
    if (order) return order;
  }
  return 0;
}

async function readUSH02Where(rfc, where, result, destination = result.rows) {
  let previousPageSignature = '';
  let rowSkips = 0;

  while (true) {
    if (++result.calls > 10000) throw new Error('USH02 read exceeded the safe query limit');
    const rows = await rfc.readTable(
      'USH02',
      ['MANDT', 'BNAME', 'MODDA', 'MODTI', 'MODBE', 'TCODE', 'REPID', 'UFLAG'],
      where,
      USH02_PAGE_SIZE,
      rowSkips,
      true
    );
    if (!rows.length) return;

    const signature = JSON.stringify(rows);
    if (signature === previousPageSignature) throw new Error('USH02 paging did not advance');
    previousPageSignature = signature;
    destination.push(...rows);
    if (rows.length < USH02_PAGE_SIZE) return;

    const nextRowSkips = rowSkips + rows.length;
    if (nextRowSkips <= rowSkips) throw new Error('USH02 paging did not advance');
    rowSkips = nextRowSkips;
  }
}

async function readUSH02Range(rfc, low, high, result) {
  const where = low === high
    ? [`MODDA = '${low}'`]
    : [`MODDA >= '${low}'`, `AND MODDA <= '${high}'`];
  return readUSH02Where(rfc, where, result);
}

async function readUSH02(rfc, cursor) {
  const result = { rows: [], calls: 0 };
  const startDate = cursor ? cursor.at.slice(0, 8) : '00000000';
  if (startDate === '00000000') {
    await readUSH02Range(rfc, '00000000', '00000000', result);
    await readUSH02Range(rfc, '00010101', '99991231', result);
  } else {
    await readUSH02Range(rfc, startDate, '99991231', result);
  }

  result.rows.sort(compareHistoryRows);
  const rowsAfterCursor = result.rows.filter((row) => !cursor || compareHistoryCursor(row, cursor) > 0);
  const previousByUser = new Map();
  if (cursor) {
    result.rows.forEach((row) => {
      if (compareHistoryCursor(row, cursor) <= 0) previousByUser.set(row.BNAME, row);
    });

    const usersMissingPrevious = new Set(
      rowsAfterCursor.filter((row) => !previousByUser.has(row.BNAME)).map((row) => row.BNAME)
    );
    for (const username of usersMissingPrevious) {
      const previousRows = { rows: [], calls: result.calls };
      await readUSH02Where(
        rfc,
        [`BNAME = '${sapLiteral(username)}'`],
        previousRows
      );
      result.calls = previousRows.calls;
      previousRows.rows.sort(compareHistoryRows);
      const previous = previousRows.rows.filter((row) => compareHistoryCursor(row, cursor) <= 0).at(-1);
      if (previous) previousByUser.set(username, previous);
    }
  }

  return rowsAfterCursor.map((row) => {
    const previous = previousByUser.get(row.BNAME);
    previousByUser.set(row.BNAME, row);
    return {
      username: row.BNAME,
      uflag: Number(row.UFLAG) || 0,
      previousUflag: previous ? Number(previous.UFLAG) || 0 : null,
      lockedAt: `${row.MODDA}${row.MODTI}`,
      changedBy: row.MODBE,
      historyKey: JSON.stringify(historyKeyParts(row)),
    };
  });
}

module.exports = {
  USH02_PAGE_SIZE,
  USH02_KEY_FIELDS,
  sapLiteral,
  historyKeyParts,
  historyCursor,
  compareHistoryRows,
  compareHistoryCursor,
  readUSH02Where,
  readUSH02Range,
  readUSH02
};
