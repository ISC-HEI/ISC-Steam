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
├── desktop/                   Electron thin shell → ISCSteam.exe
├── deploy/                    Caddyfile + production env template
├── docs/ISC_MANIFEST.md       the isc.json specification
├── docker-compose.yml         local MongoDB
├── docker-compose.prod.yml    full production stack (app + Mongo + Caddy)
└── Dockerfile                 production image (Node + git + JDK + Scala)
```

## Deploying to a VPS (Ubuntu)

Requires Docker + Docker Compose on the VPS, nginx on the host, and a domain
with an A record pointing at it.

```bash
git clone <this repo> && cd ISC-Steam
cp deploy/.env.example deploy/.env      # set DOMAIN, JWT_SECRET, PUBLISHER_CODE
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
# then hook up nginx + HTTPS (instructions in the file header):
cat deploy/nginx-iscsteam.conf
```

The image bundles git, a JDK, Scala 2.13 and the Windows JDK/JavaFX jmods so the
build pipeline works in the container, and the server serves the built client on
the same origin. The app binds only to `127.0.0.1:5174`; the host nginx proxies
the domain to it and certbot provides HTTPS. Update with
`git pull && docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build`.

Note on game packages: on Windows servers the pipeline uses `jpackage` and games
launch via `Game.exe`; on Linux it cross-builds the same layout with `jlink`
(Windows Java runtime from Windows jmods) and games launch via `Game.bat` —
still no Java install needed for players.

## Social features

Friends, chat and presence live in the bottom-right dock (socket.io — the nginx
config proxies `/socket.io/` with WebSocket upgrades). Users add friends by
username, chat 1-to-1, and see who's online or in game. Reviews (1–5 stars +
text) appear on every game page. "Add to library" puts games on `/library`,
which tracks hours played.

## Desktop app (ISCSteam.exe)

`desktop/` is a thin Electron shell that loads the web app from your server —
no re-release needed when the site changes. Set your server URL once in
`desktop/package.json` under `iscsteam.url`.

Unlike the web version, the desktop app is a real launcher: the Library page
lets users pick an install folder, install games (download + unzip), launch
them, and it reports playtime and "Playing …" presence to friends. For Discord
Rich Presence, create an application at discord.com/developers and put its
Application ID in `desktop/package.json` → `iscsteam.discordClientId`
(optionally upload an art asset named `iscsteam`).

```bash
cd desktop && npm install
ISCSTEAM_URL=http://localhost:5173 npm start   # test locally
npm run dist                                   # build dist/ISCSteam.exe (on Windows)
```

Releases are automated: pushing a tag like `v1.0.0` triggers
`.github/workflows/release-desktop.yml`, which builds `ISCSteam.exe` on a
Windows runner and attaches it to a GitHub Release.

```bash
git tag v1.0.0 && git push origin v1.0.0
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
| `npm run start` | run the API — also serves `client/dist` if it exists (production) |
| `npm run db:up` / `db:down` | local MongoDB via Docker |

## Attribution

The ISC logos are © their authors, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
via [ISC-HEI/isc-logos](https://github.com/ISC-HEI/isc-logos). Keep the attribution in the footer,
and note the non-commercial clause. "Steam" is used here as a nickname for a class project —
this is not affiliated with Valve.
