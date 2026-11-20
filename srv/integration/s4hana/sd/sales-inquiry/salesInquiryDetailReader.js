'use strict';

const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-detail-reader');

/**
 * Retrieves single Sales Inquiry details by ID directly from S/4HANA.
 * Runs independent worklist header, factsheet header, and factsheet items in parallel.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {string|number} sId - Sales Inquiry ID
 * @returns {Promise<Object|null>} { header, items, itemsUnavailable, itemsUnavailableReason } or null
 */
async function getInquiry(adapter, sId) {
  const sKey = String(sId).trim();
  await adapter.init();
  let header = null;
  let items = [];

  // Parallel fetch: worklist header, factsheet header with partner cards, and factsheet items
  const [wlResult, fsHeaderResult, fsItemsResult] = await Promise.allSettled([
    // 1. Fetch worklist header record (contains OrganizationBPName1, CreationDate, CreatedByUser, SalesOffice, SalesGroup, etc.)
    (async () => {
      if (!adapter.s4hanaWL) return null;
      try {
        return await adapter.s4hanaWL.run(
          cds.ql.SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370', inq => {
            inq('*');
            inq.to_SalesOffice('*');
            inq.to_SalesGroup('*');
          }).where({ SalesInquiry: sKey })
        );
      } catch (_e) {
        // Fallback to simple select if navigation expansion fails
        try {
          return await adapter.s4hanaWL.run(
            cds.ql.SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').where({ SalesInquiry: sKey })
          );
        } catch (innerErr) {
          LOG.warn('Error fetching WL record for inquiry:', innerErr.message);
          throw innerErr;
        }
      }
    })(),

    // 2. Fetch factsheet header record and partner cards (contains CustomerPurchaseOrderDate, Validity Dates, Partners)
    (async () => {
      if (!adapter.s4hanaFS) return null;
      try {
        return await adapter.s4hanaFS.run(
          cds.ql.SELECT.one.from('SD_F2369_INQY_FS_SRV.C_Inquiryfs', doc => {
            doc('*');
            doc.to_SDDocumentPartnerCard('*');
          }).where({ SalesInquiry: sKey })
        );
      } catch (fse) {
        LOG.warn('Error fetching FS record for inquiry:', fse.message);
        throw fse;
      }
    })(),

    // 3. Fetch items with computed NetPriceAmount
    (async () => {
      if (!adapter.s4hanaFS) return [];
      try {
        return await adapter.s4hanaFS.run(
          cds.ql.SELECT.from('SD_F2369_INQY_FS_SRV.C_Inquiryitemfs').where({ SalesInquiry: sKey })
        );
      } catch (ie) {
        LOG.warn('Error fetching items for inquiry:', ie.message);
        throw ie;
      }
    })()
  ]);

  const res = wlResult.status === 'fulfilled' ? wlResult.value : null;
  if (res) {
    header = { ...res };
    if (res.to_SalesOffice?.SalesOfficeName) {
      header.SalesOfficeName = res.to_SalesOffice.SalesOfficeName;
    }
    if (res.to_SalesGroup?.SalesGroupName) {
      header.SalesGroupName = res.to_SalesGroup.SalesGroupName;
    }
  }

  const fsDoc = fsHeaderResult.status === 'fulfilled' ? fsHeaderResult.value : null;
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
    const contact = partners.find(p => p.PartnerFunction === 'ZP' || p.PartnerFunction === 'CP');
    if (contact) {
      header.ContactPersonName = contact.FullName || '';
      header.ContactPerson = contact.ContactPerson || contact.Personnel || contact.BusinessPartner || '';
    }
    const salesEmp = partners.find(p => p.PartnerFunction === 'ZE');
    if (salesEmp) {
      header.SalesEmployeeName = salesEmp.FullName;
    }
  }

  // Check for outage when header could not be read
  const headerFailures = [];
  if (wlResult.status === 'rejected') {
    headerFailures.push(`WL: ${wlResult.reason?.message || 'failed'}`);
  }
  if (fsHeaderResult.status === 'rejected') {
    headerFailures.push(`FS: ${fsHeaderResult.reason?.message || 'failed'}`);
  }

  if (!header && headerFailures.length > 0) {
    LOG.error(`Failed to read Sales Inquiry ${sKey} from SAP S/4HANA:`, headerFailures.join('; '));
    const err = new Error(`Sales Inquiry ${sKey} could not be read from SAP S/4HANA (${headerFailures.join('; ')}).`);
    err.status = 502;
    throw err;
  }

  let itemsUnavailable = false;
  let itemsUnavailableReason = '';
  if (fsItemsResult.status === 'rejected') {
    itemsUnavailable = true;
    itemsUnavailableReason = fsItemsResult.reason?.message || 'Factsheet item service error';
    LOG.warn(`Line items for inquiry ${sKey} were unavailable:`, itemsUnavailableReason);
  }

  const itemRes = fsItemsResult.status === 'fulfilled' ? fsItemsResult.value : [];
  const rawItems = Array.isArray(itemRes) ? itemRes : (itemRes?.value || itemRes?.d?.results || []);
  items = rawItems.map(item => {
    const price = (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && item.NetPriceAmount !== '')
      ? String(item.NetPriceAmount)
      : '';
    return {
      ...item,
      NetPriceAmount: price
    };
  });

  if (header) {
    header.ShipToParty = header.ShipToParty || '';
    header.ShipToPartyName = header.ShipToPartyName || '';

    // 4. Resolve descriptions (names) for authentic SalesOffice and SalesGroup present on the SAP document
    if (adapter.s4hanaWL) {
      const sOff = header.SalesOffice ? String(header.SalesOffice).trim() : '';
      const sGrp = header.SalesGroup ? String(header.SalesGroup).trim() : '';

      const needsOfficeName = sOff && (!header.SalesOfficeName || header.SalesOfficeName.trim() === '');
      const needsGroupName = sGrp && (!header.SalesGroupName || header.SalesGroupName.trim() === '');

      if (needsOfficeName || needsGroupName) {
        const [nameRes, groupNameRes] = await Promise.allSettled([
          needsOfficeName ? adapter.salesOfficeVhCache.getOrSet(`office:${sOff}`, async () => {
            const oVH = await adapter.s4hanaWL.run(
              cds.ql.SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: sOff })
            );
            return oVH?.SalesOfficeName || '';
          }) : Promise.resolve(header.SalesOfficeName || ''),

          needsGroupName ? adapter.salesGroupVhCache.getOrSet(`group_name:${sGrp}`, async () => {
            const gVH = await adapter.s4hanaWL.run(
              cds.ql.SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesGroup: sGrp })
            );
            return gVH?.SalesGroupName || '';
          }) : Promise.resolve(header.SalesGroupName || '')
        ]);

        if (needsOfficeName && nameRes.status === 'fulfilled' && nameRes.value) {
          header.SalesOfficeName = nameRes.value;
        }
        if (needsGroupName && groupNameRes.status === 'fulfilled' && groupNameRes.value) {
          header.SalesGroupName = groupNameRes.value;
        }
      }
    }

    header.SalesOffice = header.SalesOffice || '';
    header.SalesOfficeName = header.SalesOfficeName || '';
    header.SalesGroup = header.SalesGroup || '';
    header.SalesGroupName = header.SalesGroupName || '';

    return { header, items, itemsUnavailable, itemsUnavailableReason };
  }

  return null;
}

module.exports = {
  getInquiry
};
