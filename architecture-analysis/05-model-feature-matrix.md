# ArogyaDiet — Model ↔ Feature Matrix

> Per the task's rule §23, this matrix is populated **only with verified information**. Since the repository contains **no AI/model integration** (see `04-ai-model-architecture.md`), the model→feature matrix is empty by design.

## Diagram C — AI/Model Architecture

Not applicable — the chain `Features → AI Capabilities → AI Services → Provider → Specific Model` has no realization in this codebase. Placeholder for future use:

```mermaid
flowchart LR
    F["Business Feature (future)"] -.->|none today| CAP["AI Capability"]
    CAP -.-> SVC["AI Service / Adapter"]
    SVC -.-> P["Provider"]
    P -.-> M["Specific Model"]
    style F fill:#fff,stroke:#999
    style CAP fill:#eee,stroke:#bbb,stroke-dasharray: 5 5
    style SVC fill:#eee,stroke:#bbb,stroke-dasharray: 5 5
    style P fill:#eee,stroke:#bbb,stroke-dasharray: 5 5
    style M fill:#eee,stroke:#bbb,stroke-dasharray: 5 5
```

## Diagram D — Model ↔ Feature Matrix

| Model | Provider | Capability | Feature | Sub-feature | Portal | Service | Call Site | Input | Output | Storage | Fallback | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | — | **No verified AI/model integration exists in the repository.** |

## Reverse view (feature → AI capability)

| Feature | AI Capability | Model | Provider | Integration Point | Status |
|---|---|---|---|---|---|
| — | — | — | — | — | **None found.** |

## Nearest functional analogues (non-AI, for client communication)

These are the real systems that provide the "smart" behavior in the product, and the correct matrix rows if the client asks "what powers the routing / reporting":

| Capability | System | Provider/Source | Feature | Call Site | Status |
|---|---|---|---|---|---|
| Route optimization | Google Routes `computeRoutes` (waypoint optimization) | Google Cloud, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / Routes key | Dispatch → rider route ordering | `src/lib/routing/googleRoutes.ts` ← `src/actions/system-actions/routeEngine.ts` | ✅ |
| Distance fallback | Haversine formula (pure math) | in-repo | Payout estimation, route distance | `src/lib/distance.ts` | ✅ |
| Geocoding | Google Geocoding (`src/lib/geocoding.ts`) | Google | Address lat/lng capture | address actions/services | ✅ |
| PDF report generation | `@react-pdf/renderer` templates (deterministic) | in-repo | Invoice, receipts, KIT/stay/health reports | `*ReportTemplate.tsx` + `src/app/api/*` PDF routes | ✅ |
| Map visualization | Google Maps JS API | Google | Admin/Master tracking, franchise kitchen | `@react-google-maps/api`, `@googlemaps/js-api-loader` | ✅ |

If a genuine AI capability is introduced, add rows to both tables above using the traceability format: `Model → Provider → Model ID → Service/Wrapper → Call Site → Feature → Portal`, plus inputs/outputs/storage/fallback/status, and update `04-ai-model-architecture.md` to reflect the new integration.
