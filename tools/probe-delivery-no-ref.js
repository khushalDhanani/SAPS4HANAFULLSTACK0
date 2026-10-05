const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV';

async function testCombination(name, payload) {
  const client = new S4HttpClient();
  console.log(`\n======================================================`);
  console.log(`Testing: ${name}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await client.post(`${SERVICE_PATH}/C_DelivWthoutRefQuickCreate`, {
      data: payload
    });
    console.log(`\n>>> SUCCESS! HTTP ${res.status}`);
    const d = res.data?.d || res.data;
    console.log('Created Outbound Delivery Number:', d.OutboundDelivery);
    console.log('Response Details:', {
      OutboundDelivery: d.OutboundDelivery,
      ShippingPoint: d.ShippingPoint,
      DeliveryDocumentType: d.DeliveryDocumentType,
      PlannedGoodsIssueDate: d.PlannedGoodsIssueDate,
      Plant: d.Plant,
      StorageLocation: d.StorageLocation
    });

    // Step: Read back from SAP to prove persistence
    console.log(`\nVerifying readback for ${d.OutboundDelivery}...`);
    const readRes = await client.get(`${SERVICE_PATH}/C_DelivWthoutRefQuickCreate('${d.OutboundDelivery}')`);
    console.log('Readback Header verified:', readRes.data?.d?.OutboundDelivery);

    const itemsRes = await client.get(`${SERVICE_PATH}/C_DelivItmWthoutRefQuickCrte?$filter=OutboundDelivery eq '${d.OutboundDelivery}'`);
    const items = itemsRes.data?.d?.results || itemsRes.data?.results || [];
    console.log(`Readback Items (${items.length}):`, items.map(i => ({
      item: i.DeliveryDocumentItem,
      material: i.Material,
      qty: i.ActualDeliveryQuantity,
      uom: i.DeliveryQuantityUnit
    })));

    return { success: true, delivery: d.OutboundDelivery };
  } catch (err) {
    console.error(`>>> FAILED: HTTP ${err.status} - ${err.message}`);
    if (err.response?.data?.error) {
      console.error('SAP Error:', JSON.stringify(err.response.data.error, null, 2));
    }
    return { success: false, error: err.message };
  }
}

async function main() {
  const pgiDate = `/Date(${Date.now() + 86400000})/`;

  // Test 1: DeliveryDocumentType LO with Material 4000000182 in Plant 1120 / SP 1112
  await testCombination('1. LO - Plant 1120 - SP 1112 - Mat 4000000182', {
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
        Material: '4000000182',
        ActualDeliveryQuantity: '1.000',
        DeliveryQuantityUnit: 'KG'
      }
    ]
  });

  // Test 2: DeliveryDocumentType LO with Material 4000000184 in Plant 1120 / SP 1112
  await testCombination('2. LO - Plant 1120 - SP 1112 - Mat 4000000184', {
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
        Material: '4000000184',
        ActualDeliveryQuantity: '1.000',
        DeliveryQuantityUnit: 'KG'
      }
    ]
  });

  // Test 3: DeliveryDocumentType LO2 with Material 4000000182 in Plant 1120 / SP 1112
  await testCombination('3. LO2 - Plant 1120 - SP 1112 - Mat 4000000182', {
    ShippingPoint: '1112',
    DeliveryDocumentType: 'LO2',
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
        Material: '4000000182',
        ActualDeliveryQuantity: '1.000',
        DeliveryQuantityUnit: 'KG'
      }
    ]
  });
}

main().catch(console.error);
