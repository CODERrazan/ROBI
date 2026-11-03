# ROBI appearance and compatibility implementation — 2026-11-03

## Implemented

The approved React layout, themes, original demo, native R15 preview rig, Scout model and cloud Vision model are retained. No dependencies or credentials were added or changed.

Recommendations now resolve actual assets before Vision. The backend checks authoritative catalog identity/type, actual classic templates or supported rigid geometry/face textures, then classifies each asset as `renderable`, `unsupported`, `temporarily_unavailable`, or `invalid`. Only renderable candidates reach selectable outfit cards. Previously selected pieces are revalidated before preservation. Successful/unsupported checks cache for five minutes; transient failures cache for ten seconds. Classic image resolution also retains its existing one-hour cache. No thumbnail is used as garment texture or accessory geometry.

The existing viewer now renders rigid hair from actual Roblox mesh/image assets and native HairAttachment transforms. The bounded binary decoder supports rigid mesh v2/v4, rejects wrapping/skinned accessories, unsupported encodings, unsupported vertex coloring, malformed transforms, oversized geometry and unrecognized attachment profiles. Classic face decals use actual image assets and the native head UVs; unmapped back-head UVs retain skin color. Hair/face materials and geometry are disposed correctly, and unchanged hair survives clothing updates.

Skin tone has an Appearance control and validated conversational updates. It persists independently of clothing. Only explicitly changed body colors enter the handoff; default preview colors do not overwrite the Roblox player's appearance.

## Real asset evidence and defaults

| Role | Catalog ID | Actual content |
|---|---:|---|
| Long Brown Hair | 12980879256 | Mesh 12980071180, texture 12980809843 |
| Chill classic face | 7074764 | Texture 7074749 |
| Black classic shirt | 17331596106 | Texture 17331596076 |
| Black pants | 114915582025729 | Texture 130555131705054 |
| White replacement pants | 9694994699 | Texture 9694994682 |

Hair and face were resolved through authenticated Asset Delivery and rendered in real Edge WebGL, not mocked. The hair was listed at 90 Robux. Chill returned price 0 but **off sale**; it is not advertised as a free purchasable item.

The base preview uses these verified hair/face assets when those slots have no explicit selection. These defaults are clearly labeled preview-only and are excluded from outfit price, applied selected IDs and Roblox transfer. Roblox preserves the player's own hair/face unless explicit replacement items are selected. This distinction avoids silently adding paid or off-sale items to a child's outfit.

Screenshots:
- [Explicit real hair and face](../screenshots/appearance/01-real-hair-face.png)
- [Live generated options](../screenshots/appearance/02-live-options.png)
- [Pants-only modification](../screenshots/appearance/03-live-modification.png)
- [Skin-tone change](../screenshots/appearance/04-skin-tone.png)
- [Complete base appearance, only clothing selected](../screenshots/appearance/05-default-appearance.png)
- [Desktop controls](../screenshots/appearance/06-final-desktop.png)
- [390px mobile layout](../screenshots/appearance/07-final-mobile.png)

## Conversation and combined appearance

Scout receives ordered option IDs and server-cached catalog/Vision evidence, not just option names or client-claimed visual facts. Advice/comparison/information/clarification are non-mutating. Misclassified advice and ambiguous option questions are guarded before selection. Category enums, Arabic aliases and category-specific descriptors preserve separate clothing, hair, face and accessory preferences. A bounded Scout correction repairs dropped explicit colors or bow intent; it never fabricates catalog items.

Live combined request: “أبي فستان وردي مع شعر بني طويل وميكب ناعم وفيونكة” returned HTTP 200 and retained `layeredDressSkirt`, `hair`, `faceAccessory`, `hat`, pink dress and long brown hair after correction. This is successful **intent extraction**, not a completed rendered dress/makeup/bow outfit. Those unsupported components prevent a complete selectable website outfit. A live pink-dress search returned no outfit and an Arabic explanation; it did not substitute shirt/pants.

“خلي لون البشرة أسمر” produced a validated `#964B00` appearance update without outfit generation. Scout's phrasing remains variable and can contain redundant questions in intermediate API replies; sufficiently specified requests proceed to the pipeline, whose final reply is displayed. Comparison depth is still model-dependent; the live advice reply was general, not a demonstrated detailed visual comparison of all three options.

## Live workflow and latency

`screenshots/appearance/workflow-browser.json` records the isolated real Edge UI and actual backend calls:

| Interaction | Result | Browser elapsed |
|---|---|---:|
| هلا كيفك؟ | “هلا بخير، كيفك؟ 😊”, chat only | 10.404 s |
| Black cute shirt/pants, budget 100 | Real selectable options and actual clothing | 56.238 s |
| وش أحلى شي؟ | Advice; selected IDs unchanged | 4.517 s |
| White pants, keep shirt | Shirt 17331596106 preserved; pants 9694994699 | 37.563 s |

Generation backend stages: catalog 1.823 s; asset compatibility 22.556 s; Vision 10.948 s; final Scout selection 15.518 s; total 50.851 s. Modification backend total: 29.502 s. These are measured runs, not guarantees. Compatibility downloads and final model selection remain major latency costs.

Models remained `meta-llama/Llama-4-Scout-17B-16E-Instruct` and `google/gemma-4-26B-A4B-it`; provider model-identity checks remain mandatory. Earlier failed chat/extraction attempts are retained in the audit files; they are not counted as passes.

## Roblox transfer and native experience

The existing immutable, expiring, identity-bound, website-approved handoff remains intact. The website now copies the code when opening Roblox; manual copy remains available if clipboard permission fails. No arbitrary launch query parameter is invented.

Official [Share Links documentation](https://create.roblox.com/docs/production/promotion/share-links) documents Creator Dashboard generation with optional custom LaunchData. Dynamic per-design share-link creation and `Player:GetJoinData()` delivery were **not verified** here, so the code-entry fallback remains the supported path, including website account confirmation.

Native scripts now include explicit body-color overrides using [HumanoidDescription color properties](https://create.roblox.com/docs/reference/engine/classes/HumanoidDescription), plus a scrolling item list showing names, ownership, prices, off-sale state and missing-item cost. Purchase, save-new-outfit and wear-account prompts remain separate explicit actions. Import packages were regenerated and their embedded sources match all four Luau files.

Both local and public HTTPS health endpoints returned HTTP 200. The bridge authorization/replay/expiry tests are contract tests, not proof of a real Roblox account transfer.

## Tests

- `python -m unittest discover -s tests -q` from backend: **53 passed**. These include mocked contract/security tests and deterministic parser/schema checks.
- `node --test ROBI_Front/avatarConfig.test.mjs`: **11 passed**.
- `npm run build` from ROBI_Front: **passed**, existing large-chunk advisory remains.
- Official Luau compiler: **four source files passed**; package-source equality verified.
- Live Edge: real hair/face/clothing rendering, generated options, advice preserving selection, pants modification, skin control; no console errors.
- Rotation and zoom changed pixels; Reset returned exactly to initial captured pixels. At 390px, document width equaled viewport width and the status note did not overlap controls.
- **Not executed:** Roblox Studio/published native dressing, real LaunchData receipt, purchase, save, wear, decline, or account-state confirmation.

## Limitations and exact remaining setup

Website support is classic shirt/pants/graphic T-shirt, compatible rigid hair and classic static face textures. Makeup accessories, bows/hats, other rigid accessory categories, mesh v7, layered clothing/cages, Dynamic Heads and body packages are not enabled as renderable recommendations. A sampled pink bow (94271795844927) used mesh v7 (110544728088996); no fabricated substitute was used. Arbitrary hair items still must pass the format/attachment checks. There is no general clipping solver or Roblox wrapping/physics engine.

No new environment variables are required. Root .env and its keys were unchanged. Keep existing ROBLOX_PLACE_ID=137572714213370, ROBLOX_UNIVERSE_ID=10774466736, PUBLIC_BACKEND_URL=https://labored-manager-boggle.ngrok-free.dev, DESIGN_TOKEN_TTL_SECONDS=600, ROBLOX_BRIDGE_SECRET and ROBLOX_OPEN_CLOUD_API_KEY. Never expose the secrets in VITE variables.

Remaining native steps:
1. In ROBI Avatar Studio, replace the previous installed ROBI scripts with Roblox/ROBI-Server.rbxmx under ServerScriptService and Roblox/ROBI-Client.rbxmx under StarterPlayerScripts; avoid duplicate receivers.
2. Keep HTTP Requests enabled. Keep the existing ROBLOX_BRIDGE_SECRET experience secret restricted to labored-manager-boggle.ngrok-free.dev; use Local Secrets only for Studio testing.
3. Keep backend port 8000 and ngrok running. Publish the updated place.
4. Grant the intended private tester Playtest/access permission; public release is not required for an authorized tester.
5. Join the published client, use Copy code & open Roblox, enter the code, confirm the account on the website, and inspect native appearance/ownership.
6. Test purchase, save-new-outfit, wear-account, and declined prompts separately, then confirm actual account state. None of those actions was performed automatically.

## Files changed in this phase

- Backend: app/appearance.py, app/roblox_binary.py, app/roblox_assets.py, app/main.py, app/styling.py, app/roblox_bridge.py.
- Tests: tests/test_appearance.py, tests/test_contracts.py, tests/test_dressing_security.py.
- Frontend: src/classicClothing.ts, src/App.tsx, src/RobloxHandoff.tsx; production artifacts regenerated.
- Roblox: ROBI.client.lua, OutfitDescription.lua, ROBI-Server.rbxmx, ROBI-Client.rbxmx.
- Evidence/tools: scripts/verify_appearance.mjs, verify_default_appearance.mjs, verify_appearance_controls.mjs, verify_styling_workflow.mjs; docs/appearance-audit and screenshots/appearance.
- Documentation: this report, links in implementation-status.md, real-dressing-report.md and Roblox/README.md.
- Model files, approved HTML, layout CSS, AI provider configuration and root .env were not changed in this phase.
