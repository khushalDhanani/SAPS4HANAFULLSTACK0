require('./live-sap-gate')();
'use strict';

const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });

const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));

(async () => {
  const rfc = new RfcClient();
  const results = {};

  console.log('=== FORENSIC INVESTIGATION OF SAP MESSAGE L3 866 (READ-ONLY) ===\n');

  // STEP 1: THE MESSAGE
  console.log('--- STEP 1: Reading T100 for L3 866 ---');
  const t100En = await rfc.readTable('T100', ['SPRSL', 'ARBGB', 'MSGNR', 'TEXT'], [
    `SPRSL = 'E'`,
    `AND ARBGB = 'L3'`,
    `AND MSGNR = '866'`
  ], 5);
  const t100De = await rfc.readTable('T100', ['SPRSL', 'ARBGB', 'MSGNR', 'TEXT'], [
    `SPRSL = 'D'`,
    `AND ARBGB = 'L3'`,
    `AND MSGNR = '866'`
  ], 5);
  results.t100En = t100En;
  results.t100De = t100De;
  console.log('T100 EN:', JSON.stringify(t100En));
  console.log('T100 DE:', JSON.stringify(t100De));

  // STEP 2: WHERE IT IS RAISED
  console.log('\n--- STEP 2: Finding where L3 866 is raised ---');
  // Query WBCROSSGT for L3 866 message references
  const wbcrossgtL3 = await rfc.readTable('WBCROSSGT', ['NAME', 'OTYPE', 'NAME', 'INCLUDE'], [
    `NAME LIKE 'L3%866%'`
  ], 20).catch(err => ({ error: err.message }));
  console.log('WBCROSSGT for L3 866:', JSON.stringify(wbcrossgtL3));

  // Also query cross references for table T319A
  const wbcrossgtT319A = await rfc.readTable('WBCROSSGT', ['NAME', 'OTYPE', 'INCLUDE'], [
    `NAME = 'T319A'`
  ], 30).catch(err => ({ error: err.message }));
  console.log('WBCROSSGT for T319A:', JSON.stringify(wbcrossgtT319A));

  // Let's also check table DOKTL / DOKIL for message documentation if any
  const dokil = await rfc.readTable('DOKIL', ['ID', 'OBJECT', 'LANGU', 'TYP'], [
    `ID = 'NA'`,
    `AND OBJECT LIKE 'L3866%'`
  ], 5).catch(err => ({ error: err.message }));
  console.log('DOKIL for L3866:', JSON.stringify(dokil));

  // STEP 3: THE TABLE AND ITS MAINTENANCE OBJECT
  console.log('\n--- STEP 3: Reading DD02L, DD03L, TVDIR, DD25L for T319A ---');
  const dd02l = await rfc.readTable('DD02L', ['TABNAME', 'TABCLASS', 'CONTFLAG', 'MAINFLAG'], [
    `TABNAME = 'T319A'`
  ], 1);
  console.log('DD02L T319A:', JSON.stringify(dd02l));

  const dd03l = await rfc.readTable('DD03L', ['TABNAME', 'FIELDNAME', 'KEYFLAG', 'ROLLNAME', 'CHECKTABLE', 'DATATYPE', 'LENG'], [
    `TABNAME = 'T319A'`
  ], 20);
  console.log('DD03L T319A fields:');
  console.table(dd03l);

  // TVDIR (Table View Directory)
  const tvdir = await rfc.readTable('TVDIR', ['TABNAME', 'BAUST', 'FLAG', 'FBNAME'], [
    `TABNAME = 'T319A'`,
    `OR TABNAME = 'V_T319A'`
  ], 10).catch(err => ({ error: err.message }));
  console.log('TVDIR for T319A / V_T319A:', JSON.stringify(tvdir));

  // DD25L (Views where T319A is used)
  const dd25l = await rfc.readTable('DD25L', ['VIEWNAME', 'ROOTTAB', 'VIEWCLASS'], [
    `ROOTTAB = 'T319A'`,
    `OR VIEWNAME = 'V_T319A'`
  ], 10).catch(err => ({ error: err.message }));
  console.log('DD25L Views for T319A:', JSON.stringify(dd25l));

  // OBJH / OBJS (Transport object definition for SM30)
  const objh = await rfc.readTable('OBJH', ['OBJECTNAME', 'OBJECTTYPE', 'OBJSUBTYPE'], [
    `OBJECTNAME = 'V_T319A'`,
    `OR OBJECTNAME = 'T319A'`
  ], 10).catch(err => ({ error: err.message }));
  console.log('OBJH for T319A / V_T319A:', JSON.stringify(objh));

  const objs = await rfc.readTable('OBJS', ['OBJECTNAME', 'OBJECTTYPE', 'TABLENAME'], [
    `OBJECTNAME = 'V_T319A'`,
    `OR OBJECTNAME = 'T319A'`
  ], 10).catch(err => ({ error: err.message }));
  console.log('OBJS for T319A / V_T319A:', JSON.stringify(objs));

  // STEP 4: PROVE THE FAILING VALUES
  console.log('\n--- STEP 4: Trace source of Z007, E1, and options in T307 ---');
  // Delivery item details
  const lips = await rfc.readTable('LIPS', ['VBELN', 'POSNR', 'MATNR', 'WERKS', 'LGORT', 'LFIMG', 'VRKME'], [
    `VBELN = '0080000134'`,
    `AND POSNR = '000010'`
  ], 1);
  console.log('LIPS item:', JSON.stringify(lips));

  // Handling Units on Delivery 0080000134
  const vepo = await rfc.readTable('VEPO', ['VENUM', 'VEPOS', 'VBELN', 'POSNR', 'MATNR', 'VEMNG', 'VEMEH'], [
    `VBELN = '0080000134'`
  ], 5);
  console.log('VEPO rows:', JSON.stringify(vepo));

  const venums = (vepo || []).map(v => v.VENUM).filter(Boolean);
  let vekp = [];
  if (venums.length) {
    const vekpWhere = venums.map(venum => `VENUM = '${venum}'`).join(' OR ');
    vekp = await rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHART', 'MAGRV', 'TARAG', 'MATNR'], [
      vekpWhere
    ], 5);
    console.log('VEKP rows:');
    console.table(vekp);
  }

  // Check packaging material master MARA
  const packMat = vekp?.[0]?.MATNR;
  console.log('Packaging material MATNR:', packMat);
  if (packMat) {
    const maraPack = await rfc.readTable('MARA', ['MATNR', 'MTART', 'MEINS', 'VHART', 'MAGRV'], [
      `MATNR = '${packMat}'`
    ], 1);
    console.log('MARA for packaging material:');
    console.table(maraPack);
  }

  // Check packaging material types table TVTY / TVTYT
  const tvty = await rfc.readTable('TVTY', ['VHART', 'TRTYP'], [
    `VHART = 'Z007'`
  ], 5).catch(err => ({ error: err.message }));
  console.log('TVTY for Z007:', JSON.stringify(tvty));

  const tvtyt = await rfc.readTable('TVTYT', ['SPRAS', 'VHART', 'VTEXT'], [
    `VHART = 'Z007'`
  ], 5).catch(err => ({ error: err.message }));
  console.log('TVTYT for Z007:', JSON.stringify(tvtyt));

  // Check T319A existing rows
  const t319aAll = await rfc.readTable('T319A', ['LGNUM', 'VHART', 'LETYP'], [
    `LGNUM = 'W01'`
  ], 20);
  console.log('All T319A rows for W01:');
  console.table(t319aAll);

  // Check T307 / T307T for valid Storage Unit Types in W01
  const t307 = await rfc.readTable('T307', ['LGNUM', 'LETYP'], [
    `LGNUM = 'W01'`
  ], 50);
  console.log('T307 SUTs in W01:');
  console.table(t307);

  const t307t = await rfc.readTable('T307T', ['SPRAS', 'LGNUM', 'LETYP', 'LTYPT'], [
    `SPRAS = 'E'`,
    `AND LGNUM = 'W01'`
  ], 50);
  console.log('T307T SUT descriptions in W01 (EN):');
  console.table(t307t);

  // STEP 5: ALTERNATIVES IN MASTER DATA
  console.log('\n--- STEP 5: Check master data on material 8000009754 and packaging material ---');
  const mlgn = await rfc.readTable('MLGN', ['MATNR', 'LGNUM', 'LETY1', 'LETY2', 'LETY3', 'LHMG1', 'LHMG2', 'LHMG3'], [
    `MATNR = '000000008000009754'`,
    `AND LGNUM = 'W01'`
  ], 5);
  console.log('MLGN for 8000009754:');
  console.table(mlgn);

  const marc = await rfc.readTable('MARC', ['MATNR', 'WERKS', 'SERNP', 'BWTTY'], [
    `MATNR = '000000008000009754'`,
    `AND WERKS = '1120'`
  ], 1);
  console.log('MARC for 8000009754:');
  console.table(marc);

  const mara = await rfc.readTable('MARA', ['MATNR', 'MTART', 'MAGRV', 'VHART'], [
    `MATNR = '000000008000009754'`
  ], 1);
  console.log('MARA for 8000009754:');
  console.table(mara);

})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
