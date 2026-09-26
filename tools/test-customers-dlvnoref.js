const path = require('path');
require('dotenv').config({ path: path.resolve('.env.local') });
require('dotenv').config({ path: path.resolve('.env') });

const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV';

async function testCustomer(cust, sp, mat) {
  const client = new S4HttpClient();
  const pgiDate = `/Date(${Date.now() + 86400000})/`;
  const payload = {
    ShippingPoint: sp,
    DeliveryDocumentType: 'LO',
    SalesOrganization: '1000',
    DistributionChannel: '10',
    Division: '52',
    ShipToParty: cust,
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
    console.log(`[SUCCESS!!!] Customer: ${cust}, SP: ${sp} -> Created Delivery: ${res.data?.d?.OutboundDelivery}`);
    return { success: true, deliv: res.data?.d?.OutboundDelivery };
  } catch (err) {
    const sapErr = err.response?.data?.error?.message?.value || err.message;
    console.log(`[FAIL] Cust: ${cust}, SP: ${sp} -> ${sapErr}`);
    return { success: false, error: sapErr };
  }
}

async function main() {
  const custs = [
    '10168', '10197', '10148', '10360', '100617',
    '10000', '10001', '10002', '10003', '10004',
    '10005', '10006', '10007', '10008', '10009', '10010',
    '10135', '10136', '10220', '10621', '10155', '10068'
  ];

  for (const c of custs) {
    const res = await testCustomer(c, '1112', '4000000188');
    if (res.success) return;
  }
}

main().catch(console.error);
