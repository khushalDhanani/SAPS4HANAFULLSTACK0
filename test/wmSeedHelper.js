'use strict';

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

/**
 * Seeds local WM data (ReservationStatus, ReservationTrack, ReservationLog)
 * from seed-data-local into the test in-memory SQLite database.
 */
async function seedLocalWmData() {
  const seedDir = path.resolve(__dirname, '../seed-data-local');
  if (!fs.existsSync(seedDir)) return;

  const files = [
    { file: 'saps4hana.wm-ReservationStatus.csv', entity: 'saps4hana.wm.ReservationStatus' },
    { file: 'saps4hana.wm-ReservationTrack.csv', entity: 'saps4hana.wm.ReservationTrack' },
    { file: 'saps4hana.wm-ReservationLog.csv', entity: 'saps4hana.wm.ReservationLog' }
  ];

  for (const { file, entity } of files) {
    const filePath = path.join(seedDir, file);
    if (!fs.existsSync(filePath)) continue;

    const existing = await cds.db.run(cds.ql.SELECT.from(entity));
    if (existing && existing.length > 0) continue;

    const content = fs.readFileSync(filePath, 'utf8').trim();
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;

    const headers = lines[0].split(';').map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(';').map((v) => v.trim());
      const row = {};
      headers.forEach((h, idx) => {
        const val = vals[idx];
        if (val !== undefined && val !== '') {
          if (val === 'true') row[h] = true;
          else if (val === 'false') row[h] = false;
          else if (/^-?\d+$/.test(val) && (h === 'criticality' || h === 'Quantity' || h === 'WithdrawnQuantity' || h === 'RemainingQuantity')) {
            row[h] = Number(val);
          } else if (/^-?\d+\.\d+$/.test(val)) {
            row[h] = Number(val);
          } else {
            row[h] = val;
          }
        }
      });
      rows.push(row);
    }
    if (rows.length > 0) {
      await cds.db.run(cds.ql.INSERT.into(entity).entries(rows));
    }
  }
}

module.exports = { seedLocalWmData };
