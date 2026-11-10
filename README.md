# ROBI 🤖

**ROBI** is an AI-powered Roblox avatar styling assistant that helps users discover outfit ideas, explore Roblox Marketplace items, and preview looks in a web experience.

🌐 **Live website:** [https://robi-front.onrender.com/](https://robi-front.onrender.com/)

## About the project

ROBI makes avatar customization easier: instead of manually searching through numerous catalog items, users can describe the style they want and receive outfit suggestions tailored to their request.

The project focuses on combining conversational AI, Roblox catalog discovery, and an interactive avatar preview.

## Key features

- **AI styling assistant:** Describe an outfit or aesthetic in natural language.
- **Marketplace discovery:** Find relevant Roblox avatar items.
- **Outfit composition:** Combine compatible items into a suggested look.
- **3D avatar preview:** Explore outfit concepts directly on the website, without needing to open the Roblox app for the preview.
- **Item links:** Open Roblox Marketplace listings to review items before purchasing.
- **Compatibility-first approach:** The intended recommendation flow checks that items match the request and are supported by the avatar renderer, rather than displaying misleading previews.

> **Development note:** Some features, especially asset compatibility checks and accurate rendering of layered clothing, may still be under development. The web preview is not the same as applying an outfit to a Roblox account.

## How it works

1. The user describes their preferred outfit or style.
2. The AI assistant interprets the request.
3. The system searches for relevant Roblox Marketplace items.
4. Supported items are selected and combined into an outfit suggestion.
5. The user explores the preview and follows item links if interested.

## Technology

The project uses or explores the following technologies:

| Area | Technology |
| --- | --- |
| Frontend | Web-based interactive interface |
| 3D preview | Three.js / Roblox-style R15 avatar approach |
| AI assistant | Llama-based styling and recommendation workflow |
| Backend | Python API services |
| Catalog | Roblox Marketplace item discovery |
| Hosting | Render |
| Planned design storage | Supabase |

## Live demo

Try ROBI here:

### [Open ROBI →](https://robi-front.onrender.com/)

## Project status

ROBI is an evolving prototype. The goal is to make avatar styling more accessible through AI-guided recommendations and an accurate, interactive preview. Features and integrations may change as development continues.

---

*ROBI is an independent project and is not affiliated with or endorsed by Roblox Corporation.*
