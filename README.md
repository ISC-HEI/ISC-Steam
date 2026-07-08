# ISC Steam

A Steam-style library for the games made by ISC students at HES-SO Valais. Students submit
their Git repo, the platform clones it, reads an [`isc.json` manifest](docs/ISC_MANIFEST.md)
when present (or infers minimal metadata from README/source files), compiles the Scala sources against **FunGraphics**, and packages a runnable download
(fat jar + `run.bat`/`run.sh`) stored in MongoDB GridFS.

Built on the ISC app template: **Vite + React** client, **Express** API, **MongoDB** via
Mongoose — styled with the ISC visual identity from [ISC-HEI/isc-logos](https://github.com/ISC-HEI/isc-logos).

## Quick start

Requires **Node ≥ 20**, **git**, **Scala 2.13** (`scalac` on the PATH, needed to build games),
and (optionally) Docker for MongoDB.

```bash
npm install          # installs both workspaces
cp .env.example server/.env   # then edit JWT_SECRET and PUBLISHER_CODE
npm run db:up        # starts MongoDB in Docker (or use your own instance)
npm run dev          # runs API (:5174) and client (:5173) together
```

For multiple Scala installations, the builder reads `scalaVersion` from `isc.json`
and looks for versioned variables such as `SCALAC_2_12`, `SCALA_2_12_HOME`,
and `SCALA_LIBRARY_JAR_2_12` in `server/.env` before falling back to PATH.
Repos can ship dependency jars directly, including gdx2d jars, or declare Maven
dependencies with sbt syntax in `build.sbt`/README; downloaded jars are cached in
`server/vendor/maven-cache`.
Admins can also provide fallback jars in `server/.env`, for example
`GAME_DEPENDENCY_JARS=server/vendor/gdx2d-demoDesktop-1.2.2.jar`.
Without `isc.json`, Scala is inferred from `build.sbt`, `.scala-version`, README,
or dependency jar names such as `*_2.13-...jar` before defaulting to `2.13`.

Open http://localhost:5173. **The first account you register becomes the admin.**
Everything works without MongoDB too — data routes just return 503 until it's up.

## How it works

**Roles**

- **Visitor** — anyone can register; can browse and download games.
- **Student (publisher)** — registers with the class code (`PUBLISHER_CODE` in `server/.env`);
  can submit repos, trigger rebuilds and read build logs on `/dashboard`.
- **Admin** — first registered account (or promoted later); moderates games
  (publish/feature), manages accounts on `/admin`.

**Publishing flow**

1. A student submits the repo URL on `/dashboard`. An [`isc.json`](docs/ISC_MANIFEST.md)
   at the repo root is recommended ([example](docs/examples/isctaker.isc.json)); without it,
   the build imports minimal metadata from `README*` and infers the Scala entry object.
2. The build pipeline (`server/src/services/pipeline.js`) clones the repo, validates the
   manifest or fallback metadata, imports cover/screenshots into GridFS, compiles all `.scala` sources with
   the requested Scala version against the FunGraphics jar (from the repo root, or vendored in `server/vendor/`),
   merges engine + `scala-library` into one runnable fat jar, and zips it with launcher
   scripts. Builds run one at a time; the full log is visible on the dashboard.
3. An admin reviews the game and publishes it — it appears in the store, downloadable by
   any signed-in account. Players just unzip and double-click `run.bat` / `run.sh`
   (only Java 11+ required).

## Structure

```
├── client/                    Vite + React
│   └── src/
│       ├── api/client.js      fetch wrapper (+ JWT header, download links)
│       ├── context/           AuthContext (login/register/roles)
│       ├── components/        Layout (topbar, footer, ridge), GameCard
│       ├── pages/             Store, GameDetail, Login, Register,
│       │                      Dashboard (publisher), Admin, ManifestDocs
│       └── styles/            theme.css (tokens) · store.css (Steam-like UI)
├── server/                    Express + Mongoose
│   ├── vendor/                fallback FunGraphics jar(s) go here
│   └── src/
│       ├── models/            User (roles), Game (metadata + build state)
│       ├── controllers/       auth, games (store/publish/download), admin
│       ├── services/          manifest.js (isc.json) · pipeline.js (clone→compile→package)
│       ├── config/            db.js · gridfs.js (packages + images)
│       └── middleware/        auth (JWT + roles), errorHandler, requireDB
├── docs/ISC_MANIFEST.md       the isc.json specification
└── docker-compose.yml         local MongoDB
```

## API overview

| Route | Access | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` · `login` · `GET /me` | public / token | accounts (JWT) |
| `GET /api/games` · `/:slug` · `/:slug/media/:id` | public | store catalog + images |
| `GET /api/games/:slug/download` | any signed-in user | packaged zip (counts downloads) |
| `POST /api/games` · `/:slug/rebuild` · `PATCH/DELETE /:slug` | student/admin | publishing |
| `GET /api/admin/stats` · `users` · `games`, `PATCH users/:id` | admin | moderation |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | client + server together with hot reload |
| `npm run dev:client` / `dev:server` | one side only |
| `npm run build` | production client build to `client/dist` |
| `npm run start` | run the API (serve `client/dist` behind your reverse proxy, or add `express.static`) |
| `npm run db:up` / `db:down` | local MongoDB via Docker |

## Attribution

The ISC logos are © their authors, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
via [ISC-HEI/isc-logos](https://github.com/ISC-HEI/isc-logos). Keep the attribution in the footer,
and note the non-commercial clause. "Steam" is used here as a nickname for a class project —
this is not affiliated with Valve.
