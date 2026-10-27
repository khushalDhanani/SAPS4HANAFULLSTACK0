# Movement 261 startup warning: actual SAP discovery

Captured: 2026-10-27T04:18:54.414Z (2026-10-27, IST). Mode: READ-ONLY.

Six RFC_READ_TABLE calls through the existing RfcClient and readOnlyRfcGuard: DD03L field checks followed by T320, LAGP and T301T reads. Each query was capped at 500 data rows; no result reached the cap. The sandbox attempt failed with RFC_COMMUNICATION_FAILURE; the approved network-enabled retry succeeded. No SAP or configuration writes. Connection values and credentials are excluded. Sanitized raw output is retained locally at /tmp/mvt261-bin-discovery.json.

## Confirmed results

- T320 returned 17 mappings for plant 1120; each returned warehouse W01.
- LAGP selection: W01, storage types OH1, 917, 901, 902. Returned 16 rows: OH1 has ONHOLD; 901 has three dynamic bins; 902 has twelve bins including WE-ZONE; 917 returned no bin.
- Every returned LAGP row has blank SKZUA and SKZUE. This observation is not proof of unrestricted eligibility for any particular material/quant/transaction.
- English T301T descriptions: OH1 = Gr On-Hold Material; 917 = Quality Assurance; 901 = GR Area for Production; 902 = GR Area External Rcpts.
- The prior candidate 917/QUALITY is not present in these current LAGP results. No current exclusion rule is inferred from descriptions.

## Code/configuration diagnosis

- Both original startup checks called BusinessConfigResolver.resolve without plant or warehouse. The resolver requires scope before reading configuration; the server catch converted all failures into an empty-list warning.
- The local BusinessConfig table was inspected read-only and contains zero rows. The checked-in seed leaves Mvt261NotReadyBinsJson unset.
- Replaced duplicate checks with one service-owned audit after listening, selecting only active BusinessConfig rows and policy columns. It distinguishes no rows, scoped empty arrays, malformed/non-array JSON, and database failure. It audits persisted JSON presence, not policy approval or runtime enforcement.
- Runtime gap remains: Mvt261Adapter._getNotReadyBins has no repository callers. No request-time bin policy or posting behavior was changed in this diagnostic fix.

## Remaining blocker

No inspected SAP source establishes the custom Movement 261 exclusion list. Existing quant flags and stock-category checks are separate from a custom bin policy. The business rule must be established before activating additional exclusions; no bin values have been seeded, and no live configuration write is authorized by this discovery.
