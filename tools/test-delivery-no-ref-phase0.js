const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV';

async function main() {
  const client = new S4HttpClient();

  console.log('=== Step 1: Query Value Helps from LE_SHP_QC_DLVNOREF_SRV ===');
  
  // 1. Delivery Types
  try {
    const dtRes = await client.get(`${SERVICE_PATH}/C_DelivTypeNoRefVH`);
    const dt = dtRes.data?.d?.results || dtRes.data?.results || [];
    console.log('Supported Delivery Types without Reference:', dt.map(x => ({ type: x.DeliveryDocumentType, desc: x.DeliveryDocumentTypeName })));
  } catch (e) {
    console.error('Error fetching C_DelivTypeNoRefVH:', e.message);
  }

  // 2. Shipping Points
  try {
    const spRes = await client.get(`${SERVICE_PATH}/C_ShippingPointVH?$top=10`);
    const sp = spRes.data?.d?.results || spRes.data?.results || [];
    console.log('Shipping Points (first 10):', sp.map(x => ({ sp: x.ShippingPoint, desc: x.ShippingPoint_Text })));
  } catch (e) {
    console.error('Error fetching C_ShippingPointVH:', e.message);
  }

  // 3. Sales Org & Division
  try {
    const orgRes = await client.get(`${SERVICE_PATH}/C_OrgDivisionValueHelp?$top=10`);
    const org = orgRes.data?.d?.results || orgRes.data?.results || [];
    console.log('Org / Div (first 10):', org.map(x => ({ salesOrg: x.SalesOrganization, distCh: x.DistributionChannel, div: x.Division, desc: x.DivisionName })));
  } catch (e) {
    console.error('Error fetching C_OrgDivisionValueHelp:', e.message);
  }

  // 4. Ship-To Parties
  try {
    const stRes = await client.get(`${SERVICE_PATH}/C_DeliveryShipToPartyVH?$top=5`);
    const st = stRes.data?.d?.results || stRes.data?.results || [];
    console.log('Ship-To Parties (first 5):', st.map(x => ({ customer: x.Customer, name: x.CustomerName })));
  } catch (e) {
    console.error('Error fetching C_DeliveryShipToPartyVH:', e.message);
  }

  // 5. Materials
  try {
    const matRes = await client.get(`${SERVICE_PATH}/C_Materialvaluehelp?$top=10`);
    const mats = matRes.data?.d?.results || matRes.data?.results || [];
    console.log('Materials (first 10):', mats.map(x => ({ mat: x.Material, text: x.Material_Text, type: x.MaterialType, uom: x.MaterialBaseUnit })));
  } catch (e) {
    console.error('Error fetching C_Materialvaluehelp:', e.message);
  }
}

main().catch(console.error);
