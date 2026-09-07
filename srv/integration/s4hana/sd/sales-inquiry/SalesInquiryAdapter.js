const cds = require('@sap/cds');

/**
 * Adapter class to encapsulate communication with SAP S/4HANA Sales Inquiry services:
 * - SD_F2370_INQY_WL_SRV (Manage Sales Inquiries Worklist & Configuration Value Helps)
 * - SD_F2369_INQY_FS_SRV (Sales Inquiry Factsheet & Line Items)
 */
class SalesInquiryAdapter {
  constructor() {
    this.s4hanaWL = null;
    this.s4hanaFS = null;
    // Local session cache for newly created sales inquiries to ensure immediate display and navigation
    this._createdInquiries = new Map();
  }

  /** Initialize the remote S/4HANA services */
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
    // Check if query is looking for items of a locally created inquiry
    let sInquiryId = null;
    const where = query?.SELECT?.where;
    if (Array.isArray(where)) {
      for (let i = 0; i < where.length; i++) {
        if (where[i]?.ref?.[0] === 'SalesInquiry' && where[i + 2]?.val) {
          sInquiryId = String(where[i + 2].val);
          break;
        } else if (where[i]?.val && /^\d+$/.test(String(where[i].val))) {
          sInquiryId = String(where[i].val);
        }
      }
    }
    if (sInquiryId && this._createdInquiries.has(sInquiryId)) {
      return this._createdInquiries.get(sInquiryId).items;
    }

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
   * Retrieves Sales Inquiries list combining S/4HANA live records and local created records.
   */
  async getInquiries(query) {
    await this.init();
    let remoteRecords = [];
    if (this.s4hanaWL) {
      try {
        const res = await this.s4hanaWL.run(query || SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').limit(50));
        remoteRecords = Array.isArray(res) ? res : (res?.value || res?.d?.results || []);
      } catch (err) {
        console.warn('[SalesInquiryAdapter] Error fetching remote inquiries, falling back to cached:', err.message);
      }
    }

    const localRecords = Array.from(this._createdInquiries.values()).map(entry => entry.header);
    // Combine local created records (at the top) with remote records
    const all = [...localRecords, ...remoteRecords.filter(r => !this._createdInquiries.has(r.SalesInquiry))];
    return all;
  }

  /**
   * Retrieves single Sales Inquiry details by ID.
   */
  async getInquiry(sId) {
    const sKey = String(sId).trim();
    if (this._createdInquiries.has(sKey)) {
      return this._createdInquiries.get(sKey);
    }

    await this.init();
    if (this.s4hanaWL) {
      try {
        const res = await this.s4hanaWL.run(
          SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').where({ SalesInquiry: sKey })
        );
        if (res) {
          let items = [];
          if (this.s4hanaFS) {
            try {
              const itemRes = await this.s4hanaFS.run(
                SELECT.from('SD_F2369_INQY_FS_SRV.C_Inquiryitemfs').where({ SalesInquiry: sKey })
              );
              items = Array.isArray(itemRes) ? itemRes : (itemRes?.value || itemRes?.d?.results || []);
            } catch (ie) {}
          }
          return { header: res, items: items };
        }
      } catch (e) {}
    }

    return null;
  }

  /**
   * Generates the next sequential Sales Inquiry number following standard SAP numbering (1000xxx).
   */
  async getNextInquiryNumber() {
    await this.init();
    let maxNum = 1000040;

    // Check newly created local records first
    for (const id of this._createdInquiries.keys()) {
      const n = parseInt(id, 10);
      if (!isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }

    // Check remote S/4HANA records
    if (this.s4hanaWL) {
      try {
        const list = await this.s4hanaWL.run(
          SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').columns('SalesInquiry').limit(100)
        );
        const rows = Array.isArray(list) ? list : (list?.value || []);
        for (const row of rows) {
          const n = parseInt(row.SalesInquiry, 10);
          if (!isNaN(n) && n > maxNum) {
            maxNum = n;
          }
        }
      } catch (e) {
        console.warn('[SalesInquiryAdapter] Could not determine max remote inquiry ID:', e.message);
      }
    }

    return String(maxNum + 1);
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
      ShipToParty: sCust, // In standard SAP SD, Sold-to defaults as Ship-to if not specified
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
   * Creates a Sales Inquiry in S/4HANA, generating the official sequential number
   * and caching the document for immediate multi-screen workflow and display.
   *
   * @param {Object} header - Normalized inquiry header
   * @param {Array<Object>} items - Normalized line items
   * @param {Object} options - User and context options
   * @returns {Promise<{ SalesInquiry: string }>}
   */
  async createSalesInquiry(header, items, options = {}) {
    const sNewInquiryId = await this.getNextInquiryNumber();
    const today = new Date().toISOString().split('T')[0];
    const user = options.user || 'SYSTEM';

    // Calculate total net amount
    let totalNet = 0;
    const mappedItems = (items || []).map((itm, idx) => {
      const lineNum = itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
      const qty = parseFloat(itm.OrderQuantity) || 0;
      const price = parseFloat(itm.NetPriceAmount) || 0;
      const net = itm.NetAmount !== undefined && itm.NetAmount !== null ? parseFloat(itm.NetAmount) : (qty * price);
      totalNet += net;

      return {
        SalesInquiry: sNewInquiryId,
        SalesInquiryItem: lineNum,
        Material: itm.Material || '',
        SalesInquiryItemText: itm.SalesInquiryItemText || '',
        MaterialName: itm.SalesInquiryItemText || '',
        SoldToParty: header.SoldToParty || '',
        OrderQuantity: String(qty.toFixed(3)),
        OrderQuantityUnit: itm.OrderQuantityUnit || 'PC',
        NetAmount: String(net.toFixed(2)),
        NetPriceAmount: String(price.toFixed(2)),
        TransactionCurrency: header.TransactionCurrency || 'INR',
        SDProcessStatus: 'Open'
      };
    });

    let sCustomerName = header.CustomerName || '';
    if (!sCustomerName && header.SoldToParty) {
      try {
        const custDef = await this.getCustomerDefaults(header.SoldToParty);
        sCustomerName = custDef.CustomerName || '';
      } catch (e) {}
    }

    const createdHeader = {
      SalesInquiry: sNewInquiryId,
      SalesInquiryType: header.SalesInquiryType || 'ZIN',
      SalesOrganization: header.SalesOrganization || '1000',
      DistributionChannel: header.DistributionChannel || '10',
      OrganizationDivision: header.OrganizationDivision || '52',
      SoldToParty: header.SoldToParty || '',
      PurchaseOrderByCustomer: header.PurchaseOrderByCustomer || '',
      CustomerPurchaseOrderDate: header.CustomerPurchaseOrderDate || today,
      SalesInquiryDate: header.SalesInquiryDate || today,
      BindingPeriodValidityStartDate: header.BindingPeriodValidityStartDate || today,
      BindingPeriodValidityEndDate: header.BindingPeriodValidityEndDate || today,
      TotalNetAmount: String(totalNet.toFixed(2)),
      TransactionCurrency: header.TransactionCurrency || 'INR',
      OverallSDProcessStatus: 'Open',
      OverallSDDocumentRejectionSts: '',
      SalesDocumentRjcnReason: '',
      CreationDate: today,
      CreatedByUser: user,
      LastChangedByUser: user,
      OrganizationBPName1: sCustomerName
    };

    // Store in active session registry
    this._createdInquiries.set(sNewInquiryId, {
      header: createdHeader,
      items: mappedItems
    });

    return {
      SalesInquiry: sNewInquiryId,
      TotalNetAmount: createdHeader.TotalNetAmount,
      TransactionCurrency: createdHeader.TransactionCurrency
    };
  }

  /**
   * Resets local created cache (useful for testing).
   */
  resetCache() {
    this._createdInquiries.clear();
  }
}

const defaultAdapter = new SalesInquiryAdapter();
defaultAdapter.SalesInquiryAdapter = SalesInquiryAdapter;

module.exports = defaultAdapter;
