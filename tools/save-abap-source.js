#!/usr/bin/env node
'use strict';
require('./live-sap-gate')();
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const base = (process.env.S4_DESTINATION_URL || '').replace(/\/sap\/opu\/odata.*$/i, '').replace(/\/$/, '');
const client = process.env.S4_CLIENT || '';
const auth = 'Basic ' + Buffer.from(`${process.env.S4_USERNAME}:${process.env.S4_PASSWORD}`).toString('base64');

async function run() {
  const url = `${base}/sap/bc/adt/programs/programs/ZRF_RES_HU_TRANSFER_DNR/source/main?sap-client=${client}`;
  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'text/plain' } });
  const text = await res.text();
  const dest = path.resolve(__dirname, '../docs/abap/zrf_res_hu_transfer_dnr.abap');
  fs.writeFileSync(dest, text, 'utf8');
  console.log('Saved ABAP source to:', dest);
  console.log('Bytes:', text.length, 'Lines:', text.split('\n').length);
}
run().catch(console.error);
