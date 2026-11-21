/**
 * GoodsReceiptBapiErrorClassifier
 *
 * Helper to extract and classify SAP BAPI return errors for Movement 101 Goods Receipt.
 */

function bapiError(ret) {
  return [].concat(ret || []).find((r) => r && (r.TYPE === 'E' || r.TYPE === 'A'));
}

function classifyBapiError(err, targetDeliv, sItem, Material, Plant, StorageLocation) {
  let classifiedMsg = `SAP rejected Goods Receipt: [${err.ID} ${err.NUMBER}] ${err.MESSAGE}`;
  if (err.ID === 'HUDIALOG' && err.NUMBER === '018') {
    classifiedMsg = `Delivery status constraint: Inbound Delivery '${targetDeliv}' only allows display mode because Goods Receipt has already been completed (SAP message HUDIALOG 018).`;
  } else if (err.ID === 'VLBAPI' && err.NUMBER === '004') {
    classifiedMsg = `Quantity consistency check failed: The quantity for Inbound Delivery '${targetDeliv}' item '${sItem}' is inconsistent with putaway or packing status (SAP message VLBAPI 004).`;
  } else if (err.ID === 'VLMOVE' && err.NUMBER === '029') {
    classifiedMsg = `Putaway required: Inbound Delivery '${targetDeliv}' has not yet been put away in the warehouse (SAP message VLMOVE 029).`;
  } else if (err.ID === 'VL' && err.NUMBER === '608') {
    classifiedMsg = `Warehouse processing incomplete: Inbound Delivery '${targetDeliv}' has not yet been completely processed by WM (SAP message VL 608).`;
  } else if (err.ID === '12' && err.NUMBER === '008') {
    classifiedMsg = `Shelf life expiration date constraint: Material shelf life / expiration check failed (${err.MESSAGE || 'SLED validation failed'}, SAP message 12 008).`;
  } else if (err.ID === 'M7' && err.NUMBER === '006') {
    classifiedMsg = `Master data constraint: Material '${err.MESSAGE_V1 || Material}' is not maintained in plant '${err.MESSAGE_V2 || Plant}' storage location '${err.MESSAGE_V3 || StorageLocation}' (SAP message M7 006).`;
  } else if (err.ID === 'VLA' && err.NUMBER === '307') {
    classifiedMsg = `Putaway constraint: Putaway quantity cannot be less than GR posted quantity (SAP message VLA 307).`;
  } else if (err.ID === 'VLA' && err.NUMBER === '311') {
    classifiedMsg = `Packing constraint: Packing can only be updated via inbound delivery dialog (SAP message VLA 311).`;
  } else if (err.ID === 'VLA' && err.NUMBER === '317') {
    classifiedMsg = `Batch constraint: Batch must be assigned to delivery item (SAP message VLA 317).`;
  } else if (err.ID === 'BS' && err.NUMBER === '013') {
    classifiedMsg = `Serial number status constraint: Equipment status active (SAP message BS 013).`;
  } else if (err.ID === 'IO' && err.NUMBER === '206') {
    classifiedMsg = `Serial number constraint: Serial numbers required for material (SAP message IO 206).`;
  } else if (err.ID === 'M7' && err.NUMBER === '021') {
    classifiedMsg = `Quantity deficit: Stock / purchase order deficit (SAP message M7 021).`;
  }
  return classifiedMsg;
}

module.exports = {
  bapiError,
  classifyBapiError
};
