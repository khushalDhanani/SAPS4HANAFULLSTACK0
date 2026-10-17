const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV';

async function testSp(sp, plant, mat, _desc) {
  const client = new S4HttpClient();
  const pgiDate = `/Date(${Date.now() + 86400000})/`;
  const payload = {
    ShippingPoint: sp,
    DeliveryDocumentType: 'LO',
    SalesOrganization: '1000',
    DistributionChannel: '10',
    Division: '52',
    ShipToParty: '10135',
    Plant: plant,
    StorageLocation: 'FG01',
    PlannedGoodsIssueDate: pgiDate,
    to_DeliveryItemQuickCreate: [
      {
        DeliveryDocumentItem: '000010',
        Material: mat,
        ActualDeliveryQuantity: '1.000',
        DeliveryQuantityUnit: 'KG'
      }
    ]
  };

  try {
    const res = await client.post(`${SERVICE_PATH}/C_DelivWthoutRefQuickCreate`, { data: payload });
    console.log(`[SUCCESS!!!] SP: ${sp}, Plant: ${plant}, Mat: ${mat} -> Delivery: ${res.data?.d?.OutboundDelivery}`);
    return true;
  } catch (err) {
    const sapErr = err.response?.data?.error?.message?.value || err.message;
    console.log(`[FAIL] SP: ${sp}, Plant: ${plant}, Mat: ${mat} -> ${sapErr}`);
    return false;
  }
}

async function main() {
  const spList = ['1105', '1106', '1107', '1108', '1109', '1110', '1111', '1112', '1101', '1102', '1103', '1104', '1113', '1120', '1130'];
  const mat = '4000000188';

  console.log('Testing SPs with Plant 1120:');
  for (const sp of spList) {
    const ok = await testSp(sp, '1120', mat, 'Plant 1120');
    if (ok) break;
  }

  console.log('\nTesting SPs with Plant 1130:');
  for (const sp of spList) {
    const ok = await testSp(sp, '1130', mat, 'Plant 1130');
    if (ok) break;
  }

  console.log('\nTesting SPs with Plant 1110:');
  for (const sp of spList) {
    const ok = await testSp(sp, '1110', mat, 'Plant 1110');
    if (ok) break;
  }
}

main().catch(console.error);
