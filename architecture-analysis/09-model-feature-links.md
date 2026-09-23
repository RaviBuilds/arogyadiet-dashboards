# 09 — Model / AI Feature Links

## Statement

> **No verified AI/model features found in the current application.**

A full repository sweep (all source files, dependency manifests, environment variables, provider-name and SDK patterns — e.g., OpenAI, Anthropic, Gemini, AI SDKs, `generateText`, embeddings, tool calling, prompt registries) found **no application-level AI/model integration**. Nothing was invented to fill this section.

## What the "smart" features actually run on

These are deterministic systems and external services, not models:

```text
Route optimization        → Google Routes API (waypoint optimization) + Haversine fallback
Rider assignment          → Pincode territory rules + distance batching
Dietitian cadence alerts  → date-difference computation
Reports & invoices (PDF)  → template rendering from logged data
Payment confirmation      → Razorpay gateway + signature-verified webhook
Push/email                → OneSignal + Resend
Background GPS            → native Android service (Capacitor plugin)
```

If an AI capability is added later, record it here as `Feature → AI Capability → Model` and update the audit package's `04-ai-model-architecture.md` / `05-model-feature-matrix.md` with the full traceability chain.
