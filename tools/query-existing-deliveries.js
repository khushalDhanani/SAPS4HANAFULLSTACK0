const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');

async function main() {
  const client = new S4HttpClient();

  console.log('=== Checking recent deliveries in LE_SHP_OD_LIST_SRV ===');
  try {
    const res = await client.get('/sap/opu/odata/sap/LE_SHP_OD_LIST_SRV/C_OutboundDeliveryItem?$top=5&$select=OutboundDelivery,DeliveryDocumentItem,Material,Plant,StorageLocation,ActualDeliveryQuantity,DeliveryQuantityUnit');
    const items = res.data?.d?.results || res.data?.results || [];
    console.log('Recent Delivery Items from LE_SHP_OD_LIST_SRV:', items);
  } catch (e) {
    console.log('LE_SHP_OD_LIST_SRV query failed:', e.message);
  }

  console.log('\n=== Checking recent delivery headers in LE_SHP_OD_LIST_SRV ===');
  try {
    const res = await client.get('/sap/opu/odata/sap/LE_SHP_OD_LIST_SRV/C_OutboundDeliveryHeader?$top=5&$select=OutboundDelivery,DeliveryDocumentType,ShippingPoint,SalesOrganization,DistributionChannel,Division,ShipToParty');
    const headers = res.data?.d?.results || res.data?.results || [];
    console.log('Recent Delivery Headers:', headers);
  } catch (e) {
    console.log('LE_SHP_OD_LIST_SRV header query failed:', e.message);
  }

  console.log('\n=== Checking C_DelivWthoutRefQuickCreate in LE_SHP_QC_DLVNOREF_SRV ===');
  try {
    const res = await client.get('/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV/C_DelivWthoutRefQuickCreate?$top=5');
    const items = res.data?.d?.results || res.data?.results || [];
    console.log('Existing C_DelivWthoutRefQuickCreate:', items);
  } catch (e) {
    console.log('C_DelivWthoutRefQuickCreate query failed:', e.message);
  }

  console.log('\n=== Checking C_DelivItmWthoutRefQuickCrte in LE_SHP_QC_DLVNOREF_SRV ===');
  try {
    const res = await client.get('/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV/C_DelivItmWthoutRefQuickCrte?$top=5');
    const items = res.data?.d?.results || res.data?.results || [];
    console.log('Existing C_DelivItmWthoutRefQuickCrte:', items);
  } catch (e) {
    console.log('C_DelivItmWthoutRefQuickCrte query failed:', e.message);
  }
}

main().catch(console.error);
