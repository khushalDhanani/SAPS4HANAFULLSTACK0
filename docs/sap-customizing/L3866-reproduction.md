# L3 866 Reproduction Plan for ABAP Investigation

**Status: pending.** No reproduction has been run. No customizing was changed and no SAP write was performed.

## Test setup

Use an approved non-production client and a disposable test delivery containing a packed item whose packaging material has packaging type `Z007` in warehouse `W01`. Record the delivery, item, HU, packaging material, warehouse, client, user, and timestamp. Confirm the test delivery and its packed state before each comparison.

## Compare the two processing paths

1. In `SE37`, inspect the active function-module interface and documentation for `BAPI_OUTB_DELIVERY_CHANGE`. Use the system's actual parameter and structure names; this plan does not assume a serial-assignment parameter.
2. In the approved test client, prepare the same serial-assignment operation for the packed delivery item through that BAPI path. Do not commit until the test owner authorizes the specific write.
3. Repeat the equivalent serial assignment for the same test delivery/item through `VL02N_O`.
4. Capture the complete return messages and whether each path succeeds or raises L3 866. Keep the delivery/HU inputs equivalent between the two runs.

## Breakpoint and observations

Set an external/session breakpoint in program `SAPML03T`, include `ML03TFHU_HU_INT_LTAP`, at `FORM t319a_lesen` (the earlier forensic note identifies this lookup path). At entry and return, record:

- Caller/call stack and whether the path came from `BAPI_OUTB_DELIVERY_CHANGE` or `VL02N_O`.
- Runtime values used by the lookup, including warehouse and packaging material type, and the lookup result/status.
- Whether the HU is packed at that point, the delivery/item/HU identifiers, and any relevant HU/package state available in the debugger.
- Whether `T319A` is read and the result returned; capture the actual error/message and ABAP stack if it fails.
- Any divergence in preceding calls, structures, flags, or LUW/commit handling between the two paths.

## Results record

**All results pending.** Add separate evidence for the BAPI and `VL02N_O` runs, including test-system/client, actor, timestamp, test delivery/item/HU, exact outcome, breakpoint observations, and whether the HU was packed at the lookup. Do not infer a root cause from one path or from the missing customizing row alone.
