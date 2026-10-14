'use strict';

/**
 * Single source of the reservation/WM process status codes for the JS layer.
 * docs/abap/zcl_res_process.clas.abap (gc_status_*) and docs/abap/zres_track.ddl (domain ZRES_STATUS)
 * carry the same values; keep all three in sync. db/data/saps4hana.wm-ReservationStatus.csv seeds them.
 */
const STATUS = Object.freeze({
  RES_CREATED: '01',
  TR_ERROR: '11',
  TR_CREATED: '02',
  TO_ERROR: '12',
  TO_CREATED: '03',
  TO_CONFIRM_ERROR: '13',
  TO_CONFIRMED: '04',
  GI_ERROR: '90',
  GI_POSTED: '05',
  CANCELLED: '99'
});

const STATUS_TEXT = Object.freeze({
  '01': 'Reservation Created',
  '11': 'TR Creation Error',
  '02': 'TR Created',
  '12': 'TO Creation Error',
  '03': 'TO Created',
  '13': 'TO Confirmation Error',
  '04': 'TO Confirmed',
  '90': 'Goods Issue Error',
  '05': 'Goods Issue Posted',
  '99': 'Cancelled / Reversed'
});

/** 1 = error (red), 2 = in progress (yellow), 3 = done (green) */
const STATUS_CRITICALITY = Object.freeze({
  '01': 2, '11': 1, '02': 2, '12': 1, '03': 2, '13': 1, '04': 2, '90': 1, '05': 3, '99': 1
});

/** Statuses a retry can start from, keyed by the step that failed. */
const STEP_ERROR = Object.freeze({ LB01: '11', LT04: '12', LT12: '13', MIGO: '90' });
const ERROR_STATUSES = Object.freeze(['11', '12', '13', '90']);
/** A TO exists but is not confirmed in SAP. */
const UNCONFIRMED_TO = Object.freeze(['03', '13']);

/**
 * Step 14: Persistent Process Statuses
 * Provides deterministic progress & failure states across warehouse lifecycle.
 */
const PROCESS_STATUS = Object.freeze({
  CREATED: 'CREATED',
  RESERVATION_CREATED: 'RESERVATION_CREATED',
  TR_CREATED: 'TR_CREATED',
  TR_VERIFIED: 'TR_VERIFIED',
  TO_CREATED: 'TO_CREATED',
  TO_CONFIRMED: 'TO_CONFIRMED',
  MIGO_POSTED: 'MIGO_POSTED',
  STOCK_VERIFIED: 'STOCK_VERIFIED',
  COMPLETED: 'COMPLETED',
  PARTIALLY_PROCESSED: 'PARTIALLY_PROCESSED',

  FAILED_RESERVATION: 'FAILED_RESERVATION',
  FAILED_TR: 'FAILED_TR',
  FAILED_TO: 'FAILED_TO',
  FAILED_CONFIRMATION: 'FAILED_CONFIRMATION',
  FAILED_MIGO: 'FAILED_MIGO',
  FAILED_STOCK_VERIFICATION: 'FAILED_STOCK_VERIFICATION'
});

module.exports = {
  STATUS,
  STATUS_TEXT,
  STATUS_CRITICALITY,
  STEP_ERROR,
  ERROR_STATUSES,
  UNCONFIRMED_TO,
  PROCESS_STATUS
};
