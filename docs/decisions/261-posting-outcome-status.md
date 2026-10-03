# Movement 261 Posting Outcome Status

## Contract

The `postGoodsIssue261` result exposes `PostingStatus` independently of the legacy `Success` Boolean:

| `PostingStatus` | Meaning | UI treatment |
| --- | --- | --- |
| `POSTED` | SAP returned a material document and read-back confirmed it. | Show posting success and allow posted-document actions. |
| `QUEUED` | The request is durably queued, with no SAP material document yet. | Show informational queued state; do not show a posted document. |
| `FAILED` | The request was definitively rejected or proven not posted. | Show failure; no SAP document is presented as posted. |
| `UNKNOWN` | SAP posting cannot currently be proven, including a returned document awaiting read-back. | Show a warning and instruct the user not to submit again until reconciliation. |

An absent or contradictory result is never considered `POSTED` solely because `Success` is true or a document number is present. For backward compatibility, a legacy result without `PostingStatus` may be treated as `POSTED` only when it carries a material document and explicit confirmation (`Confirmed: true` or `ConfirmationStatus: CONFIRMED`).

The attempt-store mapping is `posted` → `POSTED`, `queued` → `QUEUED`, `rejected`/`not_posted` → `FAILED`, and in-flight or unresolved statuses → `UNKNOWN`. SAP posting errors use `GI_POSTING_FAILED` for definitive failures and `GI_POSTING_UNKNOWN` when the outcome cannot be proven; SAP's original message remains available to the client.

## Queue boundary

The current 261 handler persists an attempt before calling SAP, but it does not defer the SAP call to a queue worker. A persisted `sending` attempt is therefore `UNKNOWN`, not `QUEUED`. The handler can report `QUEUED` if an attempt is already explicitly stored with that state, but this implementation does not create or replay queued attempts.

`POSTED` depends on the material-document read-back confirmation performed by the SAP integration client. A document number returned by the create call without that confirmation remains `UNKNOWN`; the document number may be shown as attempt evidence but is not enabled as a posted-document/reversal action in the UI.
