# BiteRight – Taste-first social food discovery (frontend)

BiteRight is a mobile‑first social food discovery and logging app built with Expo and React Native. The core object is a **restaurant visit log**, powering a personal taste profile and social feed.

## Getting started

### Prerequisites

- Node.js and npm or yarn installed locally
- Expo CLI (`npx expo` will work once dependencies are installed)

### Install dependencies

```bash
cd biteright
npm install
```

> If you prefer yarn or pnpm, you can run `yarn` or `pnpm install` instead.

### Run the app

```bash
npm start
```

This will start the Expo dev server. Use the QR code to open the app on a physical device, or run on an emulator/simulator.

## Project structure (frontend)

- `app/`
  - `_layout.tsx` – root navigation shell (tabs)
  - `index.tsx` – home feed
  - `discover.tsx` – personalized discovery
  - `log-visit.tsx` – create a restaurant visit log
  - `restaurant/[id].tsx` – restaurant detail page
  - `tonight/` – Tonight swipe UI
    - `index.tsx` – Tonight solo deck
- `src/`
  - `components/` – UI components (feed cards, tonight cards, etc.)
  - `hooks/` – data hooks (feed, tonight deck)
  - `api/` – API client and endpoint helpers
  - `theme/` – shared colors/spacing/typography

## Backend integration

The current frontend expects a REST/JSON API for:

- Feed (`GET /feed`)
- Logging visits (`POST /logs`)
- Restaurant details (`GET /restaurants/:id`)
- Discover (`GET /discover`)
- Tonight deck (`GET /tonight/deck`, `POST /tonight/swipe`)

You can adjust the API paths in `src/api/endpoints.ts` and `src/hooks/*` to match your backend.

## Next steps

- Style and brand the UI to match BiteRight’s visual identity
- Hook up real backend endpoints and authentication
- Implement Tonight group sessions and richer discover logic

