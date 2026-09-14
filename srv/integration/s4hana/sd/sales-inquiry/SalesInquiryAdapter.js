const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

/**
 * Adapter class to encapsulate communication with SAP S/4HANA Sales Inquiry services:
 * - SD_F2370_INQY_WL_SRV (Manage Sales Inquiries Worklist & Configuration Value Helps)
 * - SD_F2369_INQY_FS_SRV (Sales Inquiry Factsheet & Line Items)
 * - LORD_ODATA_ORDER_SRV (Lean Order OData Service for Sales Document Creation)
 */
class SalesInquiryAdapter {
  constructor() {
    this.s4hanaWL = null;
    this.s4hanaFS = null;
  }

  /** Initialize the remote S/4HANA read services */
  async init() {
    if (!this.s4hanaWL) {
      try {
        this.s4hanaWL = await cds.connect.to('SD_F2370_INQY_WL_SRV');
      } catch (err) {
        console.warn('[SalesInquiryAdapter] Could not connect to SD_F2370_INQY_WL_SRV:', err.message);
      }
    }
    if (!this.s4hanaFS) {
      try {
        this.s4hanaFS = await cds.connect.to('SD_F2369_INQY_FS_SRV');
      } catch (err) {
        console.warn('[SalesInquiryAdapter] Could not connect to SD_F2369_INQY_FS_SRV:', err.message);
      }
    }
  }

  /**
   * Resolve destination for S/4HANA communication using SAP Cloud SDK.
   */
  async _getDestination() {
    const destinationName = process.env.S4_DESTINATION_NAME || 'S4HANA_PO_API';
    try {
      const dest = await connectivity.getDestination({ destinationName });
      if (dest) return dest;
    } catch (err) {
      // In local development without BTP Destination Service, fallback to credentials
    }

    if (process.env.S4_DESTINATION_URL) {
      return {
        url: process.env.S4_DESTINATION_URL,
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: {
          'sap-client': process.env.S4_CLIENT || '220'
        }
      };
    }

    const creds = cds.env.requires?.SD_F2370_INQY_WL_SRV?.credentials;
    if (creds && creds.url) {
      const baseUrl = new URL(creds.url).origin;
      return {
        url: baseUrl,
        username: creds.username,
        password: creds.password,
        headers: creds.headers || {}
      };
    }

    throw new Error(`[SalesInquiryAdapter] Destination '${destinationName}' not found and no local credentials configured.`);
  }

  /** Read data from SD Worklist & Value Help service */
  async readWlData(query) {
    await this.init();
    if (!this.s4hanaWL) {
      return [];
    }
    try {
      return await this.s4hanaWL.run(query);
    } catch (error) {
      console.error('[SalesInquiryAdapter] Error reading data from WL service:', error.message);
      throw error;
    }
  }

  /** Read data from SD Factsheet & Item service */
  async readFsData(query) {
    await this.init();
    if (!this.s4hanaFS) {
      return [];
    }
    try {
      return await this.s4hanaFS.run(query);
    } catch (error) {
      console.warn('[SalesInquiryAdapter] Error reading data from FS service:', error.message);
      return [];
    }
  }

  /**
   * Retrieves Sales Inquiries list from S/4HANA worklist service.
   */
  async getInquiries(query) {
    await this.init();
    if (!this.s4hanaWL) {
      return [];
    }
    try {
      const defaultQuery = SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370')
        .orderBy('CreationDate desc', 'SalesInquiry desc')
        .limit(50);
      let execQuery = query || defaultQuery;
      if (query && query.SELECT && (!query.SELECT.orderBy || query.SELECT.orderBy.length === 0)) {
        execQuery = SELECT.from(query.SELECT.from || 'SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370')
          .orderBy('CreationDate desc', 'SalesInquiry desc');
        if (query.SELECT.where) execQuery.where(query.SELECT.where);
        if (query.SELECT.columns) execQuery.columns(query.SELECT.columns);
        if (query.SELECT.limit) execQuery.limit(query.SELECT.limit.rows, query.SELECT.limit.offset);
      }
      const res = await this.s4hanaWL.run(execQuery);
      return Array.isArray(res) ? res : (res?.value || res?.d?.results || []);
    } catch (err) {
      console.error('[SalesInquiryAdapter] Error fetching inquiries from SD_F2370_INQY_WL_SRV:', err.message);
      throw err;
    }
  }

  /**
   * Retrieves single Sales Inquiry details by ID directly from S/4HANA.
   */
  async getInquiry(sId) {
    const sKey = String(sId).trim();
    await this.init();
    let header = null;
    let items = [];

    // 1. Fetch worklist header record (contains OrganizationBPName1, CreationDate, CreatedByUser, etc.)
    if (this.s4hanaWL) {
      try {
        const res = await this.s4hanaWL.run(
          SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').where({ SalesInquiry: sKey })
        );
        if (res) {
          header = { ...res };
        }
      } catch (e) {
        console.warn('[SalesInquiryAdapter] Error fetching WL record for inquiry:', e.message);
      }
    }

    // 2. Fetch factsheet header record and partner cards (contains CustomerPurchaseOrderDate, Validity Dates, Partners)
    if (this.s4hanaFS) {
      try {
        const fsDoc = await this.s4hanaFS.run(
          SELECT.one.from('SD_F2369_INQY_FS_SRV.C_Inquiryfs', doc => {
            doc('*');
            doc.to_SDDocumentPartnerCard('*');
          }).where({ SalesInquiry: sKey })
        );
        if (fsDoc) {
          header = Object.assign({}, fsDoc, header || {});
          if (fsDoc.CustomerPurchaseOrderDate) header.CustomerPurchaseOrderDate = fsDoc.CustomerPurchaseOrderDate;
          if (fsDoc.BindingPeriodValidityStartDate) header.BindingPeriodValidityStartDate = fsDoc.BindingPeriodValidityStartDate;
          if (fsDoc.BindingPeriodValidityEndDate) header.BindingPeriodValidityEndDate = fsDoc.BindingPeriodValidityEndDate;
          if (fsDoc.SalesAreaDesc) header.SalesAreaDesc = fsDoc.SalesAreaDesc;

          const partners = Array.isArray(fsDoc.to_SDDocumentPartnerCard) ? fsDoc.to_SDDocumentPartnerCard : [];
          const shipTo = partners.find(p => p.PartnerFunction === 'WE');
          if (shipTo) {
            header.ShipToParty = shipTo.Customer || shipTo.BusinessPartner;
            header.ShipToPartyName = shipTo.FullName;
          }
          const contact = partners.find(p => p.PartnerFunction === 'ZP');
          if (contact) {
            header.ContactPersonName = contact.FullName;
          }
          const salesEmp = partners.find(p => p.PartnerFunction === 'ZE');
          if (salesEmp) {
            header.SalesEmployeeName = salesEmp.FullName;
          }
        }
      } catch (fse) {
        console.warn('[SalesInquiryAdapter] Error fetching FS record for inquiry:', fse.message);
      }

      // 3. Fetch items with computed NetPriceAmount
      try {
        const itemRes = await this.s4hanaFS.run(
          SELECT.from('SD_F2369_INQY_FS_SRV.C_Inquiryitemfs').where({ SalesInquiry: sKey })
        );
        const rawItems = Array.isArray(itemRes) ? itemRes : (itemRes?.value || itemRes?.d?.results || []);
        items = rawItems.map(item => {
          const qty = Number(item.OrderQuantity) || 0;
          const net = Number(item.NetAmount) || 0;
          const price = item.NetPriceAmount || (qty > 0 ? (net / qty).toFixed(2) : '0.00');
          return {
            ...item,
            NetPriceAmount: price
          };
        });
      } catch (ie) {
        console.warn('[SalesInquiryAdapter] Error fetching items for inquiry:', ie.message);
      }
    }

    if (header) {
      if (!header.ShipToParty && header.SoldToParty) {
        header.ShipToParty = header.SoldToParty;
        header.ShipToPartyName = header.OrganizationBPName1 || '';
      }
      return { header, items };
    }

    return null;
  }

  /**
   * Derives default organizational and commercial values for a customer.
   */
  async getCustomerDefaults(sCustomer, sOrg, sChannel, sDivision) {
    if (!sCustomer || String(sCustomer).trim() === '') {
      return {
        Customer: '',
        CustomerName: '',
        City: '',
        Country: '',
        Currency: '',
        ShipToParty: '',
        ShipToPartyName: '',
        derived: false
      };
    }

    const sCust = String(sCustomer).trim();
    let sName = '';
    let sCity = '';
    let sCountry = '';
    let sCurrency = 'INR';

    await this.init();
    if (this.s4hanaWL) {
      try {
        // Query Customer VH
        const custRows = await this.s4hanaWL.run(
          SELECT.from('SD_F2370_INQY_WL_SRV.I_Customer_VH').where({ Customer: sCust }).limit(1)
        );
        const cust = Array.isArray(custRows) ? custRows[0] : (custRows?.value?.[0] || null);
        if (cust) {
          sName = cust.CustomerName || cust.OrganizationBPName1 || cust.BusinessPartnerName1 || '';
          sCity = cust.CityName || cust.BPAddrCityName || '';
          sCountry = cust.Country || 'IN';
        }

        // Query historical inquiries for this customer to find default currency and org alignment
        const inqRows = await this.s4hanaWL.run(
          SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370')
            .columns('TransactionCurrency', 'SalesOrganization', 'DistributionChannel', 'OrganizationDivision')
            .where({ SoldToParty: sCust })
            .limit(1)
        );
        const inq = Array.isArray(inqRows) ? inqRows[0] : (inqRows?.value?.[0] || null);
        if (inq?.TransactionCurrency) {
          sCurrency = inq.TransactionCurrency;
        }
      } catch (err) {
        console.warn('[SalesInquiryAdapter] getCustomerDefaults remote query warning:', err.message);
      }
    }

    return {
      Customer: sCust,
      CustomerName: sName,
      City: sCity,
      Country: sCountry,
      Currency: sCurrency,
      ShipToParty: sCust,
      ShipToPartyName: sName,
      derived: Boolean(sName || sCity)
    };
  }

  /**
   * Retrieves standard default parameters for Sales Inquiry VA11 creation.
   */
  async getSalesInquiryDefaults() {
    const today = new Date().toISOString().split('T')[0];
    const validityEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return {
      SalesInquiryType: 'ZIN',
      SalesOrganization: '1000',
      DistributionChannel: '10',
      OrganizationDivision: '52',
      SalesInquiryDate: today,
      BindingPeriodValidityStartDate: today,
      BindingPeriodValidityEndDate: validityEnd,
      TransactionCurrency: 'INR',
      derived: true
    };
  }

  /**
   * Resolves a material input string to a valid SAP numeric Material ID.
   * If the input is already a material number, returns it directly.
   * If it matches Material_Text in I_Material, resolves to the technical ID.
   */
  async resolveMaterial(matInput) {
    if (!matInput || String(matInput).trim() === '') return '';
    const raw = String(matInput).trim();
    if (/^\d{6,18}$/.test(raw)) {
      return raw;
    }
    await this.init();
    if (this.s4hanaFS) {
      try {
        const rows = await this.s4hanaFS.run(
          SELECT.from('SD_F2369_INQY_FS_SRV.I_Material').where({ Material_Text: raw }).limit(1)
        );
        if (rows && rows[0]?.Material) {
          return rows[0].Material;
        }
      } catch (e) {
        console.warn('[SalesInquiryAdapter] Could not resolve material description:', raw, e.message);
      }
    }
    return raw;
  }

  /**
   * Creates a Sales Inquiry directly in SAP S/4HANA using LORD_ODATA_ORDER_SRV.
   * SAP S/4HANA generates the official sequential inquiry number (e.g. 1000521, 1000522).
   *
   * @param {Object} header - Normalized inquiry header
   * @param {Array<Object>} items - Normalized line items
   * @param {Object} options - User and execution options
   * @returns {Promise<{ SalesInquiry: string, TotalNetAmount: string, TransactionCurrency: string }>}
   */
  async createSalesInquiry(header, items, options = {}) {
    const destination = options.destination || await this._getDestination();
    const servicePath = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;

    const firstItemText = (items && items[0] && (items[0].SalesInquiryItemText || items[0].MaterialName)) || '';
    const custRef = header.PurchaseOrderByCustomer || firstItemText || 'SALES INQUIRY';

    // 1. Post Header to LORD_ODATA_ORDER_SRV/HeaderSet
    const headerPayload = {
      SalesOrderTypeCode: header.SalesInquiryType || 'ZIN',
      SalesOrganization: header.SalesOrganization || '1000',
      DistributionChannel: header.DistributionChannel || '10',
      Division: header.OrganizationDivision || '52',
      SoldToPartyID: header.SoldToParty || '',
      PurchaseOrderNumber: custRef
    };

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
      console.error('[SalesInquiryAdapter] Failed to create Sales Inquiry header in S/4HANA:', sapMsg);
      throw new Error(sapMsg);
    }

    const sNewInquiryId = headerResp.data?.d?.SalesOrderID || headerResp.data?.SalesOrderID;
    if (!sNewInquiryId) {
      throw new Error('Sales Inquiry number not returned from SAP S/4HANA');
    }

    let totalNet = 0;

    // 2. Post line items sequentially to LORD_ODATA_ORDER_SRV/HeaderSet('<SalesOrderID>')/ItemSet
    if (Array.isArray(items) && items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const itm = items[idx];
        const qty = parseFloat(itm.OrderQuantity) || 1;
        const price = parseFloat(itm.NetPriceAmount) || 0;
        const net = itm.NetAmount !== undefined && itm.NetAmount !== null ? parseFloat(itm.NetAmount) : (qty * price);
        totalNet += net;

        const lineNum = itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
        const resolvedMaterial = await this.resolveMaterial(itm.Material);
        const itemPayload = {
          SalesOrderID: sNewInquiryId,
          ItemID: lineNum,
          MaterialID: resolvedMaterial || itm.Material || '',
          OrderQty: String(qty.toFixed(3)),
          SalesUnit: itm.OrderQuantityUnit || 'PC'
        };

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
          console.error(`[SalesInquiryAdapter] Failed to create item ${itemPayload.ItemID} for inquiry ${sNewInquiryId}:`, itemSapMsg);
          throw new Error(itemSapMsg);
        }

        // 3. Post price condition (ZPR1) so S/4HANA pricing engine computes and stores Net Amount
        const effectivePrice = price > 0 ? price : (qty > 0 && net > 0 ? (net / qty) : 0);
        if (effectivePrice > 0) {
          const condPayload = {
            SalesOrderID: sNewInquiryId,
            ItemID: lineNum,
            CondTypeCode: 'ZPR1',
            AmountInternal: String(effectivePrice.toFixed(2)),
            RateUnitExternal: header.TransactionCurrency || 'INR',
            PriceUnit: '1.000',
            UnitOfMeasure: itm.OrderQuantityUnit || 'PC'
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
            console.error(`[SalesInquiryAdapter] Failed to set price condition for item ${lineNum}:`, condSapMsg);
            throw new Error(condSapMsg);
          }
        }
      }
    }

    return {
      SalesInquiry: sNewInquiryId,
      TotalNetAmount: totalNet > 0 ? String(totalNet.toFixed(2)) : (headerResp.data?.d?.NetValue || '0.00'),
      TransactionCurrency: header.TransactionCurrency || headerResp.data?.d?.Currency || 'INR'
    };
  }
}

const defaultAdapter = new SalesInquiryAdapter();
defaultAdapter.SalesInquiryAdapter = SalesInquiryAdapter;

module.exports = defaultAdapter;
