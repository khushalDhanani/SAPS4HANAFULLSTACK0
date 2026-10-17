# Mismatched TRs: Hold from Processing

**Instruction: Do not process TRs 0001000757, 0001000760, or 0001000823.** Their WM movement is 311 while the linked reservation movement is 201 or 241. This note is based on existing read records only; no SAP writes were performed for this note.

| TR | Reservation movement | TO | Stock recorded in 921 | Evidence status |
| --- | --- | --- | --- | --- |
| 0001000757 | 201 | 0001037270, confirmed | 1.000 NOS at 921/TRANSFER (quant 0001045066 in the historical read after TO creation) | CONFIRMED (historic work record); current balance UNSURE |
| 0001000760 | 241 | 0001037271, confirmed | 1.000 KG at 921/TRANSFER (quant 0001045070 in the historical read after TO creation) | CONFIRMED (historic work record); current balance UNSURE |
| 0001000823 | 201 | UNSURE; no associated TO is recorded in the available read notes | UNSURE; no LQUA read for this TR is present in the available records | UNSURE |

For TR 0001000823, the available Client 220 record identifies reservation 0000527870. The recorded `RKPF-KOSTL` is `1011201301`; `RESB-UMLGO` and `RESB-UMWRK` are blank. No stock amount or TO is inferred from those fields.

Do not use the mismatch override to process these existing TRs. Reconcile each TR, TO and warehouse quant against a fresh read-only SAP snapshot before any future disposition.
