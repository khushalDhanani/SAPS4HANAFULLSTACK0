-- Additive local-dev migration for HU storage-type policy fields.
-- Run once against an existing db.sqlite after backup:
--   sqlite3 db.sqlite < db-migrate-20261026-business-config-hu-storage-types.sql
-- HU storage-type list columns are intentionally blank; no policy values are seeded.
-- Oversize-HU setting: “default BLOCK, pending the user's confirmation”.
BEGIN;
ALTER TABLE saps4hana_wm_BusinessConfig ADD COLUMN PickableStorageTypes NVARCHAR(200);
ALTER TABLE saps4hana_wm_BusinessConfig ADD COLUMN HoldStorageTypes NVARCHAR(200);
ALTER TABLE saps4hana_wm_BusinessConfig ADD COLUMN InterimStorageTypes NVARCHAR(200);
ALTER TABLE saps4hana_wm_BusinessConfig ADD COLUMN OversizeHuSelectionBehavior NVARCHAR(5) DEFAULT 'BLOCK';

DROP VIEW saps4hana_wm_BusinessConfigService_BusinessConfigs;
CREATE VIEW saps4hana_wm_BusinessConfigService_BusinessConfigs AS SELECT
  BusinessConfig_0.createdAt,
  BusinessConfig_0.createdBy,
  BusinessConfig_0.modifiedAt,
  BusinessConfig_0.modifiedBy,
  BusinessConfig_0.Plant,
  BusinessConfig_0.WarehouseNumber,
  BusinessConfig_0.SalesOrganization,
  BusinessConfig_0.DistributionChannel,
  BusinessConfig_0.Division,
  BusinessConfig_0.Currency,
  BusinessConfig_0.InquiryType,
  BusinessConfig_0.OrderType,
  BusinessConfig_0.ConditionType,
  BusinessConfig_0.ShippingPoints,
  BusinessConfig_0.SalesMaterialTypes,
  BusinessConfig_0.DifferenceStorageType,
  BusinessConfig_0.Mvt261NotReadyBinsJson,
  BusinessConfig_0.PickableStorageTypes,
  BusinessConfig_0.HoldStorageTypes,
  BusinessConfig_0.InterimStorageTypes,
  BusinessConfig_0.OversizeHuSelectionBehavior,
  BusinessConfig_0.Description,
  BusinessConfig_0.Active
FROM saps4hana_wm_BusinessConfig AS BusinessConfig_0;
COMMIT;
PRAGMA integrity_check;
