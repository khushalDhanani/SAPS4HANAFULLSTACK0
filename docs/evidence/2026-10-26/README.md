# Movement 261 candidate and authorization evidence — 2026-10-26

All live SAP operations recorded here were READ-ONLY. No BAPI, RFC mutation, database write, OData POST, material-document creation, or reversal was performed.

## Captures

- `261-dd03l-fields.raw.json`: raw DD03L field results used to validate fields before table queries.
- `261-resb-raw.json`: raw RESB rows for `BWART='261'` (RFC_READ_TABLE returned its requested cap of 9,999 rows; derived demand totals are scoped as stated in the summary).
- `261-order-status-raw.json`: AUFK/JEST/TJ02T rows for 10 candidate orders (creator and date included).
- `261-candidate-details.raw.json`: raw MARD stock and material-specific RESB demand rows for the three reported candidates.
- `261-existing-matdocs.raw.json`: direct MATDOC reads by order; zero rows were returned for each reported candidate.
- `261-rfc-authorization.raw.json`: UST04/AGR_USERS/AGR_1251 evidence; user identifiers are excluded.
- `261-auth-object-dd03l.raw.json`, `261-auth-objects.raw.json`: DD03L-validated TOBJ/TOBJT definitions for M_MSEG_BWA, M_MSEG_WMB, M_MSEG_WWA.
- `261-effective-auth-check.raw.json`: READ-ONLY AUTHORITY_CHECK results for BWART 261 and candidate plants 1120/1600.
- `261-readiness-readonly.raw.json`: live readiness preflight result for API_MATERIAL_DOCUMENT_SRV and MATDOC read-back path.
- `261-candidate-summary.json`, `261-authorization-summary.json`: derived, scoped summaries.

## Read sequence and parser note

Every SAP call was labeled READ-ONLY immediately before execution. DD03L validated the queried table fields. A first RESB filter using the unsupported column-to-column expression `BDMNG > ENMNG` was rejected by SAP RFC_READ_TABLE; the final read queried `BWART='261'` and applied the arithmetic open-quantity filter locally.

The OData/RFC channel identity evidence records only that both resolve to the same configured BasicAuthentication principal. The exact configured username is withheld under AGENTS.md's environment-secret rule. UST04 shows SAP_ALL; AGR_1251 contains role authorization definitions for both requested objects. READ-ONLY AUTHORITY_CHECK returned authorized for M_MSEG_BWA ACTVT=01/BWART=261 and M_MSEG_WMB ACTVT=01/WERKS=1120 and 1600; the code-used M_MSEG_WWA checks also passed for both plants. This proves only these object checks. The OData CREATE authorization and actual persistence remain unproven because no POST was performed.
