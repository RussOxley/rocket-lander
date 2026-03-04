# RocketLander Telemetry System

## Overview

RocketLander is a browser-based game with a telemetry dashboard. Players pilot a rocket lander through missions, and every round's outcome (score, wealth, fuel used, success/failure, tier, pad, bet fraction) is automatically saved to a PostgreSQL database. The app has three main views:

- **Play** – Houses the actual `RocketLander` game component
- **Dashboard** – Analytics with charts showing wealth trends, scores, and win rates
- **History (Flight Logs)** – A sortable table of all past game rounds

The aesthetic is a dark "deep space" theme with neon cyan, purple, and pink accents.

### Game Tuning Notes
- **HUD**: All flight telemetry (ALT, VEL, FUEL, round, wealth, risk) is displayed in a strip below the canvas, outside the gameplay area. Touch controls are also below the canvas.
- **Bet Slider**: Uses a log10 scale to discourage excessive risk-taking. The mapping is `(10^(t*2) - 1) / 99 * 100` where t is the slider position (0-1). This means the first half of the slider covers ~0-10% bets, making it easy to pick conservative amounts while still allowing aggressive bets at the far end. Quick-pick buttons bypass the log scale for exact values.
- **Market Book (Probability Model)**: Success probabilities are seeded from the PostgreSQL database on page load via `GET /api/market-book`. The endpoint aggregates actual game results grouped by exact `tier_idx` and `pad_idx` combinations, so each difficulty tier + landing pad pair has its own success/failure tally from real play history. In-session updates (after each round) still update the local state for immediate reactivity. The DB is the source of truth across sessions and browsers.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Full-Stack Structure
The project is a monorepo with three top-level areas:
- `client/` – React frontend (Vite)
- `server/` – Express backend (Node.js)
- `shared/` – Shared TypeScript types, Zod schemas, and route definitions used by both sides

This shared layer is key: API route paths, input schemas, and response shapes are all defined once in `shared/routes.ts` and `shared/schema.ts`, then imported by both the server handlers and the client hooks. This prevents drift between frontend and backend contracts.

### Frontend Architecture
- **React** with **TypeScript**, bundled by **Vite**
- **Wouter** for client-side routing (lightweight alternative to React Router)
- **TanStack Query (React Query)** for server state — fetching and mutating game results
- **shadcn/ui** component library (Radix UI primitives + Tailwind CSS)
- **Framer Motion** for animations (page transitions, sidebar active indicator)
- **Recharts** for the analytics charts on the Dashboard
- **date-fns** for date formatting in History and Dashboard
- Path alias `@/` maps to `client/src/`, `@shared/` maps to `shared/`

The app layout is a fixed sidebar (`Sidebar.tsx`) + scrollable main area. The sidebar uses Framer Motion's `layoutId` for a smooth active-tab highlight animation.

Custom hooks in `client/src/hooks/`:
- `use-game-results.ts` – wraps TanStack Query for `GET /api/game-results` and `POST /api/game-results`
- `use-toast.ts` – in-memory toast notification state machine
- `use-mobile.tsx` – responsive breakpoint detection

### Backend Architecture
- **Express 5** HTTP server
- **TypeScript** with `tsx` for development, compiled to CJS via `esbuild` for production
- Routes are registered in `server/routes.ts` and use `storage` (a `DatabaseStorage` class) for all DB access
- The storage layer (`server/storage.ts`) implements an `IStorage` interface, making it easy to swap implementations
- Static files are served from `dist/public` in production; in development, Vite middleware is injected directly into the Express server

### Database
- **PostgreSQL** via `pg` (node-postgres)
- **Drizzle ORM** for type-safe queries and schema management
- Schema defined in `shared/schema.ts`:
  - `game_results` table: `id`, `tier_idx`, `pad_idx`, `bet_frac`, `wealth`, `success`, `fuel_used`, `score`, `created_at`
- **drizzle-zod** auto-generates Zod insert schemas from the Drizzle table definition
- Migrations live in `./migrations/`, pushed with `npm run db:push`

### API Design
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/game-results` | Fetch all game results |
| POST | `/api/game-results` | Save a new game result |
| GET | `/api/market-book` | Aggregated success/failure counts by tier_idx × pad_idx |

Both endpoints are typed end-to-end via `shared/routes.ts`. The client validates responses with Zod before using them.

### Build System
- Development: `tsx server/index.ts` starts Express with Vite middleware for HMR
- Production build: `script/build.ts` runs Vite for the client, then esbuild for the server (bundling selected server-side dependencies to reduce cold-start syscalls)

### Styling
- **Tailwind CSS** with a deep space dark theme enforced via CSS custom properties in `client/src/index.css`
- Theme colors: deep navy background, neon cyan primary, electric purple secondary, bright pink accent
- Custom fonts: DM Sans (body), Outfit (display/headings), loaded from Google Fonts

---

## External Dependencies

| Dependency | Purpose |
|-----------|---------|
| **PostgreSQL** | Primary database, required via `DATABASE_URL` environment variable |
| **Drizzle ORM** | Type-safe ORM + migration tool for PostgreSQL |
| **Google Fonts** | DM Sans and Outfit font families loaded in `client/index.html` and CSS |
| **Radix UI** | Accessible UI primitives (used via shadcn/ui component wrappers) |
| **Framer Motion** | Animations for page transitions and UI interactions |
| **Recharts** | Chart library for the Dashboard analytics view |
| **TanStack Query** | Server state management and data fetching/mutation |
| **Wouter** | Lightweight client-side routing |
| **Zod** | Runtime schema validation shared between client and server |
| **date-fns** | Date formatting in History and Dashboard |
| **Vite** | Frontend build tool and dev server |
| **esbuild** | Server bundler for production builds |
| **Replit plugins** | `@replit/vite-plugin-runtime-error-modal`, `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner` — active in development on Replit only |