# RiftBoard Myanmar

RiftBoard Myanmar is a Myanmar-focused League of Legends stats, rankings, tournament, and player tracking platform built with Next.js and TypeScript.

## Project Summary

This project is a personal/product-style portfolio piece that turns Riot account and match data into a localized community platform. It includes player profiles, leaderboards, match history, mastery pages, admin tools, Discord account linking, and tournament registration/management flows.

## Tech Stack

- Next.js 16 and React 19
- TypeScript
- MongoDB and Mongoose
- Riot API integrations
- Discord OAuth and linked-role flows
- Tailwind CSS 4 and PostCSS
- Zod for validation
- ESLint

## Main Features

- Player search by Riot ID
- Public player profile pages
- Ranked leaderboard views
- Match history and match detail panels
- Champion mastery table
- Player comments and profile refresh flow
- Admin player submission and removal tools
- Discord OAuth, player binding, and linked-role support
- Tournament creation, registration, team invites, and management pages
- TFT entry point prepared for separate Riot API credentials

## Code Evidence

- `src/app/p/[gameName]/[tagLine]` contains player profile and mastery routes.
- `src/app/leaderboard` contains ranking views.
- `src/components` contains reusable UI for search, profiles, matches, leaderboards, tournaments, and admin tools.
- `src/lib/riot.ts`, `src/lib/riotAuth.ts`, and `src/lib/refresh.ts` contain Riot data and refresh logic.
- `src/lib/discord*` and `src/app/api/discord` contain Discord linking and role integration flows.
- `src/lib/tournaments.ts` and `src/components/Tournament*` contain tournament workflows.

## My Role

Built independently as a product-focused community app, covering UI design, data modeling, API routes, Riot/Discord integration, admin workflows, and deployment configuration.

## Local Development

### Requirements

- Node.js 20 or newer
- npm
- MongoDB connection string
- Riot API credentials for live Riot data

### Install

```bash
npm install
```

### Environment

Copy `.env.example` to `.env.local` and fill in your secrets before local development.

```powershell
Copy-Item .env.example .env.local
```

Important variables:

- `RIOT_API_KEY`: League of Legends production key
- `RIOT_TFT_API_KEY`: Teamfight Tactics production key
- `RIOT_ACCOUNT_REGION`: Riot account routing region, currently `asia` for this project
- MongoDB and Discord variables as needed by the enabled flows

For Vercel deployments, add the same variables in the project environment settings. TFT syncing will stay disabled until `RIOT_TFT_API_KEY` is set.

### Run

```bash
npm run dev
```

### Useful Commands

```bash
npm run build
npm run lint
npm run discord:register
npm run discord:worker
```

`discord:worker` keeps a Discord Gateway connection open so new server members can receive the
`Riftboard: Bind Riot` onboarding role immediately. Enable the bot's Server Members Intent in the
Discord Developer Portal before running it.

## Screenshots / Demo

Screenshots and live demo links can be added here before sending the portfolio to a university or scholarship reviewer.

## License

All rights reserved. See `LICENSE`.
