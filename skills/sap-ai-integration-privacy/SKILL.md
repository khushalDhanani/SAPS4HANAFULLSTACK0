---
name: sap-ai-integration-privacy
description: >
  Review or change the CAP AI service, provider clients, prompt and chat handling, or AI
  streaming flow. Use for SAP AI Core, NVIDIA NIM, PII masking, provider configuration,
  LLM data handling, and AI tests in srv/ai/, srv/common/aiClient.js, server.js, and
  test/unit/ai/.
paths:
  - "srv/ai/**"
  - "srv/common/aiClient.js"
  - "server.js"
  - "test/unit/ai/**"
  - "app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrders.controller.js"
---

# AI Integration and Data Privacy

Use this playbook for the project's AI request path. Inspect the current implementation
and provider documentation for the versions in use; do not infer privacy or safety
properties from a provider name, SDK, or configuration flag. Follow the repository's
security rules in `AGENTS.md`.

## Workflow

1. **Trace the request end to end.** Follow the UI caller, CAP action or streaming route,
   input validation, `aiClient`, selected provider, and response/error handling. Confirm
   authentication and authorization at the actual entry point before changing it.
2. **Map data sent to each provider.** Identify user messages, conversation history,
   system instructions, model selection, and any business data added by callers. Determine
   what leaves the application and where credentials/configuration come from. Never print
   secrets or raw private prompts in logs, test output, or documentation.
3. **Verify provider-specific privacy behavior.** Inspect the current SAP AI Core and
   NVIDIA paths independently. Confirm the provider, model, region/endpoint, retention,
   training use, and masking behavior from current authoritative provider configuration or
   documentation. Do not claim equivalent protections across providers. Treat PII masking
   as active only when the actual runtime configuration and provider support are verified.
4. **Review prompt and model trust boundaries.** Check whether callers can supply system
   prompts, model names, history, or business context. Verify the intended authority for
   each input, enforce documented limits/allowlists where required, and test malformed,
   oversized, and adversarial input. Do not treat an LLM response as trusted authorization,
   validation, or SAP transaction data.
5. **Preserve safe operations.** Keep API keys and AI Core service keys in environment or
   bound services, never browser code. Keep timeouts, retry behavior, token limits, and
   error mapping explicit. Avoid logging provider response bodies or prompt contents; make
   sure streaming errors do not leak credentials or private data.
6. **Test providers and routes separately.** Use mocked provider clients for unit tests.
   Cover provider selection, missing configuration, masking on/off, history and input
   limits, error mapping, streaming completion/error behavior, and authentication. Live
   provider checks require an available approved environment; mocks do not prove provider
   privacy or retention behavior.
7. **Report verified facts and unknowns.** Distinguish code behavior from provider policy
   and deployment configuration. Record unverified retention, residency, masking, or
   authorization details as unknown; update `WORKSTATUS.md` with checks actually run.

## Project touchpoints

- CAP AI actions and authentication: `srv/ai/service.cds`, `srv/ai/service.js`.
- Provider selection, SAP AI Core orchestration/masking, NVIDIA client, streaming, and
  token usage: `srv/common/aiClient.js`.
- Streaming route registration: `server.js`.
- Current AI provider unit coverage: `test/unit/ai/aiClient.test.js`.

Use `sap-cap` for CAP framework questions, `sap-s4hana-integration` for S/4 adapters, and
this skill for LLM provider and data-handling concerns.
