'use strict';

const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-customer-defaults');
const { sapKey } = require('../../sapKey');

/**
 * Derives default organizational and commercial values for a customer.
 * Runs customer master lookup and historical inquiries in parallel, with
 * customer master details and value helps cached with a 5-minute TTL.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {string} sCustomer - Customer ID
 * @param {string} [_sOrg] - Sales Organization
 * @param {string} [_sChannel] - Distribution Channel
 * @param {string} [_sDivision] - Division
 * @returns {Promise<Object>}
 */
async function getCustomerDefaults(adapter, sCustomer, _sOrg, _sChannel, _sDivision) {
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
      PaymentTerms: '',
      Incoterms: '',
      IncotermsLocation1: '',
      INCO1: '',
      INCO2: '',
      validForSalesArea: true,
      salesAreaError: '',
      maintainedSalesAreasSummary: '',
      derived: false
    };
  }

  const sCust = String(sCustomer).trim();
  const sOrg = _sOrg ? String(_sOrg).trim() : '';
  const sChannel = _sChannel ? String(_sChannel).trim() : '';
  const sDivision = _sDivision ? String(_sDivision).trim() : '';
  let sName = '';
  let sCity = '';
  let sCountry = '';
  let sCurrency = '';
  let bDerived = false; // true when a value was taken from the customer's previous documents
  let sOffice = '';
  let sOfficeName = '';
  let sGroup = '';
  let sGroupName = '';
  let sPaymentTerms = '';
  let sInco1 = '';
  let sInco2 = '';
  let bValidForSalesArea = true;
  let sSalesAreaError = '';
  let sMaintainedSalesAreasSummary = '';

  await adapter.init();
  if (adapter.s4hanaWL) {
    try {
      // Parallel fetch: Customer master data (cached) + Customer historical inquiries + Customer sales areas (cached)
      const [custResult, inqResult, salesAreaResult] = await Promise.allSettled([
        adapter.customerMasterCache.getOrSet(sCust, async () => {
          const custRows = await adapter.s4hanaWL.run(
            cds.ql.SELECT.from('SD_F2370_INQY_WL_SRV.I_Customer_VH').where({ Customer: sCust }).limit(1)
          );
          const cust = Array.isArray(custRows) ? custRows[0] : (custRows?.value?.[0] || null);
          if (cust) {
            return {
              Name: cust.CustomerName || cust.OrganizationBPName1 || cust.BusinessPartnerName1 || '',
              City: cust.CityName || cust.BPAddrCityName || '',
              Country: cust.Country || ''
            };
          }
          return null;
        }),

        (async () => {
          return await adapter.s4hanaWL.run(
            cds.ql.SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370')
              .columns('TransactionCurrency', 'SalesOrganization', 'DistributionChannel', 'OrganizationDivision', 'SalesOffice', 'SalesGroup')
              .where({ SoldToParty: sCust })
              .limit(5)
          );
        })(),

        (async () => {
          if (!adapter.client || typeof adapter.client.get !== 'function') return null;
          if (process.env.NODE_ENV === 'test' && !adapter.client.get._isMockFunction) return null;
          return await adapter.customerSalesAreaCache.getOrSet(sCust, async () => {
            try {
              const res = await adapter.client.get(`/sap/opu/odata/sap/FAR_CUSTOMER_LIST_V2/C_CustomerList?$filter=Customer eq '${sCust}'`);
              const items = Array.isArray(res.data?.d?.results) ? res.data.d.results : (Array.isArray(res.data?.value) ? res.data.value : []);
              return items;
            } catch (e) {
              LOG.warn('FAR_CUSTOMER_LIST_V2 customer sales area lookup warning:', e.message);
              return null;
            }
          });
        })()
      ]);

      let bCustMasterFound = false;
      if (custResult.status === 'fulfilled' && custResult.value) {
        sName = custResult.value.Name || '';
        sCity = custResult.value.City || '';
        sCountry = custResult.value.Country || '';
        bCustMasterFound = true;
      }

      const rawInqs = inqResult.status === 'fulfilled' ? inqResult.value : [];
      const aInqs = Array.isArray(rawInqs) ? rawInqs : (rawInqs?.value || []);
      for (const inq of aInqs) {
        if (inq?.TransactionCurrency && !sCurrency) { sCurrency = inq.TransactionCurrency; bDerived = true; }
        if (inq?.SalesOffice && !sOffice) { sOffice = inq.SalesOffice; bDerived = true; }
        if (inq?.SalesGroup && !sGroup) { sGroup = inq.SalesGroup; bDerived = true; }
      }

      // Evaluate customer sales area maintenance from FAR_CUSTOMER_LIST_V2
      if (salesAreaResult.status === 'fulfilled' && Array.isArray(salesAreaResult.value) && salesAreaResult.value.length > 0) {
        const aRecords = salesAreaResult.value;
        const firstRec = aRecords[0];
        if (!bCustMasterFound) {
          if (!sName && firstRec.CustomerName) sName = firstRec.CustomerName;
          if (!sCity && firstRec.CityName) sCity = firstRec.CityName;
          if (!sCountry && firstRec.Country) sCountry = firstRec.Country;
        }

        if (sOrg || sChannel || sDivision) {
          const matchingArea = aRecords.find(r =>
            (!sOrg || r.SalesOrganization === sOrg) &&
            (!sChannel || r.DistributionChannel === sChannel) &&
            (!sDivision || r.Division === sDivision)
          );

          if (matchingArea) {
            bValidForSalesArea = true;
            if (matchingArea.SalesOffice && !sOffice) sOffice = matchingArea.SalesOffice;
            if (matchingArea.SalesGroup && !sGroup) sGroup = matchingArea.SalesGroup;
            if (matchingArea.CustomerPaymentTerms || matchingArea.PaymentTerms) {
              sPaymentTerms = matchingArea.CustomerPaymentTerms || matchingArea.PaymentTerms;
            }
            if (matchingArea.Incoterms || matchingArea.IncotermsClassification || matchingArea.INCO1) {
              sInco1 = matchingArea.Incoterms || matchingArea.IncotermsClassification || matchingArea.INCO1;
            }
            if (matchingArea.IncotermsLocation1 || matchingArea.IncotermsTransferLocation || matchingArea.INCO2 || matchingArea.INCO2_L) {
              sInco2 = matchingArea.IncotermsLocation1 || matchingArea.IncotermsTransferLocation || matchingArea.INCO2 || matchingArea.INCO2_L;
            }
          } else {
            bValidForSalesArea = false;
            const aAreas = aRecords.map(r => `${r.SalesOrganization || ''} ${r.DistributionChannel || ''} ${r.Division || ''}`.trim()).filter(Boolean);
            sMaintainedSalesAreasSummary = [...new Set(aAreas)].join(', ');
            sSalesAreaError = `Sold-to party ${sCust} not maintained for sales area ${sOrg} ${sChannel} ${sDivision}`;
          }
        }
      }

      if (sOffice && !sOfficeName) {
        try {
          sOfficeName = await adapter.salesOfficeVhCache.getOrSet(`office:${sOffice}`, async () => {
            const oVH = await adapter.s4hanaWL.run(
              cds.ql.SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: sOffice })
            );
            return oVH?.SalesOfficeName || '';
          });
        } catch (e) {
          LOG.warn(`Could not resolve sales office name for ${sOffice}:`, e.message);
        }
      }

      if (sGroup && !sGroupName) {
        try {
          const grpName = await adapter.salesGroupVhCache.getOrSet(`group_name:${sGroup}`, async () => {
            const gVH = await adapter.s4hanaWL.run(
              cds.ql.SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesGroup: sGroup })
            );
            return gVH?.SalesGroupName || '';
          });
          if (grpName) sGroupName = grpName;
        } catch (e) {
          LOG.warn(`Could not resolve customer sales group name for ${sGroup}:`, e.message);
        }
      }
    } catch (err) {
      LOG.warn('getCustomerDefaults remote query warning:', err.message);
    }
  }

  // Direct RFC read on KNVV (Customer Master Sales Data) for INCO1, INCO2, ZTERM, VKBUR, VKGRP
  if (adapter.rfc && typeof adapter.rfc.readTable === 'function') {
    try {
      const sCustPadded = sapKey(sCust, 'kunnr').padStart(10, '0');
      const sOrgKey = sOrg ? sapKey(sOrg, 'vkorg') : '';
      const sChannelKey = sChannel ? sapKey(sChannel, 'vtweg') : '';
      const sDivisionKey = sDivision ? sapKey(sDivision, 'spart') : '';
      const knvvWhere = [`KUNNR = '${sCustPadded}'`];
      if (sOrgKey) knvvWhere.push(`AND VKORG = '${sOrgKey}'`);
      if (sChannelKey) knvvWhere.push(`AND VTWEG = '${sChannelKey}'`);
      if (sDivisionKey) knvvWhere.push(`AND SPART = '${sDivisionKey}'`);
      let knvvRows = await adapter.rfc.readTable('KNVV', ['INCO1', 'INCO2', 'ZTERM', 'VKBUR', 'VKGRP'], knvvWhere).catch(() => []);
      if ((!knvvRows || knvvRows.length === 0) && (sOrg || sChannel || sDivision)) {
        knvvRows = await adapter.rfc.readTable('KNVV', ['INCO1', 'INCO2', 'ZTERM', 'VKBUR', 'VKGRP'], [`KUNNR = '${sCustPadded}'`]).catch(() => []);
      }
      if (knvvRows && knvvRows.length > 0) {
        const kRow = knvvRows[0];
        if (kRow.INCO1 && !sInco1) sInco1 = kRow.INCO1.trim();
        if (kRow.INCO2 && !sInco2) sInco2 = kRow.INCO2.trim();
        if (kRow.ZTERM && !sPaymentTerms) sPaymentTerms = kRow.ZTERM.trim();
        if (kRow.VKBUR && !sOffice) sOffice = kRow.VKBUR.trim();
        if (kRow.VKGRP && !sGroup) sGroup = kRow.VKGRP.trim();
      }
    } catch (knvvErr) {
      LOG.warn('KNVV customer lookup warning:', knvvErr.message);
    }
  }

  return {
    Customer: sCust,
    CustomerName: sName,
    City: sCity,
    Country: sCountry,
    Currency: sCurrency,
    ShipToParty: '',
    ShipToPartyName: '',
    SalesOffice: sOffice,
    SalesOfficeName: sOfficeName,
    SalesGroup: sGroup,
    SalesGroupName: sGroupName,
    PaymentTerms: sPaymentTerms,
    Incoterms: sInco1,
    IncotermsLocation1: sInco2,
    INCO1: sInco1,
    INCO2: sInco2,
    validForSalesArea: bValidForSalesArea,
    salesAreaError: sSalesAreaError,
    maintainedSalesAreasSummary: sMaintainedSalesAreasSummary,
    derived: bDerived
  };
}

module.exports = {
  getCustomerDefaults
};
