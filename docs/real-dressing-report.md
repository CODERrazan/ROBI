# Real clothing and Roblox handoff ? 2026-11-03

Subsequent hair/face, compatibility and chat changes: [complete styling report](complete-styling-report.md).

## Architecture and model audit

The original files are unchanged. ROBI_Mesh_R15.gltf has 89 nodes, 53 meshes, no skins and no animations. ROBI_Skinned_R15.gltf has 97 nodes, 57 meshes, one 17-joint skin and no animation clips. Its 14 body mesh nodes omit a rendered head, use a custom atlas, and include separate default white tank-top/shorts geometry. Applying Roblox templates directly would be incorrect.

The viewer now uses Models/ROBI_Classic_R15.gltf: 15 complete native R15 body meshes and one 17-joint skin. Native body mesh IDs and attachment pivots are recorded in dressing-audit/rig-conversion.json and native-r15-data.json. The body meshes came from authenticated Roblox Asset Delivery; the native head and compositor mapping came from the installed Roblox Studio content. scripts/build_classic_rig.py reproduces the conversion. Original model files, initial demo and frontend layout are retained.

This is a classic block-body preview, not an exact reproduction of the original custom body, hair or face, or the signed-in user's avatar. It has joint bindings but no animation clips; the existing demo animations remain available in the initial demo. No new animation playback is claimed.

## Actual website rendering

backend/app/roblox_assets.py independently verifies IDs and asset types with Roblox. It uses the existing Open Cloud key on the official asset-delivery-api endpoint, parses the clothing XML's ShirtTemplate/PantsTemplate/Graphic reference, then retrieves the underlying image asset. The key is never forwarded to CDN hosts. Redirects, unexpected hosts/types, oversized files, XML entities and wrong template dimensions are rejected.

The backend serves normalized real PNGs from a content-hash cache. The browser composites native template triangles into the Roblox R15 torso (388x272) and limb (264x284) atlases, preserving native body UVs; graphic T-shirts overlay the torso front. No catalog thumbnail is used as a clothing texture. Region cache keys update only affected maps, asynchronous generations cannot overwrite a newer outfit, and Three.js textures/materials are disposed.

States: idle, resolving_assets, loading_textures, applying_outfit, ready, partially_supported, failed. Unsupported accessories/layered items are never included in applied IDs. Existing rotate/zoom/reset, themes and chat remain.

Live asset evidence:

| Clothing | Catalog ID | Actual texture ID |
|---|---:|---:|
| Classic Shirt | 17331596106 | 17331596076 |
| Initial Classic Pants | 114915582025729 | 130555131705054 |
| White replacement pants | 9694994699 | 9694994682 |
| Graphic T-Shirt | 6439158354 | 6439158322 |

A real layered jacket 88305103859479 (type 67) resolved as native_only, not a classic texture. Rigid accessories, layered wrapping, bundles and custom body packages are not rendered on the website.

## Native Roblox implementation

Roblox/OutfitDescription.lua clones the joining player's native HumanoidDescription, replaces validated selected slots, preserves unrelated body/colors/hair/face/accessories, and maps rigid/layered accessories through SetAccessories. The server constructs an R15 preview and applies the description using current Async APIs, checks the resulting description/body/clothing instances, and preloads assets before reporting ready.

Purchase uses current native product details and ownership, handles zero price separately, blocks unknown/off-sale/limited resale items, and opens the official server-side bulk prompt only after an explicit click. Ownership is refreshed after completion. Saving a new outfit and wearing the account avatar are separate client actions using PromptCreateOutfit and PromptSaveAvatar; only official completion events confirm success. Saving never grants ownership.

These scripts compiled with official Luau 0.745. They have NOT been executed in Studio or a published Roblox client during this task. Native clothing, wrapping, purchase, save, decline and account-wear behavior remain unverified until that test.

## Secure handoff

The website posts selected IDs to /api/designs/launch-token. The backend revalidates catalog types and persists an immutable versioned design in backend/.data/handoff.sqlite3. The random 12-character code expires after the configured TTL. Only hashes of the code and separate website approval capability are stored.

A Roblox server authenticates with the bridge secret, claims a code for its actual player and JobId, then waits for the website owner to explicitly approve that account. Redemption is transactional, bound to player/server/claim/version and expiration. A retry by the same identity is idempotent; another identity is rejected. The code alone never returns private outfit contents.

The button opens the official game page. The player enters the code in the experience. Arbitrary URL query parameters are not assumed to become LaunchData. Official dashboard-created share links with ROBI:<code> LaunchData can prefill it, but code entry is the supported fallback.

Live HTTPS protocol verification passed against the existing ngrok endpoint, including 401 for missing authentication, pending-before-approval, approved retrieval, same-session retry and 409 for another user. The test script simulated server identity; it was not a Roblox account-transfer test. See dressing-audit/live-handoff.json.

SQLite is durable for this deployment and supports concurrent local workers; it is not a distributed multi-host store. General account/session/PostgreSQL persistence remains separate.

## Existing environment

Root .env and existing credentials were not changed. Required existing values:
- ROBLOX_PLACE_ID=137572714213370
- ROBLOX_UNIVERSE_ID=10774466736
- PUBLIC_BACKEND_URL=https://labored-manager-boggle.ngrok-free.dev
- DESIGN_TOKEN_TTL_SECONDS=600
- ROBLOX_BRIDGE_SECRET: existing local value, confirmed present; never publish it.
- ROBLOX_OPEN_CLOUD_API_KEY: existing key with legacy-asset:manage and permission for the requested assets.

Scout/cloud vision variables are unchanged. No server secret belongs in VITE variables. Optional ROBI_HANDOFF_DB changes the SQLite location; otherwise no additional setting is needed. Keep backend/.data writable and private, and retain it across restarts.

## Exact remaining Studio steps

1. Open the existing published ROBI Avatar Studio, place 137572714213370, universe 10774466736.
2. Insert Roblox/ROBI-Server.rbxmx into ServerScriptService. The resulting ROBI folder must contain the ROBI Script and its two sibling ModuleScripts, ROBIConfig and OutfitDescription.
3. Insert Roblox/ROBI-Client.rbxmx into StarterPlayer > StarterPlayerScripts. Remove/disable any previously installed skeleton receiver to prevent duplicate remotes.
4. In Creator Dashboard, select this experience > Secrets > Create Secret. Name it ROBLOX_BRIDGE_SECRET, copy the existing local .env value, and restrict the domain to labored-manager-boggle.ngrok-free.dev. Do not copy the value into script source. For local Studio testing, use File > Experience Settings > Security > Local Secrets with the same name/value/domain.
5. HTTP Requests are already enabled; keep them enabled. Keep port-8000 backend and ngrok running. If the tunnel hostname changes, update PUBLIC_BACKEND_URL, ROBIConfig.Backend and the secret's allowed domain together.
6. Publish the changed place. For private testing, grant the intended tester Edit/Playtest access or invite an early tester under Publish settings > Manage Audience > Manage access. Public release is not necessary for authorized testers.
7. Join through the published Roblox client. Choose a website outfit, enter its code inside Roblox, return to the website to confirm your numeric user ID, and wait for the native preview.
8. Test purchase, save-new-outfit and wear-account separately, including declining each prompt. Confirm resulting account state. These actions were not performed automatically.

## Browser and regression evidence

screenshots/real-dressing/dressing-browser.json records the actual Edge UI, real network calls and model identities. Final pants-only chat modification took 35.86 seconds, preserved shirt 17331596106 and the same viewer canvas, and visibly changed pants to 9694994699. Fresh run had no console errors. capability-browser.json verifies graphic rendering, layered limitation, real handoff dialog and 390px no-horizontal-overflow layout.

Screenshots 01/02 show before/after real clothing; 03 shows the graphic overlay with unsupported layered item; 04 shows the handoff dialog; 05 shows mobile. Later final screenshots include the outfit-panel compositor and mobile note placement fixes. The early screenshot's faded outfit panel was a browser compositor issue, not a disabled outfit state.

Backend contract/security suite: 42 passed. Avatar configuration suite: 11 passed. Production frontend build passed (existing large-chunk advisory). Luau syntax compilation: four files passed. Mocked unit checks cover expiration, simultaneous claims, identity replay, owner approval, XML/type validation and unsupported layered resolution; they do not count as native/live Roblox tests.

## Recommendation changes and limits

Searches include category-specific style synonyms, an explicit free-price query, one bounded extra primary page, deduplication, name-weighted relevance and diverse creator/name alternatives. At most six candidates receive cloud vision, with required categories covered first. The final model and deterministic validation remain unchanged. A pants request rejects a visually identified skirt even if Roblox calls the asset Classic Pants.

Expired saved outfit pieces are freshly revalidated against Roblox and actual vision before preservation; browser verified flags are not trusted. Search caching lasts 30 seconds; global catalog concurrency is three, with bounded 429/503 retries. Optional page failures preserve the first page; missing required categories after search failures produce a service error rather than a false budget/no-results claim.

Live quality cases and retries are in dressing-audit/live-quality-cases.json and live-quality-retry.json. Free/very-low-budget requests may honestly return no complete outfit. Roblox search throttling remains an external limitation and can still produce a retryable error. No fabricated free items or metadata-only fallback is used.

## Official references

- [Classic clothing](https://create.roblox.com/docs/avatar/classic-clothing)
- [Asset Delivery authentication](https://devforum.roblox.com/t/creator-action-required-new-asset-delivery-api-endpoints-for-community-tools/3574403)
- [HumanoidDescription](https://create.roblox.com/docs/reference/engine/classes/HumanoidDescription)
- [AvatarEditorService prompts](https://create.roblox.com/docs/reference/engine/classes/AvatarEditorService)
- [MarketplaceService purchase APIs](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService)
- [Official share links and LaunchData](https://create.roblox.com/docs/production/promotion/share-links)
- [Experience secrets](https://create.roblox.com/docs/cloud-services/secrets)
- [Publishing and tester access](https://create.roblox.com/docs/production/publishing/publish-games-and-places)

## Files changed

- Backend: app/roblox_assets.py, app/roblox_bridge.py, app/main.py, app/styling.py; tests/test_dressing_security.py.
- Frontend: src/classicClothing.ts, src/RobloxHandoff.tsx, src/Preview.tsx, src/App.tsx, src/style.css; old ReceiveDesign.server.lua now points to the real server implementation. Build artifacts regenerated.
- Models: new ROBI_Classic_R15.gltf and ClassicUV.json only; original GLTFs unchanged.
- Roblox: OutfitDescription.lua, ROBI.server.lua, ROBI.client.lua, ROBIConfig.lua, two RBXMX import packages and README.
- Configuration/docs: .env.example, .gitignore, backend/README.md, ROBLOX_INTEGRATION.md, implementation-status.md, this report, scripts/build_classic_rig.py and verification evidence. Root .env was not modified.

Final live quality retry: cute-black returned three complete options in 29.385 seconds, 72 retrieved candidates, six visual candidates at most; selected shirt 17331596106 and pants 114915582025729. Blue streetwear returned three options in 26.755 seconds with IDs 17090674198 and 113194029488956. Zero-budget returned no match; five-Robux returned partial. No-results retry returned no match in 5.08 seconds. These are live measurements, not guarantees. Earlier failed/throttled cases remain recorded.

Final isolated headless Edge verification: real clothing/modification passed again in 22.185 seconds with warm caches; no browser console errors. Shirt remained 17331596106; white pants became 9694994699. Rotation and zoom changed rendered pixels; Reset returned exactly to the initial captured pixels after clearing orbit damping. At 390px the status note no longer overlaps controls and there is no horizontal overflow. Final screenshots are 06-final-desktop.png and 07-final-mobile.png under screenshots/real-dressing/. Native Roblox account tests remain unperformed.
