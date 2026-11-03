// ZWM_POST_ATTEMPT - proposal, NOT created, NOT activated, NOT tested.
// Package ZAMM (user's choice, 2026-11-03). Transport request and target system are pending.
// One row per posting attempt, written and committed BEFORE the goods movement is sent, so that a second
// request or a second app instance cannot post the same movement. The primary key is what makes a claim atomic.
// Replaces db/wm/goods-issue-attempt.cds; fields match that entity, without its createdBy and modified fields.
// Function group: docs/abap/zwm_post_attempt.fugr.abap. Design and live proof: docs/decisions/sap-only-persistence-migration.md.
@EndUserText.label : 'WM posting attempts (double-post guard)'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zwm_post_attempt {
  key mandt          : mandt not null;
  key reference_document : abap.char(16) not null;
  request_hash       : abap.char(64);
  movement_type      : abap.char(3);
  reservation_no     : abap.char(10);
  reservation_item   : abap.char(6);
  material           : abap.char(40);
  plant              : abap.char(4);
  storage_location   : abap.char(4);
  cost_center        : abap.char(10);
  issue_qty          : abap.dec(13,3);
  unit               : abap.char(10);
  posting_user       : abap.char(255);
  posting_date       : abap.dats;
  status             : abap.char(20);
  created_at         : timestampl;
  resolved_at        : timestampl;
  material_document  : abap.char(10);
  material_doc_year  : abap.char(4);
  delivery_number    : abap.char(10);
  last_error         : abap.char(500);
}
