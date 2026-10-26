-- Local SQLite only: create BusinessConfig when its table and projection are absent.
-- Generated from srv/wm/business-config/service.cds; no seed data.
-- Back up the active database and obtain an explicit go before applying.
BEGIN;

CREATE TABLE saps4hana_wm_BusinessConfig (
  createdAt TIMESTAMP_TEXT,
  createdBy NVARCHAR(255),
  modifiedAt TIMESTAMP_TEXT,
  modifiedBy NVARCHAR(255),
  Plant NVARCHAR(4) NOT NULL,
  WarehouseNumber NVARCHAR(3) NOT NULL,
  SalesOrganization NVARCHAR(4),
  DistributionChannel NVARCHAR(2),
  Division NVARCHAR(2),
  Currency NVARCHAR(5),
  InquiryType NVARCHAR(4),
  OrderType NVARCHAR(4),
  ConditionType NVARCHAR(4),
  ShippingPoints NVARCHAR(200),
  SalesMaterialTypes NVARCHAR(100),
  DifferenceStorageType NVARCHAR(3),
  Mvt261NotReadyBinsJson NVARCHAR(2000),
  PickableStorageTypes NVARCHAR(200),
  HoldStorageTypes NVARCHAR(200),
  InterimStorageTypes NVARCHAR(200),
  OversizeHuSelectionBehavior NVARCHAR(5) DEFAULT 'BLOCK',
  Description NVARCHAR(100),
  Active BOOLEAN DEFAULT TRUE,
  PRIMARY KEY(Plant, WarehouseNumber),
  CONSTRAINT saps4hana_wm_BusinessConfig_plantWarehouse UNIQUE (Plant, WarehouseNumber)
);

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
