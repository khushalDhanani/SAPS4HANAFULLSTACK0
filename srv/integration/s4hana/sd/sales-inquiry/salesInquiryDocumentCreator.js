const businessConfigResolver = require('../../../../common/BusinessConfigResolver');
const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const { unansweredWrite } = require('../../S4HttpClient');
const { SalesInquiryRfcCreator, BAPI: INQUIRY_BAPI, UNSUPPORTED_HEADER_FIELDS } = require('./SalesInquiryRfcCreator');
const s4Config = require('../../s4Config');
const { PartialSalesInquiryError } = require('./PartialSalesInquiryError');
const { LEAN_ORDER_PATH, INQUIRY_EXTENSION_FIELDS, _formatODataV2Date, _formatODataV2Literal } = require('./salesInquiryODataHelper');

async function createSalesDocument(adapter, docType, header, items, options = {}) {
    const destination = options.destination || await adapter._getDestination(options);
    const servicePath = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
    const executeFn = options.executeHttpRequest || adapter.client._execute;

    const custRef = (header.PurchaseOrderNumber || header.PurchaseOrderByCustomer)
      ? String(header.PurchaseOrderNumber || header.PurchaseOrderByCustomer).trim()
      : '';
    const effectiveDocType = String(docType || header.SalesOrderType || header.SalesInquiryType || '').trim();
    if (!effectiveDocType) {
      throw new Error('Document Type is required for Sales Document creation');
    }
    const isOrder = effectiveDocType !== 'ZIN';

    // Upfront item unit and quantity validation for all document types
    if (Array.isArray(items) && items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const itm = items[idx];
        const lineNum = itm.SalesOrderItem || itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
        const itemUnit = itm.OrderQuantityUnit || itm.SalesUnit || itm.UnitOfMeasure || itm.BaseUnit;
        if (!itemUnit || !String(itemUnit).trim()) {
          throw new Error(`Order quantity unit (SalesUnit) is required for item ${lineNum}`);
        }
        if (itm.OrderQuantity === undefined || itm.OrderQuantity === null || String(itm.OrderQuantity).trim() === '') {
          throw new Error(`OrderQuantity is required for item ${lineNum}`);
        }
        const qty = parseFloat(itm.OrderQuantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`OrderQuantity must be greater than 0 for item ${lineNum}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Order Branch: OData Deep Insert
    // -------------------------------------------------------------------------
    if (isOrder) {
      const deepItems = [];

      if (Array.isArray(items) && items.length > 0) {
        for (let idx = 0; idx < items.length; idx++) {
          const itm = items[idx];
          const qty = parseFloat(itm.OrderQuantity);
          const price = parseFloat(itm.NetPriceAmount) || 0;
          const net = itm.NetAmount !== undefined && itm.NetAmount !== null ? parseFloat(itm.NetAmount) : (qty * price);

          const _lineNum = itm.SalesOrderItem || itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
          const resolvedMaterial = await adapter.resolveMaterial(itm.Material);

          const itemUnit = itm.OrderQuantityUnit || itm.SalesUnit || itm.UnitOfMeasure || itm.BaseUnit;
          if (!itemUnit || !String(itemUnit).trim()) {
            throw new Error(`Order quantity unit (SalesUnit) is required for item ${_lineNum}`);
          }
          const cleanItemUnit = String(itemUnit).trim().toUpperCase();

          const itemDesc = itm.SalesOrderItemText || itm.ItemDescr;
          const itemObj = {
            MaterialID: resolvedMaterial || itm.Material || '',
            OrderQty: String(qty.toFixed(3)),
            SalesUnit: cleanItemUnit
          };
          if (itemDesc && String(itemDesc).trim() !== '') {
            itemObj.ItemDescr = String(itemDesc).trim();
          }
          if (itm.Plant && String(itm.Plant).trim() !== '') {
            itemObj.Plant = String(itm.Plant).trim().toUpperCase();
          }
          if (itm.RequestedDeliveryDate) {
            const formattedDate = _formatODataV2Date(itm.RequestedDeliveryDate);
            if (formattedDate) itemObj.RequestedDeliveryDate = formattedDate;
          }

          const effectivePrice = price > 0 ? price : (qty > 0 && net > 0 ? (net / qty) : 0);
          if (effectivePrice > 0) {
            let condType = 'ZPR1';
            try {
              if (typeof s4Config.getConditionType === 'function') {
                condType = s4Config.getConditionType();
              } else {
                const cfg = await (this.resolver || businessConfigResolver).resolve({
                  plant: itm.Plant || header.Plant || '1120',
                  flow: 'sd',
                  fields: ['conditionType'],
                  isTrusted: true
                });
                condType = cfg.conditionType || 'ZPR1';
              }
            } catch (_) {
              condType = 'ZPR1';
            }
            itemObj.PriceCondSet = [
              {
                CondTypeCode: condType,
                AmountInternal: String(effectivePrice.toFixed(2)),
                RateUnitExternal: header.TransactionCurrency ? String(header.TransactionCurrency).trim().toUpperCase() : '',
                PriceUnit: '1.000',
                UnitOfMeasure: cleanItemUnit
              }
            ];
          }
          deepItems.push(itemObj);
        }
      }

      if (!header.SalesOrganization || String(header.SalesOrganization).trim() === '') {
        throw new Error('SalesOrganization is required for Sales Order creation');
      }
      if (!header.DistributionChannel || String(header.DistributionChannel).trim() === '') {
        throw new Error('DistributionChannel is required for Sales Order creation');
      }
      const orderDivision = header.OrganizationDivision || header.Division;
      if (!orderDivision || String(orderDivision).trim() === '') {
        throw new Error('Division is required for Sales Order creation');
      }

      const headerPayload = {
        SalesOrderTypeCode: effectiveDocType,
        SalesOrganization: String(header.SalesOrganization).trim(),
        DistributionChannel: String(header.DistributionChannel).trim(),
        Division: String(orderDivision).trim(),
        SoldToPartyID: header.SoldToParty || '',
        PurchaseOrderNumber: custRef,
        ItemSet: deepItems
      };
      const poDate = header.PurchaseOrderDate || header.CustomerPurchaseOrderDate;
      if (poDate) {
        const formattedPoDate = _formatODataV2Date(poDate);
        if (formattedPoDate) headerPayload.PurchaseOrderDate = formattedPoDate;
      }
      if (header.RequestedDeliveryDate) {
        const formattedHdrDate = _formatODataV2Date(header.RequestedDeliveryDate);
        if (formattedHdrDate) headerPayload.RequestedDeliveryDate = formattedHdrDate;
      }
      const payTerms = header.PaymentTerms || header.PaymentTermCode;
      if (payTerms && String(payTerms).trim() !== '') {
        headerPayload.PaymentTermCode = String(payTerms).trim();
      }
      // Collect Header Partners
      const headerPartners = [];
      if (header.ShipToParty && String(header.ShipToParty).trim() !== '') {
        headerPartners.push({
          PartnerFunctionCode: 'SH',
          CustomerID: String(header.ShipToParty).trim()
        });
      }

      // Contact Person: send through the path $metadata supports:
      // 1. Header property if Header has ContactPerson
      // 2. HeaderPartnerSet entry with PartnerFunctionCode 'ZP' and CustomerID if HeaderPartner has CustomerID
      // 3. Otherwise fail with a visible error.
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
          headerPartners.push(cpEntry);
        } else {
          const err = new Error('Contact Person is not supported by the SAP backend service (LORD_ODATA_ORDER_SRV HeaderSet metadata has no ContactPerson property and HeaderPartnerSet has no CustomerID property). Maintain Contact Person directly in SAP.');
          err.status = 400;
          throw err;
        }
      }

      if (headerPartners.length > 0) {
        headerPayload.HeaderPartnerSet = headerPartners;
      }

      // Extension fields: only those the service exposes can be transmitted
      const notTransmitted = [];
      const providedExt = INQUIRY_EXTENSION_FIELDS
        .filter(f => f !== 'ContactPerson')
        .filter(f => String(header[f] ?? '').trim() !== '');
      if (providedExt.length > 0) {
        const fields = await adapter._getLeanOrderFields(destination, executeFn);
        for (const f of providedExt) {
          if (fields.header.has(f)) headerPayload[f] = String(header[f]).trim();
          else notTransmitted.push(f);
        }
        if (notTransmitted.length > 0) {
          LOG.warn(`LORD_ODATA_ORDER_SRV has no field for ${notTransmitted.join(', ')};`
            + ' the sales order will stay incomplete until these are maintained directly in SAP or the service is extended.');
        }
      }

      let createResp;
      try {
        createResp = await executeFn(destination, {
          method: 'post',
          url: `${servicePath}/HeaderSet`,
          data: headerPayload,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
      } catch (orderErr) {
        const unanswered = unansweredWrite(orderErr);
        if (unanswered) throw unanswered;
        const sapMsg = orderErr.response?.data?.error?.message?.value ||
          orderErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
          orderErr.message;
        LOG.error('Failed to create Sales Order in S/4HANA:', sapMsg);
        const err = new Error(sapMsg);
        err.status = orderErr.response?.status || 502;
        throw err;
      }

      const sNewOrderId = createResp.data?.d?.SalesOrderID || createResp.data?.SalesOrderID;
      if (!sNewOrderId) {
        throw new Error('Sales Order number not returned from SAP S/4HANA');
      }

      // Read-back verification from SAP
      let s4Header = createResp.data?.d || createResp.data || {};
      if (options.readBack !== false) {
        let readHeader = {};
        let readPartners = [];
        try {
          const readResp = await executeFn(destination, {
            method: 'get',
            url: `${servicePath}/HeaderSet(%27${sNewOrderId}%27)?$expand=HeaderPartnerSet`,
            headers: {
              'Accept': 'application/json',
              ...(options.headers || {})
            }
          }, { fetchCsrfToken: false });
          if (readResp?.data?.d || readResp?.data) {
            readHeader = readResp.data?.d || readResp.data;
            s4Header = readHeader;
            readPartners = readHeader.HeaderPartnerSet?.results || (Array.isArray(readHeader.HeaderPartnerSet) ? readHeader.HeaderPartnerSet : []);
          }
        } catch (readErr) {
          LOG.warn(`Could not read back HeaderSet for order ${sNewOrderId}:`, readErr.message);
        }

        // Confirm the two header values the service can carry; a mismatch is reported as an error.
        const mismatches = [];

        // 1. Payment Terms
        const expPayTerms = String(header.PaymentTerms || header.PaymentTermCode || '').trim();
        if (expPayTerms) {
          const actualPayTerms = String(readHeader.PaymentTermCode || readHeader.PaymentTerms || '').trim();
          if (actualPayTerms && actualPayTerms !== expPayTerms) {
            mismatches.push(`Payment Terms expected '${expPayTerms}' but found '${actualPayTerms}'`);
          }
        }

        // 2. Contact Person: Header property when the service has one, otherwise HeaderPartnerSet 'ZP' / 'CP'
        const expContact = String(header.ContactPerson || '').trim();
        if (expContact) {
          const actualContact = String(readHeader.ContactPerson || '').trim();
          const noZeros = (v) => String(v || '').trim().replace(/^0+/, '');
          const partnerMatch = readPartners.some(p =>
            (!p.PartnerFunctionCode || p.PartnerFunctionCode === 'ZP' || p.PartnerFunctionCode === 'CP') &&
            [p.CustomerID, p.PartnerNumber, p.ContactPersonID].some(v => noZeros(v) !== '' && noZeros(v) === noZeros(expContact)));
          if (actualContact) {
            if (actualContact !== expContact) {
              mismatches.push(`Contact Person expected '${expContact}' but found '${actualContact}'`);
            }
          } else if (!partnerMatch && readPartners.length > 0) {
            mismatches.push(`Contact Person expected '${expContact}' but not found in order partners`);
          }
        }

        if (mismatches.length > 0) {
          const mismatchErr = new Error(`Sales Order ${sNewOrderId} created, but read-back verification failed: ${mismatches.join('; ')}`);
          mismatchErr.status = 502;
          mismatchErr.SalesOrder = sNewOrderId;
          mismatchErr.mismatches = mismatches;
          throw mismatchErr;
        }
      }

      // HeaderSet (LORD_ODATA_ORDER_SRV) carries NetAmount, TotalAmount, TaxAmount, DocumentCurrency — nothing else, nothing computed.
      const sapNet = s4Header.NetAmount;
      const sapTotal = s4Header.TotalAmount;
      const sapTax = s4Header.TaxAmount;
      const sapCurrency = s4Header.DocumentCurrency || '';

      const finalNet = (sapNet !== undefined && sapNet !== null && String(sapNet).trim() !== '') ? String(sapNet) : '';

      return {
        SalesDocument: sNewOrderId,
        SalesOrderID: sNewOrderId,
        SalesOrder: sNewOrderId,
        SalesInquiry: sNewOrderId,
        TotalNetAmount: finalNet,
        NetAmount: finalNet || undefined,
        TotalAmount: sapTotal !== undefined && sapTotal !== null ? String(sapTotal) : undefined,
        TaxAmount: sapTax !== undefined && sapTax !== null ? String(sapTax) : undefined,
        TransactionCurrency: sapCurrency,
        notTransmitted: notTransmitted
      };
    }

    // -------------------------------------------------------------------------
    // Inquiry Branch: Sequential 3-Step POSTs
    // -------------------------------------------------------------------------
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

    // Contact Person: send through the path $metadata supports (HeaderSet property or HeaderPartnerSet entry).
    // If neither path exists in metadata, fail with a visible error.
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

    // Extension fields: only those the service exposes can be transmitted.
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
        // Plant is on the ZIN item incompletion procedure; the Item entity carries it.
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

        // 3. Post price condition (ZPR1) so S/4HANA pricing engine computes and stores Net Amount
        const effectivePrice = price > 0 ? price : (qty > 0 && net > 0 ? (net / qty) : 0);
        if (effectivePrice > 0) {
          let condType = 'ZPR1';
          try {
            if (typeof s4Config.getConditionType === 'function') {
              condType = s4Config.getConditionType();
            } else {
              const cfg = await (this.resolver || businessConfigResolver).resolve({
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
    // The header POST answers before items and prices exist, so its amounts are not the document's totals.
    // Totals are reported only after reading the header back (default), never computed locally.
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


async function createSalesInquiryViaRfc(adapter, header, items, options = {}) {
    const creator = options.creator || new SalesInquiryRfcCreator({ rfc: adapter.rfc });
    const result = await creator.create(header, items, { testRun: options.testRun === true });
    if (result.testRun) return result;
    const stored = await creator.readBack(result.SalesInquiry);
    if (!stored) {
      throw Object.assign(new Error(`SAP committed inquiry ${result.SalesInquiry}, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.`),
        { status: 502, SalesInquiry: result.SalesInquiry, name: 'PartialSalesInquiryError', $sanitize: false });
    }
    return result;
  }


async function _getLeanOrderFields(adapter, destination, executeFn = adapter.client._execute) {
    if (adapter._leanOrderFields) return adapter._leanOrderFields;
    const empty = { header: new Set(), item: new Set(), partner: new Set() };
    try {
      const res = await executeFn(destination, {
        method: 'get',
        url: `${LEAN_ORDER_PATH}/$metadata`,
        headers: { 'Accept': 'application/xml, text/xml' }
      }, { fetchCsrfToken: false });
      const xml = typeof res?.data === 'string' ? res.data : '';
      const props = (name) => {
        const m = xml.match(new RegExp(`<EntityType Name="${name}"[\\s\\S]*?</EntityType>`));
        return new Set(m ? [...m[0].matchAll(/<Property Name="([^"]+)"/g)].map(x => x[1]) : []);
      };
      const fields = { header: props('Header'), item: props('Item'), partner: props('HeaderPartner') };
      if (fields.header.size === 0) {
        LOG.warn('LORD_ODATA_ORDER_SRV $metadata returned no Header properties; capabilities unknown.');
        return empty;
      }
      adapter._leanOrderFields = fields;
      return fields;
    } catch (err) {
      LOG.warn('Could not read LORD_ODATA_ORDER_SRV $metadata:', err.message);
      return empty;
    }
  }


function getInquiryCreationCapabilities() {
  const caps = { service: INQUIRY_BAPI, Plant: true };
  for (const f of ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson']) caps[f] = !UNSUPPORTED_HEADER_FIELDS.includes(f);
  return caps;
}


module.exports = {
  createSalesDocument,
  createSalesInquiryViaRfc,
  _getLeanOrderFields,
  getInquiryCreationCapabilities
};
