#!/usr/bin/env node
'use strict';
require('./live-sap-gate')();
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const base = (process.env.S4_DESTINATION_URL || '').replace(/\/sap\/opu\/odata.*$/i, '').replace(/\/$/, '');
const client = process.env.S4_CLIENT || '';
const auth = 'Basic ' + Buffer.from(`${process.env.S4_USERNAME}:${process.env.S4_PASSWORD}`).toString('base64');

async function get(urlPath, accept = 'text/plain') {
  const url = `${base}${urlPath}${urlPath.includes('?') ? '&' : '?'}sap-client=${client}`;
  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: accept
    }
  });
  console.log('Status:', res.status, 'for', urlPath);
  const text = await res.text();
  console.log('Length:', text.length);
  return { status: res.status, text };
}

(async () => {
  console.log('Fetching ADT source for ZRF_RES_HU_TRANSFER_DNR...');
  const paths = [
    '/sap/bc/adt/programs/programs/ZRF_RES_HU_TRANSFER_DNR/source/main',
    '/sap/bc/adt/programs/programs/ZRF_RES_HU_TRANSFER_DNR',
    '/sap/bc/adt/repository/nodestructure?parent_name=ZRF_RES_HU_TRANSFER_DNR&parent_type=PROG/P',
    '/sap/bc/adt/oo/classes/ZRF_RES_HU_TRANSFER_DNR/source/main'
  ];

  for (const p of paths) {
    const res = await get(p);
    if (res.status === 200) {
      console.log('=== SUCCESS FOR ' + p + ' ===');
      console.log(res.text);
      break;
    } else {
      console.log('Result snippet:', res.text.slice(0, 200));
    }
  }
})();
