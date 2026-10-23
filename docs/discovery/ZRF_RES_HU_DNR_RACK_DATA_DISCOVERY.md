# ZRF_RES_HU_DNR Rack Data Discovery

**Status: BLOCKED — SAP READ-ONLY ACCESS REQUIRED**  
**Discovery date:** 2026-10-23  
**Scope:** Read-only source discovery only. No SAP calls or writes were made. No adapters, posting logic, or UI code were changed.

## Discovery result

This session has no live SAP read-only connection or SAP discovery tool. The available tool inventory exposed no SAP, RFC, OData, CDS MCP, or UI5 MCP tools. Repository code and a saved ABAP source file were inspected, but neither is evidence of live SAP configuration, actual field contents, or field semantics. No live examples can therefore be reported.

The exact success condition—proving the source of every Rack Visualizer field from SAP—has not been met. Do not treat candidate objects or fields below as verified SAP mappings.

## A. Verified SAP Sources

**No live SAP sources were verified.** The following is a source inventory of what local code attempts to read, not a verified SAP contract:

| UI Field | SAP Object | Technical Field | Example Value | Meaning Verified? | Evidence |
| --- | --- | --- | --- | --- | --- |
| Warehouse | Candidate `LQUA` | `LGNUM` | Not available | NOT VERIFIED | Adapter selects it from `LQUA`; no live record. `srv/integration/s4hana/wm/HuStockTransferAdapter.js:751-755` |
| Storage Type | Candidate `LQUA` | `LGTYP` | Not available | NOT VERIFIED | Adapter selects it from `LQUA`; no live record. Same file:751-755 |
| Rack | Unknown | Unknown | Not available | NOT VERIFIED | No live source or records; current implementation derives it from bin text. Same file:846-848 |
| Bay | Unknown | Unknown | Not available | NOT VERIFIED | No live source or records; current implementation exposes only a bin suffix as `BinPosition`. Same file:809-810 |
| Level | Unknown | Unknown | Not available | NOT VERIFIED | Current implementation parses trailing digits of the bin string. Same file:830-852 |
| Storage Bin | Candidate `LQUA`; saved ABAP also reads `LAGP` | `LGPLA` | Not available | NOT VERIFIED | `LQUA` query in adapter lines 751-755; saved ABAP reads `LAGP` lines 2008-2017. No live records. |
| Bin Type | Candidate `LAGP` | `LPTYP` | Not available | NOT VERIFIED | Appears in saved ABAP source only: `docs/abap/zrf_res_hu_transfer_dnr.abap:2008-2017`. |
| Empty / Occupied status | Unknown authoritative source | Unknown | Not available | NOT VERIFIED | Current adapter filters positive `LQUA-GESME` rows; no complete location universe was queried. Same file:761. |
| HU | Candidate `LQUA` | `LENUM`, `KZHUQ` | Not available | NOT VERIFIED | Selected and used for a local category decision; no live example or metadata. Same file:751-755, 799-803. |
| Material | Candidate `LQUA` query filter | `MATNR` | Not available | NOT VERIFIED | Adapter filters by reservation material but does not return it in the bin response. Same file:740-745. |
| Batch | Candidate `LQUA` | `CHARG` | Not available | NOT VERIFIED | Selected in adapter; no live example. Same file:751-755, 812-815. |
| Quantity | Candidate `LQUA` | `GESME` | Not available | NOT VERIFIED | Selected, parsed, and filtered locally; no live example or unit/meaning confirmation. Same file:751-755, 761, 812-814. |
| Section / color classification | Candidate `LAGP` / `T302T` in saved ABAP | `LGBER` / `LBERT` | Not available | NOT VERIFIED | Saved ABAP source only: `docs/abap/zrf_res_hu_transfer_dnr.abap:2008-2029`. No live records or confirmed color source. |

## B. Rack / Bay / Level Mapping

**NOT VERIFIED.** No live metadata, system records, or multiple-bin examples were available to determine whether rack, bay, or level are stored directly, encoded in `LGPLA`, or sourced from another master object/API.

Local implementation behavior is demonstrably based on transformations in code, but that does not validate them against SAP:

- `getVisualRack` parses the trailing digits of `StorageBin` and maps numbers 0–6 to `B0`–`B6` (`HuStockTransferAdapter.js:830-852`).
- It assigns `RackReference` from storage type and bin suffix, `FloorId` from the parsed level, and `RackNumber` from the first hyphen-separated token (same file:844-852).
- The saved ABAP source reads candidate `LAGP-LPTYP` and prefers it for the “position”; if it is empty, it splits or trims `LGPLA` (`docs/abap/zrf_res_hu_transfer_dnr.abap:2863-2894`). That ABAP source itself documents a parsing fallback, so it cannot prove the actual live layout convention.

No derivation was tested against live SAP records. The current `getVisualRack` string parsing must not be used as authoritative rack/bay/level data.

## C. Complete Bin Source

**NOT VERIFIED.** The current adapter reads `LQUA` for the reservation material and filters to rows where parsed `GESME > 0` (`HuStockTransferAdapter.js:742-761`). This is an occupied-stock query, not proof of the complete storage-bin universe.

The saved ABAP source includes a read of candidate `LAGP` rows with `LGNUM`, `LGTYP`, `LGPLA`, `LGBER`, and `LPTYP` (`zrf_res_hu_transfer_dnr.abap:2008-2017`). It is only repository evidence that this source was used by that source file. There was no live check of coverage, deletion/lock/status fields, authorization, or whether it represents every relevant bin.

## D. Empty Bin Determination

**NOT VERIFIED.** Empty bins cannot be inferred from absent `LQUA` rows. No authoritative live bin-master source or status fields were verified. The adapter's positive-quantity filter omits rows without positive quantity and has no all-bin source (`HuStockTransferAdapter.js:749-761`).

There is no verified way in this session to distinguish **Occupied**, **Empty**, **Blocked**, and **Unavailable** bins. The local `StorageStatus` labels are generated by application rules over returned occupied rows, not proven bin-master status (`HuStockTransferAdapter.js:781-797`).

## E. HU / Material Occupancy

**NOT VERIFIED from live SAP.** Local code attempts to obtain material, warehouse, storage type/bin, unit number, batch, quantity, and unit from `LQUA`; it uses `LENUM` and `KZHUQ` to classify a row as HU/SU/BIN (`HuStockTransferAdapter.js:740-755, 799-815`). There are no live examples to prove the classifications or to cross-check `SAP Bin → Rack → Bay → Level → Occupancy → HU → Material` for even one bin.

No cross-check records or example values are available.

## F. Section / Classification Source

**NO VERIFIED SAP SOURCE FOUND.** The live SAP system was unavailable. The saved ABAP source reads candidate `LAGP-LGBER` and `T302T-LBERT` (`zrf_res_hu_transfer_dnr.abap:2008-2029`), but no live values or text meanings were checked. Current CAP adapter returns blank `StorageSection` and `StorageSectionDesc` (`HuStockTransferAdapter.js:807-808`).

No SAP source for hazardous, cold-chain, priority, or other color classification was verified. No section-to-color mapping is supported by this discovery.

## G. Physical Rack Master Data

**NOT VERIFIED.** No live objects, fields, metadata, or records were available to verify rack height, number of levels, number of bays, bin or pallet capacity, weight capacity, rack type, beam information, or physical dimensions. None of these fields is present in the existing `VisualRackBin` response type (`srv/wm/hu-stock-transfer/service.cds:111-136`). No screenshot values are treated as master data.

## H. `getVisualRack` Comparison

| Current code behavior | Verified SAP behavior | Assessment |
| --- | --- | --- |
| Calls `getStorageBins` and maps only its returned rows (`HuStockTransferAdapter.js:826-829`). | No live behavior checked. | Incomplete for a complete bin universe; exact live coverage NOT VERIFIED. |
| Parses level from bin-name trailing digits and labels 0–6 as B0–B6 (`:830-852`). | No live record set tested. | NOT VERIFIABLE; cannot be treated as authoritative. |
| Synthesizes `RackReference`, `FloorId`, and `RackNumber` from storage type, parsed level, and bin text (`:844-852`). | No live rack master or mapping verified. | Inferred application values; not verified SAP values. |
| Copies storage-type description into `StorageSectionDesc` (`:853`). | No verified section source; upstream `StorageSectionDesc` is blank (`:807-808`). | Incorrect as a section mapping based on current code. |
| Carries unit, quantity, batch, storage type, and warehouse from `getStorageBins`. | Source fields and semantics not checked live. | NOT VERIFIABLE against SAP. |

## I. `getStorageBins` Comparison

| Current code behavior | Verified SAP behavior | Assessment |
| --- | --- | --- |
| Reads candidate `LQUA` fields for one reservation material, then filters `GESME > 0` (`HuStockTransferAdapter.js:740-761`). | No live query or response. | Incomplete for all bins and empty-bin discovery; object/field semantics NOT VERIFIED live. |
| Uses `LGTYP`/`LGPLA` string tags and type prefixes to label hold/in-process/available (`:781-797`). | No live bin status/master data checked. | Status labels are application heuristics, not verified SAP status. |
| Returns unit, batch, quantity, UoM, bin, storage type, warehouse, and storage location from selected row fields (`:799-818`). | No live examples. | Mapping exists in code; SAP meaning and accuracy NOT VERIFIED. |
| Returns empty section and section description, and takes last two bin characters as `BinPosition` (`:807-810`). | No live section/bay/level validation. | Section missing; bin-position interpretation NOT VERIFIED. |
| Does not return material or serial number from the response mapping (`:799-818`). | No live comparison. | Material is a query filter rather than response data; serial is hard-coded blank. |

## J. Exact Fiori Data Contract

**No rack Fiori contract can be proposed from this discovery.** Per the requirement to include only SAP-verified fields, zero rack-layout, location-status, section, physical-capacity, or color fields have a verified live source. Existing `VisualRackBin` CDS fields are a local contract, not proof of SAP provenance (`srv/wm/hu-stock-transfer/service.cds:111-136`).

The contract must remain undefined until SAP read-only discovery verifies sources and examples. In particular, do not include `rackId`, `bayId`, `levelId`, `occupancyStatus`, `capacity`, section/color, or a physical specification without that evidence.

## K. Unknowns

- Exact live SAP system/client, active interface/API, metadata, authorization, and read-only access path.
- Source and meaning of warehouse and storage-type fields in the target system.
- Whether rack, bay, and level are stored fields, bin-name components, or sourced elsewhere.
- Complete relevant bin/location master and fields for blocked/unavailable status.
- Authoritative empty-bin determination.
- HU identifier/classification and material/quantity/batch cross-check across multiple actual bins.
- Section source and any classification semantics; no verified SAP color source.
- Physical rack dimensions, configuration, and load/capacity fields.
- Whether the candidate tables and fields in the repository's saved ABAP source match the live target system and cover the requested warehouse scope.

## L. Recommendation

**SAP READ-ONLY ACCESS REQUIRED.** Before Rack Visualizer implementation can begin, provide one of:

1. A configured, authorized **read-only** connection to the intended SAP environment, including the target warehouse/scope and an approved metadata/read path; or
2. A live-SAP discovery export containing the relevant service/table metadata and several real bin, bin-master, stock/quant, HU, and classification records, with sensitive values safely masked while preserving join keys and field values needed for the cross-check.

Then verify the authoritative location universe and statuses, inspect applicable metadata, and cross-check several real bins through location, occupancy, HU, and material. Continue to mark any unavailable fields `NOT VERIFIED`; do not infer or simulate them. No SAP writes are required or authorized by this report.
