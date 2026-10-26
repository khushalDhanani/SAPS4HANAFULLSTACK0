#!/usr/bin/env node
'use strict';

/**
 * ONE movement-261 posting. This file is prepared only; it has not been run.
 *
 * WRITE GATE: refuses to start unless SAP_261_WRITTEN_GO exactly matches a written
 * user GO naming movement 261 and actual order, material, plant, SLoc, quantity, and
 * unit values. The script constructs the comparison from supplied values; placeholders,
 * samples, and partial authorization are rejected.
 *
 * Required values come from SAP_261_ORDER, SAP_261_MATERIAL, SAP_261_PLANT,
 * SAP_261_SLOC, SAP_261_QUANTITY, SAP_261_UNIT. The script then READ-ONLY resolves
 * exactly one matching open component and revalidates it before the single SAP POST.
 * Do not run until the user supplies the complete written GO and selects a candidate.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local'), quiet: true });

const fields = {
  order: String(process.env.SAP_261_ORDER || '').trim(),
  material: String(process.env.SAP_261_MATERIAL || '').trim(),
  plant: String(process.env.SAP_261_PLANT || '').trim(),
  sloc: String(process.env.SAP_261_SLOC || '').trim(),
  quantity: String(process.env.SAP_261_QUANTITY || '').trim(),
  unit: String(process.env.SAP_261_UNIT || '').trim()
};
const go = String(process.env.SAP_261_WRITTEN_GO || '').trim();
const placeholder = /(?:<|>|\[|\]|_{3,}|\b(?:yours|placeholder|sample|todo)\b|x{5,})/i;
const missing = Object.entries(fields).filter(([, value]) => !value || placeholder.test(value)).map(([name]) => name);

if (missing.length) {
  throw new Error(`261 WRITE GATE CLOSED: actual non-placeholder values are required for ${missing.join(', ')}.`);
}
if (!/^\d{1,12}$/.test(fields.order) || !/^[A-Z0-9][A-Z0-9_./-]{0,39}$/i.test(fields.material) ||
    !/^[A-Z0-9]{1,4}$/i.test(fields.plant) || !/^[A-Z0-9]{1,4}$/i.test(fields.sloc) ||
    !(Number(fields.quantity) > 0) || !/^[A-Z0-9]{1,6}$/i.test(fields.unit)) {
  throw new Error('261 WRITE GATE CLOSED: one or more supplied fields are invalid.');
}
const expectedGo = `GO movement=261 order=${fields.order} material=${fields.material} plant=${fields.plant} sloc=${fields.sloc} quantity=${fields.quantity} unit=${fields.unit}`;
if (go !== expectedGo) {
  throw new Error('261 WRITE GATE CLOSED: SAP_261_WRITTEN_GO must exactly match the user\'s written GO and all six supplied values.');
}

// Dependencies are loaded only after the exact written GO passes.
const Mvt261Adapter = require('../srv/integration/s4hana/wm/Mvt261Adapter');

async function main() {
  const adapter = new Mvt261Adapter();
  console.log('READ-ONLY: resolving one open 261 component matching the approved order/material/plant/SLoc/unit.');
  const list = await adapter.openItems({
    productionOrder: fields.order,
    material: fields.material,
    plant: fields.plant
  });
  const matches = (list.Items || []).filter((item) =>
    String(item.ProductionOrder || '').replace(/^0+(?=.)/, '') === fields.order.replace(/^0+(?=.)/, '') &&
    String(item.Material || '').replace(/^0+(?=.)/, '') === fields.material.replace(/^0+(?=.)/, '') &&
    String(item.Plant || '').trim() === fields.plant &&
    String(item.StorageLocation || '').trim() === fields.sloc &&
    String(item.Unit || '').trim() === fields.unit &&
    Number(item.OpenQuantity) >= Number(fields.quantity) &&
    item.MovementAllowed && !item.Blocked && !item.Backflush &&
    String(item.OrderStatus || '').split(/\s+/).includes('REL'));
  if (matches.length !== 1) {
    throw new Error(`261 WRITE GATE CLOSED: expected exactly one matching open component; SAP returned ${matches.length}.`);
  }

  const item = matches[0];
  console.log('READ-ONLY: re-reading the selected reservation component and order status before posting.');
  const cycle = await adapter.cycle({ reservation: item.Reservation, item: item.ReservationItem });
  const exact = cycle.ProductionOrder.replace(/^0+(?=.)/, '') === fields.order.replace(/^0+(?=.)/, '') &&
    cycle.Material.replace(/^0+(?=.)/, '') === fields.material.replace(/^0+(?=.)/, '') &&
    cycle.Plant === fields.plant && cycle.StorageLocation === fields.sloc && cycle.Unit === fields.unit &&
    Number(cycle.OpenQuantity) >= Number(fields.quantity) && cycle.OrderType;
  if (!exact) throw new Error('261 WRITE GATE CLOSED: the fresh SAP component no longer matches every approved field.');

  // Exactly one application call to the verified 261 adapter; no retry or reversal is issued here.
  const result = await adapter.postGoodsIssue({
    movementType: '261',
    orderId: fields.order,
    orderType: cycle.OrderType,
    reservation: item.Reservation,
    item: item.ReservationItem,
    material: fields.material,
    plant: fields.plant,
    storageLocation: fields.sloc,
    quantity: Number(fields.quantity),
    unit: fields.unit,
    batch: cycle.Batch || ''
  });
  console.log(JSON.stringify({ movementType: '261', result }, null, 2));
}

main().catch((error) => {
  console.error(`261 posting stopped: ${error.message}`);
  process.exitCode = 1;
});
