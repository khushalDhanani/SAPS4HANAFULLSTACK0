'use strict';

const cds = require('@sap/cds');
const { STATUS_TEXT, STATUS_CRITICALITY } = require('../srv/common/wmStatus');
const seed = require('./fixtures/wm/reservationSeed');

/**
 * Seeds WM test data (ReservationStatus from srv/common/wmStatus.js, ReservationTrack and ReservationLog from the
 * tracked synthetic fixture) into the test in-memory database. Tables that already hold rows are left alone.
 */
async function seedLocalWmData() {
  const tables = [
    {
      entity: 'saps4hana.wm.ReservationStatus',
      rows: Object.keys(STATUS_TEXT).map((code) => ({ code, name: STATUS_TEXT[code], criticality: STATUS_CRITICALITY[code] }))
    },
    { entity: 'saps4hana.wm.ReservationTrack', rows: seed.track },
    { entity: 'saps4hana.wm.ReservationLog', rows: seed.log }
  ];

  for (const { entity, rows } of tables) {
    const existing = await cds.db.run(cds.ql.SELECT.one.from(entity));
    if (!existing) await cds.db.run(cds.ql.INSERT.into(entity).entries(rows));
  }
}

module.exports = { seedLocalWmData };
