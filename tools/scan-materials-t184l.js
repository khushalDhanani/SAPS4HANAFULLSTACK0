const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV';

async function testMaterial(mat, desc) {
  const client = new S4HttpClient();
  const pgiDate = `/Date(${Date.now() + 86400000})/`;
  const payload = {
    ShippingPoint: '1112',
    DeliveryDocumentType: 'LO',
    SalesOrganization: '1000',
    DistributionChannel: '10',
    Division: '52',
    ShipToParty: '10135',
    Plant: '1120',
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
    console.log(`[SUCCESS] Mat: ${mat} (${desc}) -> Delivery: ${res.data?.d?.OutboundDelivery}`);
    return { success: true, deliv: res.data?.d?.OutboundDelivery };
  } catch (err) {
    const sapErr = err.response?.data?.error?.message?.value || err.message;
    console.log(`[FAIL] Mat: ${mat} (${desc}) -> ${sapErr}`);
    return { success: false, error: sapErr };
  }
}

async function main() {
  const mats = [
    { mat: '4000000188', desc: '2CE - 220KG' },
    { mat: '4000000189', desc: '2CE - 50KG' },
    { mat: '4000000190', desc: '2CE - ISO Tank' },
    { mat: '4000000191', desc: '2CE - Bulk' },
    { mat: '4000000192', desc: 'BIFENTHRIN ALCOHOL' },
    { mat: '4000000186', desc: 'NODG 150 Kgs' },
    { mat: '4000000187', desc: 'NODG 50 Kgs' },
    { mat: '5000000003', desc: 'RESIDUE CEE' },
    { mat: '1000000972', desc: 'Sulfur Powder' },
    { mat: '8000004931', desc: 'Material 8000004931' },
    { mat: '0000000000DRAFT-15', desc: 'Polypropylene' },
    { mat: '8000002943', desc: 'Reactor SS304' }
  ];

  for (const m of mats) {
    await testMaterial(m.mat, m.desc);
  }
}

main().catch(console.error);
