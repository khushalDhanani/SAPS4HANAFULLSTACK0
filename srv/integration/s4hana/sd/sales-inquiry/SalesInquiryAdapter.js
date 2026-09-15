const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');
const { SalesQuotationManageClient } = require('./SalesQuotationManageClient');

const LEAN_ORDER_PATH = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';

/**
 * Header values SAP requires (incompletion procedure Z1 and partner function ZP) before an inquiry
 * can be referenced by a quotation, keyed by the property names agreed for the LORD_ODATA_ORDER_SRV
 * Header extension. The standard service has none of them; each is sent only when the live
 * $metadata of the service exposes the property, so the application works unchanged before and
 * after the SAP-side extension. See docs/sap-inquiry-service-extension-spec.md.
 */
const INQUIRY_EXTENSION_FIELDS = ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'];

/**
 * Adapter class to encapsulate communication with SAP S/4HANA Sales Inquiry services:
 * - SD_F2370_INQY_WL_SRV (Manage Sales Inquiries Worklist & Configuration Value Helps)
 * - SD_F2369_INQY_FS_SRV (Sales Inquiry Factsheet & Line Items)
 * - LORD_ODATA_ORDER_SRV (Lean Order OData Service for Sales Document Creation)
 * - UI_SALESQUOTATIONMANAGE (OData V4, Sales Quotation creation with reference to an inquiry)
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
   * Retrieves Finished Goods (FG) materials dynamically from S/4HANA SD_F2369_INQY_FS_SRV.I_Material.
   * Restricts strictly to Finished Goods (MaterialType = 'ZFRT' or MaterialType = 'FERT').
   * Merges incoming search filters, applies stable deterministic sorting, and supports pagination.
   */
  async getMaterials(query) {
    await this.init();
    if (!this.s4hanaFS) {
      return [];
    }
    try {
      // Finished Goods constraint in S/4HANA Client 220
      const fgCondition = [
        '(',
        { ref: ['MaterialType'] },
        '=',
        { val: 'ZFRT' },
        'or',
        { ref: ['MaterialType'] },
        '=',
        { val: 'FERT' },
        ')'
      ];

      // Helper to map alias MaterialName -> physical field Material_Text in S/4HANA CDS
      const mapWhereNode = (node) => {
        if (!node) return node;
        if (Array.isArray(node)) return node.map(mapWhereNode);
        if (typeof node === 'object') {
          const copy = { ...node };
          if (Array.isArray(copy.ref)) {
            copy.ref = copy.ref.map(r => r === 'MaterialName' ? 'Material_Text' : r);
          }
          if (Array.isArray(copy.args)) {
            copy.args = copy.args.map(mapWhereNode);
          }
          return copy;
        }
        return node;
      };

      let execQuery = SELECT.from('SD_F2369_INQY_FS_SRV.I_Material')
        .columns('Material', 'Material_Text', 'MaterialType', 'MaterialGroup', 'MaterialBaseUnit')
        .orderBy('Material asc');

      if (query && query.SELECT) {
        if (query.SELECT.where && query.SELECT.where.length > 0) {
          const mappedUserWhere = mapWhereNode(query.SELECT.where);
          execQuery.where([ '(', ...mappedUserWhere, ')', 'and', ...fgCondition ]);
        } else {
          execQuery.where(fgCondition);
        }

        if (query.SELECT.limit) {
          execQuery.limit(query.SELECT.limit.rows, query.SELECT.limit.offset);
        }
        if (query.SELECT.count) {
          execQuery.SELECT.count = true;
        }
      } else {
        execQuery.where(fgCondition);
      }

      const raw = await this.s4hanaFS.run(execQuery);
      const rawList = Array.isArray(raw) ? raw : (raw?.value || raw?.d?.results || []);

      const items = rawList.map(m => ({
        ...m,
        MaterialName: m.MaterialName || m.Material_Text || ''
      }));

      if (raw && raw.$count !== undefined) {
        items.$count = raw.$count;
      }

      return items;
    } catch (error) {
      console.warn('[SalesInquiryAdapter] Error querying Finished Goods materials:', error.message);
      return [];
    }
  }

  /**
   * Sales inquiry document types (category A) as configured in SAP S/4HANA.
   *
   * Reads SD_F2369_INQY_FS_SRV.I_SalesDocumentType and falls back to
   * SD_F2370_INQY_WL_SRV.C_SalesInquiryTypeValueHelp only when the factsheet service returns nothing.
   * Descriptions, number ranges and procedures are passed through exactly as SAP returns them; the only
   * derived fields are the active/inactive status (from SAP's IsLocked flag) and the category name of
   * category A. When SAP cannot be read, the call fails: no built-in list of types is ever returned.
   *
   * @param {Object} [query] - CAP query (limit / offset are honoured)
   * @returns {Promise<Array<Object>>}
   * @throws {Error} status 503 when no SD service is connected, 502 when SAP could not be read
   */
  async getInquiryTypes(query) {
    await this.init();
    if (!this.s4hanaFS && !this.s4hanaWL) {
      const err = new Error('Sales inquiry types cannot be read: the SAP SD services SD_F2369_INQY_FS_SRV and SD_F2370_INQY_WL_SRV are not connected.');
      err.status = 503;
      throw err;
    }

    const failures = [];
    let rawList = [];

    if (this.s4hanaFS) {
      try {
        const execQuery = SELECT.from('SD_F2369_INQY_FS_SRV.I_SalesDocumentType')
          .columns(
            'SalesDocumentType',
            'SalesDocumentType_Text',
            'SDDocumentCategory',
            'ScreenSequenceGroup',
            'NumberRangeForIntIDAssignment',
            'NumberRangeForExtIDAssignment',
            'IsLocked',
            'TextDeterminationProcedure',
            'PartnerDeterminationProcedure'
          )
          .where([{ ref: ['SDDocumentCategory'] }, '=', { val: 'A' }])
          .orderBy('SalesDocumentType asc');
        if (query && query.SELECT && query.SELECT.limit) {
          execQuery.limit(query.SELECT.limit.rows, query.SELECT.limit.offset);
        }
        const raw = await this.s4hanaFS.run(execQuery);
        rawList = Array.isArray(raw) ? raw : (raw?.value || raw?.d?.results || []);
      } catch (error) {
        failures.push(`SD_F2369_INQY_FS_SRV: ${error.message}`);
        console.warn('[SalesInquiryAdapter] Error querying I_SalesDocumentType from FS:', error.message);
      }
    }

    if (rawList.length === 0 && this.s4hanaWL) {
      try {
        const rawWl = await this.s4hanaWL.run(SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesInquiryTypeValueHelp'));
        rawList = Array.isArray(rawWl) ? rawWl : (rawWl?.value || rawWl?.d?.results || []);
      } catch (wlError) {
        failures.push(`SD_F2370_INQY_WL_SRV: ${wlError.message}`);
        console.warn('[SalesInquiryAdapter] Error querying C_SalesInquiryTypeValueHelp from WL:', wlError.message);
      }
    }

    if (rawList.length === 0 && failures.length > 0) {
      const err = new Error(`Sales inquiry types could not be read from SAP S/4HANA (${failures.join('; ')}).`);
      err.status = 502;
      throw err;
    }

    return rawList.map(item => {
      const sCode = item.SalesDocumentType || item.SalesInquiryType || '';
      const sText = item.SalesDocumentType_Text || item.SalesInquiryType_Text || item.SalesDocumentTypeName || '';
      const isActive = item.IsLocked !== 'X' && item.IsLocked !== true;
      return {
        SalesDocumentType: sCode,
        SalesDocumentType_Text: sText,
        SalesDocumentTypeName: sText,
        // Both sources return sales inquiry types only, i.e. SD document category A.
        SDDocumentCategory: item.SDDocumentCategory || 'A',
        SDDocumentCategoryName: 'Inquiry',
        IsLocked: item.IsLocked ?? null,
        IsActive: isActive,
        StatusText: isActive ? 'Active' : 'Inactive',
        StatusState: isActive ? 'Success' : 'Warning',
        ScreenSequenceGroup: item.ScreenSequenceGroup ?? null,
        NumberRangeForIntIDAssignment: item.NumberRangeForIntIDAssignment ?? null,
        NumberRangeForExtIDAssignment: item.NumberRangeForExtIDAssignment ?? null,
        TextDeterminationProcedure: item.TextDeterminationProcedure ?? null,
        PartnerDeterminationProcedure: item.PartnerDeterminationProcedure ?? null
      };
    });
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

    // 1. Fetch worklist header record (contains OrganizationBPName1, CreationDate, CreatedByUser, SalesOffice, SalesGroup, etc.)
    if (this.s4hanaWL) {
      try {
        const res = await this.s4hanaWL.run(
          SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370', inq => {
            inq('*');
            inq.to_SalesOffice('*');
            inq.to_SalesGroup('*');
          }).where({ SalesInquiry: sKey })
        );
        if (res) {
          header = { ...res };
          if (res.to_SalesOffice?.SalesOfficeName) {
            header.SalesOfficeName = res.to_SalesOffice.SalesOfficeName;
          }
          if (res.to_SalesGroup?.SalesGroupName) {
            header.SalesGroupName = res.to_SalesGroup.SalesGroupName;
          }
        }
      } catch (e) {
        // Fallback to simple select if navigation expansion fails
        try {
          const res = await this.s4hanaWL.run(
            SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').where({ SalesInquiry: sKey })
          );
          if (res) {
            header = { ...res };
          }
        } catch (innerErr) {
          console.warn('[SalesInquiryAdapter] Error fetching WL record for inquiry:', innerErr.message);
        }
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

      // 4. Dynamic SAP S/4HANA resolution for SalesOffice and SalesGroup
      if (this.s4hanaWL) {
        const sSoldTo = header.SoldToParty;
        const sOrg = header.SalesOrganization;

        // If SalesOffice is not populated on this inquiry header in SAP, derive from customer historical inquiries in SAP
        if ((!header.SalesOffice || header.SalesOffice.trim() === '') && sSoldTo && sOrg) {
          try {
            const custInq = await this.s4hanaWL.run(
              SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370')
                .columns('SalesOffice', 'SalesGroup')
                .where({ SoldToParty: sSoldTo, SalesOrganization: sOrg })
                .where("SalesOffice != ''")
                .limit(1)
            );
            const cMatch = Array.isArray(custInq) ? custInq[0] : (custInq?.value?.[0] || null);
            if (cMatch?.SalesOffice) {
              header.SalesOffice = cMatch.SalesOffice;
              if ((!header.SalesGroup || header.SalesGroup.trim() === '') && cMatch.SalesGroup) {
                header.SalesGroup = cMatch.SalesGroup;
              }
            }
          } catch (ce) {
            console.warn('[SalesInquiryAdapter] Could not derive customer sales office from SAP:', ce.message);
          }
        }

        // If still unassigned, query valid Sales Office for the inquiry's Sales Area from SAP configuration
        if ((!header.SalesOffice || header.SalesOffice.trim() === '') && sOrg) {
          try {
            const orgRows = await this.s4hanaWL.run(
              SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp')
                .where({
                  SalesOrganization: sOrg,
                  DistributionChannel: header.DistributionChannel || '10',
                  OrganizationDivision: header.OrganizationDivision || '52'
                })
                .limit(1)
            );
            const oMatch = Array.isArray(orgRows) ? orgRows[0] : (orgRows?.value?.[0] || null);
            if (oMatch?.SalesOffice) {
              header.SalesOffice = oMatch.SalesOffice;
              header.SalesOfficeName = oMatch.SalesOfficeName || '';
            }
          } catch (oe) {
            console.warn('[SalesInquiryAdapter] Could not derive sales area office from SAP:', oe.message);
          }
        }

        // If SalesOffice exists but SalesOfficeName is not populated, resolve from SAP C_SalesOfficeValueHelp
        if (header.SalesOffice && (!header.SalesOfficeName || header.SalesOfficeName.trim() === '')) {
          try {
            const oVH = await this.s4hanaWL.run(
              SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: header.SalesOffice })
            );
            if (oVH?.SalesOfficeName) {
              header.SalesOfficeName = oVH.SalesOfficeName;
            }
          } catch (e) {}
        }

        // If SalesOffice exists but SalesGroup is unassigned, derive default Sales Group for that office from SAP
        if (header.SalesOffice && (!header.SalesGroup || header.SalesGroup.trim() === '')) {
          try {
            const gRows = await this.s4hanaWL.run(
              SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesOffice: header.SalesOffice }).limit(1)
            );
            const gRow = Array.isArray(gRows) ? gRows[0] : (gRows?.value?.[0] || null);
            if (gRow?.SalesGroup) {
              header.SalesGroup = gRow.SalesGroup;
              header.SalesGroupName = gRow.SalesGroupName || '';
            }
          } catch (e) {}
        }

        // If SalesGroup exists but SalesGroupName is not populated, resolve from SAP C_SalesGroupValueHelp
        if (header.SalesGroup && (!header.SalesGroupName || header.SalesGroupName.trim() === '')) {
          try {
            const gVH = await this.s4hanaWL.run(
              SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesGroup: header.SalesGroup })
            );
            if (gVH?.SalesGroupName) {
              header.SalesGroupName = gVH.SalesGroupName;
            }
          } catch (e) {}
        }
      }

      header.SalesOffice = header.SalesOffice || '';
      header.SalesOfficeName = header.SalesOfficeName || '';
      header.SalesGroup = header.SalesGroup || '';
      header.SalesGroupName = header.SalesGroupName || '';

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
        SalesOffice: '',
        SalesOfficeName: '',
        SalesGroup: '',
        SalesGroupName: '',
        derived: false
      };
    }

    const sCust = String(sCustomer).trim();
    let sName = '';
    let sCity = '';
    let sCountry = '';
    let sCurrency = 'INR';
    let sOffice = '';
    let sOfficeName = '';
    let sGroup = '';
    let sGroupName = '';

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
            .columns('TransactionCurrency', 'SalesOrganization', 'DistributionChannel', 'OrganizationDivision', 'SalesOffice', 'SalesGroup')
            .where({ SoldToParty: sCust })
            .limit(5)
        );
        const aInqs = Array.isArray(inqRows) ? inqRows : (inqRows?.value || []);
        for (const inq of aInqs) {
          if (inq?.TransactionCurrency && !sCurrency) sCurrency = inq.TransactionCurrency;
          if (inq?.SalesOffice && !sOffice) sOffice = inq.SalesOffice;
          if (inq?.SalesGroup && !sGroup) sGroup = inq.SalesGroup;
        }

        // If no office found on customer history, query valid office for provided sales area
        if (!sOffice && sOrg) {
          const areaOffices = await this.s4hanaWL.run(
            SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp')
              .where({
                SalesOrganization: sOrg,
                DistributionChannel: sChannel || '10',
                OrganizationDivision: sDivision || '52'
              })
              .limit(1)
          );
          const oMatch = Array.isArray(areaOffices) ? areaOffices[0] : (areaOffices?.value?.[0] || null);
          if (oMatch?.SalesOffice) {
            sOffice = oMatch.SalesOffice;
            sOfficeName = oMatch.SalesOfficeName || '';
          }
        }

        if (sOffice && !sOfficeName) {
          const oVH = await this.s4hanaWL.run(
            SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: sOffice })
          );
          if (oVH?.SalesOfficeName) sOfficeName = oVH.SalesOfficeName;
        }

        if (sOffice && !sGroup) {
          const gRows = await this.s4hanaWL.run(
            SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesOffice: sOffice }).limit(1)
          );
          const gRow = Array.isArray(gRows) ? gRows[0] : (gRows?.value?.[0] || null);
          if (gRow?.SalesGroup) {
            sGroup = gRow.SalesGroup;
            sGroupName = gRow.SalesGroupName || '';
          }
        }

        if (sGroup && !sGroupName) {
          const gVH = await this.s4hanaWL.run(
            SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesGroup: sGroup })
          );
          if (gVH?.SalesGroupName) sGroupName = gVH.SalesGroupName;
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
      SalesOffice: sOffice,
      SalesOfficeName: sOfficeName,
      SalesGroup: sGroup,
      SalesGroupName: sGroupName,
      derived: Boolean(sName || sCity || sOffice)
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

    // Quotation-readiness fields: only those the service exposes can be transmitted.
    const notTransmitted = [];
    const provided = INQUIRY_EXTENSION_FIELDS.filter(f => String(header[f] ?? '').trim() !== '');
    if (provided.length > 0) {
      const fields = await this._getLeanOrderFields(destination, executeFn);
      for (const f of provided) {
        if (fields.header.has(f)) headerPayload[f] = String(header[f]).trim();
        else notTransmitted.push(f);
      }
      if (notTransmitted.length > 0) {
        console.warn(`[SalesInquiryAdapter] LORD_ODATA_ORDER_SRV has no field for ${notTransmitted.join(', ')};`
          + ' the inquiry will stay incomplete for quotation until these are maintained in VA22 or the service is extended.');
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
      TransactionCurrency: header.TransactionCurrency || headerResp.data?.d?.Currency || 'INR',
      notTransmitted
    };
  }

  /**
   * Property names of the LORD_ODATA_ORDER_SRV Header and Item entities, read once from the live
   * $metadata and cached for the process. A failed read is not cached and yields empty sets, so
   * inquiry creation still works with the standard fields.
   */
  async _getLeanOrderFields(destination, executeFn) {
    if (this._leanOrderFields) return this._leanOrderFields;
    const empty = { header: new Set(), item: new Set() };
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
      const fields = { header: props('Header'), item: props('Item') };
      if (fields.header.size === 0) {
        console.warn('[SalesInquiryAdapter] LORD_ODATA_ORDER_SRV $metadata returned no Header properties; capabilities unknown.');
        return empty;
      }
      this._leanOrderFields = fields;
      return fields;
    } catch (err) {
      console.warn('[SalesInquiryAdapter] Could not read LORD_ODATA_ORDER_SRV $metadata:', err.message);
      return empty;
    }
  }

  /**
   * Reports which quotation-required fields the SAP inquiry creation service can accept right now.
   * The UI marks accepted fields as required and tells the user to maintain the others in VA22.
   */
  async getInquiryCreationCapabilities(options = {}) {
    const destination = options.destination || await this._getDestination();
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;
    const fields = await this._getLeanOrderFields(destination, executeFn);
    const caps = { service: 'LORD_ODATA_ORDER_SRV' };
    for (const f of INQUIRY_EXTENSION_FIELDS) caps[f] = fields.header.has(f);
    caps.Plant = fields.item.has('Plant');
    return caps;
  }

  /**
   * Sales order counts read live from SAP S/4HANA (SD_F1873_SO_WL_SRV, entity C_SalesOrderWl_F1873):
   * open orders (OverallSDProcessStatus ne 'C') and all orders.
   *
   * Fails when the destination cannot be resolved or SAP does not return both counts; no count is
   * ever defaulted.
   *
   * @param {Object} [options] - destination / executeHttpRequest / headers overrides
   * @returns {Promise<{ openOrdersCount: number, totalOrdersCount: number }>}
   * @throws {Error} status 503 without a destination, 502 when SAP could not be read
   */
  async getSalesMetrics(options = {}) {
    let dest;
    try {
      dest = options.destination || await this._getDestination();
    } catch (e) {
      const err = new Error(`Sales order metrics are not available: ${e.message}`);
      err.status = 503;
      throw err;
    }

    const servicePath = '/sap/opu/odata/sap/SD_F1873_SO_WL_SRV';
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;
    const request = (query) => executeFn(dest, {
      method: 'get',
      url: `${servicePath}/C_SalesOrderWl_F1873?${query}`,
      headers: { 'Accept': 'application/json', ...(options.headers || {}) }
    });
    const countOf = (res) => {
      const raw = res?.data?.d?.__count ?? res?.data?.['@odata.count'];
      const n = Number(raw);
      return raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isInteger(n) && n >= 0 ? n : null;
    };

    let resOpen;
    let resTotal;
    try {
      [resOpen, resTotal] = await Promise.all([
        request("$inlinecount=allpages&$top=1&$filter=OverallSDProcessStatus ne 'C'"),
        request('$inlinecount=allpages&$top=1')
      ]);
    } catch (e) {
      const err = new Error(`Sales order metrics could not be read from SD_F1873_SO_WL_SRV: ${e.message}`);
      err.status = 502;
      throw err;
    }

    const openOrdersCount = countOf(resOpen);
    const totalOrdersCount = countOf(resTotal);
    if (openOrdersCount === null || totalOrdersCount === null) {
      const err = new Error('Sales order metrics are not available: SD_F1873_SO_WL_SRV returned no count.');
      err.status = 502;
      throw err;
    }
    return { openOrdersCount, totalOrdersCount };
  }

  /**
   * Creates a Sales Quotation with reference to a Sales Inquiry in SAP, through the verified
   * OData V4 service UI_SALESQUOTATIONMANAGE (action CreateWithRefFromSlsInquiry, then SaveChanges
   * in the same sticky session). SAP's copy control from the inquiry supplies the document data;
   * only the header values the user entered in the create dialog are changed before saving.
   *
   * Call only when the user has confirmed creation: this persists a real SAP quotation.
   *
   * @param {string} sInquiryId
   * @param {Object} [options]
   * @param {string} [options.SalesQuotationType]
   * @param {string} [options.SalesQuotationDate]
   * @param {string} [options.BindingPeriodValidityEndDate]
   * @param {string} [options.PurchaseOrderByCustomer]
   * @returns {Promise<{ SalesQuote: string, SalesQuotation: string, createdVia: string }>}
   */
  async createSalesQuoteFromInquiry(sInquiryId, options = {}) {
    const salesInquiry = String(sInquiryId ?? '').trim();
    if (salesInquiry === '') {
      throw new Error('Sales Inquiry number is required.');
    }

    const salesQuotationType = String(
      options.SalesQuotationType || options.quotationType || process.env.S4_QUOTATION_TYPE || 'ZQT'
    ).trim();

    const client = options.quotationClient || new SalesQuotationManageClient({
      destination: options.destination || await this._getQuotationDestination(),
      executeHttpRequest: options.executeHttpRequest
    });

    try {
      const { SalesQuotation, verified } = await client.createFromInquiry({
        salesInquiry,
        salesQuotationType,
        header: {
          SalesQuotationDate: options.SalesQuotationDate,
          BindingPeriodValidityEndDate: options.BindingPeriodValidityEndDate,
          PurchaseOrderByCustomer: options.PurchaseOrderByCustomer
        }
      });
      console.info(`[SalesInquiryAdapter] Sales Quotation ${SalesQuotation} created in SAP from Inquiry ${salesInquiry}.`);
      return { SalesQuote: SalesQuotation, SalesQuotation, verified: verified === true, createdVia: 'UI_SALESQUOTATIONMANAGE' };
    } catch (err) {
      console.error(`[SalesInquiryAdapter] Sales Quotation creation from Inquiry ${salesInquiry} failed:`,
        err.sapCode ? `${err.sapCode} ${err.sapMessage || err.message}` : err.message);
      throw err;
    }
  }

  /**
   * Destination for Sales Quotation creation. SAP holds the quotation in a stateful HTTP session, so
   * this flow should run as a dedicated technical SAP user that nothing else (SAP GUI, browsers, other
   * applications or integrations) uses at the same time. Configure one of:
   *   S4_QUOTATION_DESTINATION_NAME          a BTP / registered destination for that user
   *   S4_QUOTATION_USERNAME + S4_QUOTATION_PASSWORD   credentials for that user on S4_DESTINATION_URL
   * Without either, the shared destination is used and a warning is logged on every creation.
   */
  async _getQuotationDestination() {
    const destinationName = String(process.env.S4_QUOTATION_DESTINATION_NAME || '').trim();
    if (destinationName) {
      const dest = await connectivity.getDestination({ destinationName });
      if (!dest) {
        throw new Error(`[SalesInquiryAdapter] Quotation destination '${destinationName}' (S4_QUOTATION_DESTINATION_NAME) not found.`);
      }
      return dest;
    }

    const username = String(process.env.S4_QUOTATION_USERNAME || '').trim();
    const password = process.env.S4_QUOTATION_PASSWORD || '';
    if (username || password) {
      if (!username || !password || !process.env.S4_DESTINATION_URL) {
        throw new Error('[SalesInquiryAdapter] Dedicated quotation user is incomplete: set S4_QUOTATION_USERNAME,'
          + ' S4_QUOTATION_PASSWORD and S4_DESTINATION_URL.');
      }
      if (username.toUpperCase() === String(process.env.S4_USERNAME || '').trim().toUpperCase()) {
        console.warn(`[SalesInquiryAdapter] S4_QUOTATION_USERNAME '${username}' is the same user as S4_USERNAME;`
          + ' it is not a dedicated technical user.');
      }
      return {
        url: process.env.S4_DESTINATION_URL,
        username,
        password,
        headers: { 'sap-client': process.env.S4_CLIENT || '220' }
      };
    }

    console.warn('[SalesInquiryAdapter] Sales Quotation creation is using the shared SAP destination, not a dedicated'
      + ' technical user. Configure S4_QUOTATION_DESTINATION_NAME or S4_QUOTATION_USERNAME/S4_QUOTATION_PASSWORD.');
    return this._getDestination();
  }
}

const defaultAdapter = new SalesInquiryAdapter();
defaultAdapter.SalesInquiryAdapter = SalesInquiryAdapter;

module.exports = defaultAdapter;
