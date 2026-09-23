# ArogyaDiet — AI / Model Architecture

## Verdict

```
AI / MODEL LAYER
No verified AI/model-provider integration found in the inspected repository.
```

This statement is the result of a **negative-evidence sweep**, not an omission. The search was conducted per the task's §4 instruction across the entire repository (1,657 files searched) with both obvious and indirect patterns.

## Evidence of absence (what was searched and what was found)

| Search pattern | Scope | Result |
|---|---|---|
| `openai\|anthropic\|gemini\|vertexai\|mistral\|groq\|together.ai\|openrouter\|deepseek\|cohere\|huggingface` | all files | **Only incidental matches**: the phrase "Gemini agent" in `.kiro/steering/rider-gps-tracking.md` and one `.kiro` spec — these refer to the *developer's external Android Studio tooling*, not application code. All other hits were false positives on the substring "gemini"→none, "cohere"→"coherent/coherence" in comments. |
| `generateText\|generateObject\|streamText\|chat.completions\|createEmbedding\|AI_SDK\|@ai-sdk\|@langchain` | all files | **0 results.** |
| `package.json` + `package-lock.json` dependency audit | manifests | **No AI SDK present.** Relevant dependencies: `razorpay`, `@onesignal/node-onesignal`, `resend`, `@react-pdf/renderer`, `@googlemaps/js-api-loader`, `@react-google-maps/api`, `@supabase/*`, `xlsx`, `qrcode`, `bcryptjs`, Capacitor packages. Nothing AI-related. |
| `process.env.*` sweep | server code | No model-provider env vars. Env var names found relate to: Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), `CRON_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_ONESIGNAL_APP_ID` + `NEXT_PUBLIC_ONESIGNAL_ALLOWED_HOSTNAMES`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `CUSTOMER_SERVER_PASSWORD`, `FRANCHISE_FEATURES_ENABLED`, perf/trace flags (`NEXT_PUBLIC_PERF_TIMING`, `NEXT_PUBLIC_STARTUP_TRACE*`). No `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_*` etc. |
| Indirect abstraction names (`model`, `models`, `provider`, `llm`, `completion`, `inference`, `prompt`, `agent`, `assistant`) | code | No LLM-model registry, router, factory, provider adapter, or prompt/template file exists. ("model" hits are DB/domain models; "prompt" hits are UI prompts.) |
| Vision / image generation / embeddings usage | code | Only image *upload/processing* for delivery proof, products, transfer package images (Supabase Storage + `html2canvas` screenshots). No generative or analytic AI. |

## What "intelligence-like" behavior actually is

Features that a casual observer might attribute to AI are, in the codebase, deterministic algorithms or curated data:

| Perceived "smart" feature | Actual mechanism | Evidence |
|---|---|---|
| Route optimization | Google Routes API `computeRoutes` with `optimizedIntermediateWaypointIndex` (deterministic solver), Haversine fallback | `src/lib/routing/googleRoutes.ts`, `src/lib/distance.ts` |
| Rider assignment | Pincode → rider lookup (`rider_service_areas`), fixed-assignment override, distance batching | `src/actions/system-actions/routeEngine.ts`, `AssignmentService` |
| Dietitian cadence alerts | Pure date-difference computation | `CadenceService` |
| Health reports / KIT reports | Template-rendered PDFs from logged data (`@react-pdf/renderer`) | `HealthReportTemplate.tsx`, `KitReportTemplate.tsx`, `DietitianReportTemplate.tsx` |
| Nutrition fields in KIT logs | Manual entry fields, no inference | `kit_daily_logs` schema (nutrition columns) |

## Consequence for the model-feature matrix

Because no model/provider/service/call-site chain exists, the matrix in `05-model-feature-matrix.md` is intentionally empty apart from its header rows. If an AI capability is added later (e.g., dietitian-assisted log summarization, meal-plan generation, address-geocoding quality scoring), this file and the matrix should be populated using the same Model→Provider→Service→Call-site→Feature traceability format defined in the matrix document.

## Status

`AI / MODEL LAYER: NOT PRESENT (verified 2026-09-12 against current branch `development`, commit `90c7f36`)`
