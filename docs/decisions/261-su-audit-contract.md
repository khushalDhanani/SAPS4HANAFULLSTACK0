# Movement 261 Storage Unit Audit Contract

## Decision

The CAP `postGoodsIssue261` action accepts `StorageUnits` as candidate identifiers only. It does not accept client allocation quantities as authoritative. The server reads current SAP reservation and WM stock, computes each SU contribution, claims those quantities, and performs a final SAP revalidation immediately before posting.

The current repository posting implementations do not map SU/HU identifiers into SAP's 261 request:

- The bound `ZUI_GI_ORDER_RSV_O4` `postGoodsIssue` call sends `IssueQty`, `Batch`, `DifferenceQty`, `DifferenceReason`, `DifferenceStorageType`, and `FinalIssue`.
- The `API_MATERIAL_DOCUMENT_SRV` fallback maps one material-document item with material, movement type, quantity, plant, storage location, reservation/item, optional batch and serials.
- Neither wired request includes an SU/HU identifier or per-SU allocation.

Therefore, do not invent or add an SU/HU SAP property. Keep SU allocation in the CAP contract and persist the SAP-validated allocation as audit evidence. If live SAP metadata or backend implementation later proves a required SU/HU posting property, update the SAP adapter only after that contract is verified and tested.

## Persisted evidence

Each allocated SU has one `GoodsIssueIssuedStorageUnit` row. It records:

- SAP posting correlation: `ReferenceDocument`, `MaterialDocument`, and `MaterialDocYear`.
- Reservation and stock context: reservation/item, material, plant, storage location, and SU.
- Server allocation: `IssuedQty` and the stock quantity observed before the attempt (`PreIssueStock`).
- Final pre-post SAP snapshot: batch, warehouse, storage type, storage bin, whether the SU contains multiple batches, and `EvidenceCapturedAt`.
- Lifecycle: `claiming` before the SAP call, `issued` after the material document is returned, and `released` when the stock claim is no longer active.

The final snapshot is persisted before calling SAP. If the audit evidence cannot be saved, the handler rejects the attempt and does not call SAP. The evidence model has a `MultipleBatches` flag rather than inventing a per-batch split; the direct final revalidation currently rejects an SU that contains multiple batches.

## Evidence boundary

The record proves which server-validated SU quantities were assigned to a posting attempt and correlates those allocations to the SAP material document. The current SAP posting request is aggregate, so this evidence does **not** prove that SAP consumed those exact SU/quant rows internally. Exact SAP-side consumption attribution and live confirmation that the deployed RAP/API metadata does not require SU/HU identifiers remain pending SAP verification.
