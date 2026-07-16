# @beton-boi/client-student — Student Portal

React + Vite SPA for the student portal. Built with TypeScript, Tailwind CSS v4, and Vite 6.

## Quick Start

```bash
# From the monorepo root
yarn install
yarn dev:client-student
```

The dev server starts on **http://localhost:5173/student/**. It proxies `/api/*` requests to the NestJS server at `localhost:3000`, so you don't need to configure CORS or separate API URLs during development.

## Commands

| Command | Description |
|---------|-------------|
| `dev` | Start Vite dev server with HMR |
| `build` | Type-check + production build (`tsc -b && vite build`) |
| `preview` | Preview the production build locally |

## Development

```bash
# Run the dev server (HMR enabled)
yarn workspace @beton-boi/client-student dev

# In another terminal, run the server
yarn dev:server
```

Open **http://localhost:5173/student/** — the `/api/*` prefix is proxied to the NestJS server automatically.

## Production Build

```bash
# Build the client
yarn workspace @beton-boi/client-student build

# Output goes to dist/
```

The production build is served by the NestJS server at `/{client}/` paths. See `server/src/main.ts` for the static file serving logic.

## Project Structure

```text
├── src/
│   ├── main.tsx          # React entry point
│   ├── App.tsx           # Root component
│   ├── index.css         # Tailwind CSS imports
│   └── vite-env.d.ts     # Vite type declarations
├── public/
├── index.html
├── vite.config.ts        # Vite config (proxy, aliases, Tailwind)
├── tsconfig.json
└── package.json
```

## Vite Config Highlights

- **Base path**: `/student/` — the app is served under this URL prefix
- **Aliases**: `@/` → `./src/`, `@beton-boi/shared` → `../shared/src` (direct source import, no build needed)
- **Proxy**: `/api` → `http://localhost:3000` (dev only)
- **Plugins**: React Fast Refresh + Tailwind CSS v4

## Tailwind CSS v4

This project uses Tailwind CSS v4 with the `@tailwindcss/vite` plugin. No `tailwind.config.js` or `postcss.config.js` needed — configuration is done via CSS:

```css
@import "tailwindcss";
```

Custom theme values can be added inline in `index.css` using `@theme` directives.