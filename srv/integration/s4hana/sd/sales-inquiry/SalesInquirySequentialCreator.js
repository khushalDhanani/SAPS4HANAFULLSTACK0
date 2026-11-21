const businessConfigResolver = require('../../../../common/BusinessConfigResolver');
const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const s4Config = require('../../s4Config');
const { PartialSalesInquiryError } = require('./PartialSalesInquiryError');
const { INQUIRY_EXTENSION_FIELDS } = require('./salesInquiryODataHelper');
const { validateItems } = require('./SalesOrderDocumentCreator');

async function createSalesInquiryDocument(adapter, effectiveDocType, header, items, options = {}) {
  const destination = options.destination || await adapter._getDestination(options);
  const servicePath = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
  const executeFn = options.executeHttpRequest || adapter.client._execute;

  const custRef = (header.PurchaseOrderNumber || header.PurchaseOrderByCustomer)
    ? String(header.PurchaseOrderNumber || header.PurchaseOrderByCustomer).trim()
    : '';

  validateItems(items);

  // 1. Post Header to LORD_ODATA_ORDER_SRV/HeaderSet
  if (!header.SalesOrganization || String(header.SalesOrganization).trim() === '') {
    throw new Error('SalesOrganization is required for Sales Inquiry creation');
  }
  if (!header.DistributionChannel || String(header.DistributionChannel).trim() === '') {
    throw new Error('DistributionChannel is required for Sales Inquiry creation');
  }
  const inquiryDivision = header.OrganizationDivision || header.Division;
  if (!inquiryDivision || String(inquiryDivision).trim() === '') {
    throw new Error('Division is required for Sales Inquiry creation');
  }

  const headerPayload = {
    SalesOrderTypeCode: effectiveDocType,
    SalesOrganization: String(header.SalesOrganization).trim(),
    DistributionChannel: String(header.DistributionChannel).trim(),
    Division: String(inquiryDivision).trim(),
    SoldToPartyID: header.SoldToParty || '',
    PurchaseOrderNumber: custRef
  };

  const inquiryPartners = [];
  if (header.ShipToParty && String(header.ShipToParty).trim() !== '') {
    inquiryPartners.push({
      PartnerFunctionCode: 'SH',
      CustomerID: String(header.ShipToParty).trim()
    });
  }

  if (header.ContactPerson && String(header.ContactPerson).trim() !== '') {
    const sContactPerson = String(header.ContactPerson).trim();
    const fields = await adapter._getLeanOrderFields(destination, executeFn);
    if (fields.header.has('ContactPerson')) {
      headerPayload.ContactPerson = sContactPerson;
    } else if (fields.partner && (fields.partner.has('CustomerID') || fields.partner.has('ContactPersonID'))) {
      const cpEntry = {
        PartnerFunctionCode: 'ZP',
        CustomerID: sContactPerson
      };
      if (fields.partner.has('ContactPersonID')) {
        cpEntry.ContactPersonID = sContactPerson;
      }
      inquiryPartners.push(cpEntry);
    } else {
      const err = new Error('Contact Person is not supported by the SAP backend service (LORD_ODATA_ORDER_SRV HeaderSet metadata has no ContactPerson property and HeaderPartnerSet has no CustomerID property). Maintain Contact Person directly in SAP.');
      err.status = 400;
      throw err;
    }
  }

  if (inquiryPartners.length > 0) {
    headerPayload.HeaderPartnerSet = inquiryPartners;
  }

  const notTransmitted = [];
  const provided = INQUIRY_EXTENSION_FIELDS
    .filter(f => f !== 'ContactPerson')
    .filter(f => String(header[f] ?? '').trim() !== '');
  if (provided.length > 0) {
    const fields = await adapter._getLeanOrderFields(destination, executeFn);
    for (const f of provided) {
      if (fields.header.has(f)) headerPayload[f] = String(header[f]).trim();
      else notTransmitted.push(f);
    }
    if (notTransmitted.length > 0) {
      LOG.warn(`LORD_ODATA_ORDER_SRV has no field for ${notTransmitted.join(', ')};`
        + ' the inquiry will stay incomplete until these are maintained directly in SAP or the service is extended.');
    }
  }

  let headerResp;
  try {
    headerResp = await executeFn(destination, {
      method: 'post',
      url: `${servicePath}/HeaderSet`,
      data: headerPayload,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
  } catch (headerErr) {
    const sapMsg = headerErr.response?.data?.error?.message?.value ||
      headerErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
      headerErr.message;
    LOG.error('Failed to create Sales Inquiry header in S/4HANA:', sapMsg);
    throw new Error(sapMsg);
  }

  const sNewInquiryId = headerResp.data?.d?.SalesOrderID || headerResp.data?.SalesOrderID;
  if (!sNewInquiryId) {
    throw new Error('Sales Inquiry number not returned from SAP S/4HANA');
  }

  // 2. Post line items sequentially to LORD_ODATA_ORDER_SRV/HeaderSet('<SalesOrderID>')/ItemSet
  if (Array.isArray(items) && items.length > 0) {
    for (let idx = 0; idx < items.length; idx++) {
      const itm = items[idx];
      const qty = parseFloat(itm.OrderQuantity);
      const price = parseFloat(itm.NetPriceAmount) || 0;
      const net = itm.NetAmount !== undefined && itm.NetAmount !== null ? parseFloat(itm.NetAmount) : (qty * price);

      const lineNum = itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
      const resolvedMaterial = await adapter.resolveMaterial(itm.Material);

      const itemUnit = itm.OrderQuantityUnit || itm.SalesUnit || itm.UnitOfMeasure || itm.BaseUnit;
      if (!itemUnit || !String(itemUnit).trim()) {
        throw new Error(`Order quantity unit (SalesUnit) is required for item ${lineNum}`);
      }
      const cleanItemUnit = String(itemUnit).trim().toUpperCase();

      const itemPayload = {
        SalesOrderID: sNewInquiryId,
        ItemID: lineNum,
        MaterialID: resolvedMaterial || itm.Material || '',
        OrderQty: String(qty.toFixed(3)),
        SalesUnit: cleanItemUnit
      };
      if (itm.Plant && String(itm.Plant).trim() !== '') {
        itemPayload.Plant = String(itm.Plant).trim().toUpperCase();
      }

      try {
        await executeFn(destination, {
          method: 'post',
          url: `${servicePath}/HeaderSet(%27${sNewInquiryId}%27)/ItemSet`,
          data: itemPayload,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
      } catch (itemErr) {
        const itemSapMsg = itemErr.response?.data?.error?.message?.value ||
          itemErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
          itemErr.message;
        LOG.error(`Failed to create item ${itemPayload.ItemID} for inquiry ${sNewInquiryId}:`, itemSapMsg);
        throw new PartialSalesInquiryError(
          `Sales Inquiry ${sNewInquiryId} was created in SAP S/4HANA, but adding item ${lineNum} failed: ${itemSapMsg}. Do not retry: check or complete inquiry ${sNewInquiryId} in SAP.`,
          sNewInquiryId,
          {
            step: 'ItemSet',
            itemNumber: lineNum,
            sapMessage: itemSapMsg,
            originalError: itemErr,
            status: itemErr.response?.status || 502
          }
        );
      }

      // 3. Post price condition (ZPR1)
      const effectivePrice = price > 0 ? price : (qty > 0 && net > 0 ? (net / qty) : 0);
      if (effectivePrice > 0) {
        let condType = 'ZPR1';
        try {
          if (typeof s4Config.getConditionType === 'function') {
            condType = s4Config.getConditionType();
          } else {
            const cfg = await (adapter.resolver || businessConfigResolver).resolve({
              plant: header.Plant || '1120',
              flow: 'sd',
              fields: ['conditionType'],
              isTrusted: true
            });
            condType = cfg.conditionType || 'ZPR1';
          }
        } catch (_) {
          condType = 'ZPR1';
        }
        const condPayload = {
          SalesOrderID: sNewInquiryId,
          ItemID: lineNum,
          CondTypeCode: condType,
          AmountInternal: String(effectivePrice.toFixed(2)),
          RateUnitExternal: header.TransactionCurrency || 'INR',
          PriceUnit: '1.000',
          UnitOfMeasure: cleanItemUnit
        };

        try {
          await executeFn(destination, {
            method: 'post',
            url: `${servicePath}/HeaderSet(%27${sNewInquiryId}%27)/PriceCondSet`,
            data: condPayload,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              ...(options.headers || {})
            }
          }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
        } catch (condErr) {
          const condSapMsg = condErr.response?.data?.error?.message?.value ||
            condErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
            condErr.message;
          LOG.error(`Failed to set price condition for item ${lineNum}:`, condSapMsg);
          throw new PartialSalesInquiryError(
            `Sales Inquiry ${sNewInquiryId} was created in SAP S/4HANA with items, but adding price condition for item ${lineNum} failed: ${condSapMsg}. Do not retry: check or complete inquiry ${sNewInquiryId} in SAP.`,
            sNewInquiryId,
            {
              step: 'PriceCondSet',
              itemNumber: lineNum,
              sapMessage: condSapMsg,
              originalError: condErr,
              status: condErr.response?.status || 502
            }
          );
        }
      }
    }
  }

  let s4Header = headerResp.data?.d || headerResp.data || {};
  let totalsFromReadBack = false;

  if (options.readBack !== false) {
    try {
      const readResp = await executeFn(destination, {
        method: 'get',
        url: `${servicePath}/HeaderSet(%27${sNewInquiryId}%27)`,
        headers: {
          'Accept': 'application/json',
          ...(options.headers || {})
        }
      }, { fetchCsrfToken: false });
      if (readResp?.data?.d || readResp?.data) {
        s4Header = readResp.data?.d || readResp.data;
        totalsFromReadBack = true;
      }
    } catch (readErr) {
      LOG.warn(`Could not read back header totals for inquiry ${sNewInquiryId}:`, readErr.message);
    }
  }

  const sapNet = totalsFromReadBack ? s4Header.NetAmount : undefined;
  const sapTotal = totalsFromReadBack ? s4Header.TotalAmount : undefined;
  const sapTax = totalsFromReadBack ? s4Header.TaxAmount : undefined;
  const sapCurrency = s4Header.DocumentCurrency || '';

  const finalNet = (sapNet !== undefined && sapNet !== null && String(sapNet).trim() !== '') ? String(sapNet) : '';

  return {
    SalesDocument: sNewInquiryId,
    SalesOrderID: sNewInquiryId,
    SalesInquiry: sNewInquiryId,
    SalesOrder: sNewInquiryId,
    TotalNetAmount: finalNet,
    NetAmount: finalNet || undefined,
    TotalAmount: sapTotal !== undefined && sapTotal !== null ? String(sapTotal) : undefined,
    TaxAmount: sapTax !== undefined && sapTax !== null ? String(sapTax) : undefined,
    TransactionCurrency: sapCurrency,
    notTransmitted
  };
}

module.exports = {
  createSalesInquiryDocument
};
