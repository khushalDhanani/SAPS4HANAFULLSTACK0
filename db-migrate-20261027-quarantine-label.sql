BEGIN;
ALTER TABLE saps4hana_wm_BusinessConfig ADD COLUMN QuarantineLabelForm NVARCHAR(30);
ALTER TABLE saps4hana_wm_BusinessConfig ADD COLUMN QuarantineLabelSize NVARCHAR(10);
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
  BusinessConfig_0.QuarantineLabelForm,
  BusinessConfig_0.QuarantineLabelSize,
  BusinessConfig_0.Description,
  BusinessConfig_0.Active
FROM saps4hana_wm_BusinessConfig AS BusinessConfig_0;
COMMIT;
