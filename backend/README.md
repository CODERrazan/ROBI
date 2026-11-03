# ROBI backend

Python 3.11+: install requirements in a virtual environment. Keep the root `.env` configured, then run from `backend/`:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Run `npm run dev` from `ROBI_Front/` and open the displayed URL. The frontend defaults to `http://localhost:8000`. Credentials stay in the ignored root `.env`.

## Models

```ini
DEEPINFRA_BASE_URL=https://api.deepinfra.com/v1/openai
LLAMA_MODEL_ID=meta-llama/Llama-4-Scout-17B-16E-Instruct
DEEPINFRA_SERVICE_TIER=priority
VISION_PROVIDER=deepinfra
VISION_MODEL_ID=google/gemma-4-26B-A4B-it
DEEPINFRA_VISION_TIMEOUT_SECONDS=15
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_VISION_MODEL=gemma3:4b
```

Scout handles Saudi conversation, structured requirements and outfit decisions. Cloud Gemma 4 handles actual image inputs. Returned model IDs must exactly match configured IDs; substitutions fail. Both cloud paths use Priority by default, which can cost more than standard service. The existing key is reused and never returned to the frontend.

Explicit local development vision: set `VISION_PROVIDER=ollama`. Local `gemma3:4b` uses `keep_alive=10m`, serial inference and `OLLAMA_VISION_TIMEOUT_SECONDS` (default 150). No automatic provider or model fallback is enabled.

## Styling workflow

Routes: `GET /health`; `POST /api/chat`; `POST /api/catalog/search`; `POST /api/vision/analyze`; `POST /api/outfits/compose`; `POST /api/designs/launch-token`.

1. Chat returns short Saudi conversation or validated requirements. Greetings and garment clarification do not start catalog searches. React retains requirements across messages.
2. Ready requirements go directly to composition, avoiding redundant extraction. Concurrent typed Marketplace searches prioritize Classic Shirt and Classic Pants for those categories.
3. Candidates are filtered and ranked by category, keywords, preferences and known prices. Normally two candidates per changed category are shortlisted; required categories precede alternatives, with six alternatives overall.
4. Roblox thumbnail `targetId` binds each image to its exact asset. Current CDN image bytes are validated and decoded. Vision receives real image pixels, name, description, category, price, requirements and explicit item color overrides.
5. Cloud vision uses concurrency two and a 15-second provider I/O timeout (queueing and connection overhead are additional). Failed analyses are excluded. Small 150px images remain unchanged; larger images are capped at 256px without cropping. Uploads retain the separate 768px inspiration-image limit.
6. Scout chooses up to three distinct coordinated options. Server validation checks candidate IDs, visual success, category, duplicate slots, required coverage and known-price budget. One correction is allowed for invalid selections.
7. The approved UI displays real thumbnails, names, prices and known totals. Choosing an option stores real IDs; conversational option selection uses existing options without repeating search or vision.
8. Pants-only modifications preserve server-verified unchanged items, search/analyze replacement pants and revalidate the whole outfit. Category colors override global colors for the changed item.

Scores and visual descriptions are model opinions. Missing prices or availability remain unknown. Catalog descriptions can contain irrelevant keyword spam; they are untrusted data, never instructions.

## Caching and latency

Successful analyses are cached in memory for six hours, bounded to 256 entries. Keys bind asset ID, decoded pixels/color interpretation, model/endpoint and requirement context. PNG timestamp/compression changes do not invalidate unchanged pixels. Current image binding and retrieval are checked even on cache hits. Concurrent identical requests share inference; failures are not cached.

Previously observed catalog items expire after one hour. Restarts clear caches; expired unchanged items are freshly revalidated with Roblox metadata and actual vision before preservation. Failed revalidation leaves the outfit unchanged. Conversation requirements live in React and reset on reload; durable sessions remain future work.

`timings_ms` reports requirements, catalog, visual stage, selection and total. Per-item states include thumbnail lookup/download times and actual provider/model/HTTP/inference metrics. Parallel wall time differs from summed per-image times.

## Verification

See [live HTTP evidence](../docs/complete-styling-live.json), [actual Edge browser evidence](../screenshots/cloud-pipeline/browser-verification.json), [cache/upload evidence](../docs/cloud-cache-verification.json) and [current report](../docs/implementation-status.md). Earlier local-vision evidence is historical.

```powershell
python -m unittest discover -s backend\tests -v
node --test ROBI_Front/avatarConfig.test.mjs
```

Run `npm run build` from `ROBI_Front/`.

## Remaining limits

Real Classic Shirt/Pants/Graphic T-Shirt rendering is implemented and browser-tested. Layered clothing and accessories require native Roblox preview. Durable, website-approved handoff uses SQLite. Native scripts and official save/wear prompts are implemented but require published-client testing. See [dressing report](../docs/real-dressing-report.md). Catalog thumbnails never become garment textures. A known price does not confirm purchase availability. Timeouts or insufficient matches can produce fewer options or an honest incomplete result.
