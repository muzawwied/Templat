# Workspace Template

Monorepo template: Express API server, React frontends, dan shared libraries.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Layout

- `artifacts/api-server` — API server (Express 5)
- `artifacts/ai-router-console` — console frontend (Vite + React + Tailwind)
- `artifacts/mockup-sandbox` — sandbox mockup (Vite + React)
- `lib/` — shared libraries (`api-client-react`, `api-spec`, `api-zod`, `db`)
- `scripts/` — tooling
