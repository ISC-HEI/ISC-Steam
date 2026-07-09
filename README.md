# ISC Steam

ISC Steam is a Steam-style web store and desktop launcher for games made by ISC
students at HES-SO Valais. Students submit a Git repository, the platform reads
an optional [`isc.json`](docs/ISC_MANIFEST.md) manifest, compiles Scala sources,
packages the game, stores the build in MongoDB GridFS, and makes it available to
signed-in players.

The app is built with:

- React 18 + Vite 6 for the web client
- Express 4 + Mongoose 8 for the API
- MongoDB + GridFS for app data, media, packages, avatars, banners, and chat images
- Socket.IO for friends, chat, presence, and playtime updates
- Electron for the desktop launcher
- Scala/JDK tooling for compiling and packaging submitted games

The visual identity uses the ISC logo assets from
[ISC-HEI/isc-logos](https://github.com/ISC-HEI/isc-logos).

## Quick Start

Requirements:

- Node.js >= 20
- npm
- git
- Scala 2.13 on `PATH` for local game builds
- Java/JDK tooling for packaging games
- Docker, if you want the provided local MongoDB

```bash
npm install
cp .env.example server/.env
npm run db:up
npm run dev
```

Then open <http://localhost:5173>.

The API runs on <http://localhost:5174>. The first registered account becomes
the admin. Students become publishers by registering with `PUBLISHER_CODE` from
`server/.env`.

If MongoDB is not available, the server still starts and `/api/health` reports
the database state. Data-backed routes return `503` until MongoDB connects.

## Environment

Copy `.env.example` to `server/.env` for local development.

Important variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port, defaults to `5174`. |
| `MONGODB_URI` | MongoDB connection string. |
| `CLIENT_ORIGIN` | Allowed browser origin for CORS and Socket.IO. |
| `JWT_SECRET` | Secret used to sign account tokens. Change this. |
| `PUBLISHER_CODE` | Registration code that grants the student/publisher role. |
| `SCALA_LIBRARY_JAR` | Optional explicit path to `scala-library.jar`. |
| `GAME_DEPENDENCY_JARS` | Optional fallback jars for submitted games. |
| `WINDOWS_JDK_JMODS` | Required on Linux/macOS when cross-building Windows game runtimes. |
| `JAVAFX_JMODS` | Windows JavaFX jmods for JavaFX games. |
| `JAVAFX_JMODS_LINUX` | Linux JavaFX jmods for Linux game packages. |

For multiple Scala installations, the builder can use versioned variables such
as `SCALAC_2_12`, `SCALA_2_12_HOME`, and `SCALA_LIBRARY_JAR_2_12` before falling
back to `PATH`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API and client together with hot reload. |
| `npm run dev:client` | Runs only the Vite client. |
| `npm run dev:server` | Runs only the API with Node watch mode and `server/.env`. |
| `npm run build` | Builds the production client into `client/dist`. |
| `npm run start` | Starts the API; serves `client/dist` too when present. |
| `npm run db:up` | Starts local MongoDB through Docker Compose. |
| `npm run db:down` | Stops the local Docker Compose stack. |

## Product Flow

### Roles

- Visitor: can register, browse the public catalog, and view public game pages.
- Player: any signed-in account can add games to the library, download packages,
  review games, manage a profile, add friends, and chat.
- Student/publisher: can submit Git repositories, inspect metadata, trigger
  rebuilds, edit game pages, and read build logs on `/dashboard`.
- Admin: first registered account, or a user promoted later. Admins moderate
  games, feature/publish entries, manage accounts, and edit the site
  announcement on `/admin`.

### Publishing

1. A student submits a Git repository on `/dashboard`.
2. The server clones the repository and reads `isc.json` when present. Without a
   manifest, it infers basic metadata from README files, Scala sources,
   `build.sbt`, `.scala-version`, and dependency jar names.
3. The build pipeline imports cover art and screenshots into GridFS, resolves
   dependencies, compiles `.scala` sources, creates runnable packages, and saves
   the full build log.
4. An admin publishes or features the game. Published games appear in the store
   and can be added to a player's library.

See [`docs/ISC_MANIFEST.md`](docs/ISC_MANIFEST.md) for the complete manifest
format and [`docs/examples/isctaker.isc.json`](docs/examples/isctaker.isc.json)
for an example.

## Game Build Pipeline

The pipeline lives in [`server/src/services/pipeline.js`](server/src/services/pipeline.js).
It builds one game at a time.

Supported inputs:

- Scala sources under manifest-defined source directories, defaulting to `src`
- resources such as sprites, sounds, and levels
- repo-local dependency jars
- fallback dependency jars from `server/vendor`
- Maven dependencies declared with sbt-style syntax in `build.sbt` or README text
- FunGraphics, gdx2d, JavaFX, and plain Scala projects when the required jars or
  jmods are available

Package output:

- Windows package: always the primary package, served by default from
  `/api/games/:slug/download`
- Linux package: produced on Linux build servers when the required Linux runtime
  tooling is available, served with `?platform=linux`

Local game builds need compatible Scala and Java tooling. The production Docker
image installs git, a JDK, Scala 2.13, Windows JDK jmods, and JavaFX jmods so it
can compile and package student submissions in the container.

## Web Features

Core pages:

- `/`: public store catalog with tags, search, featured games, and game cards
- `/game/:slug`: game detail page, screenshots, reviews, authors, downloads
- `/library`: signed-in user's library and playtime
- `/dashboard`: publisher tools for submissions and rebuilds
- `/admin`: admin moderation, users, games, stats, and announcement controls
- `/user/:username`: Steam-style profile page
- `/docs/manifest`: in-app manifest reference
- `/style-guide`: local design-system reference

Profiles include avatar and banner uploads, bio, status, stat cards, showcase
panels, activity, friends, recent games, reviews, screenshot gallery, and
comments with likes.

The social dock provides friends, one-to-one chat, image messages, online/in-game
presence, unread state, and playtime reporting. Socket.IO is initialized by the
API server; production proxies must forward `/socket.io/` with WebSocket
upgrades.

## Desktop App

`desktop/` is an Electron launcher for the hosted web app. It loads the server
URL configured in `desktop/package.json` under `iscsteam.url`, so normal web
changes do not require a desktop rebuild.

Unlike the browser version, the desktop app can install, unzip, and launch games
from the Library page. It also reports playtime and "playing" presence back to
the web app. Discord Rich Presence is configured with
`iscsteam.discordClientId` in `desktop/package.json`.

```bash
cd desktop
npm install
ISCSTEAM_URL=http://localhost:5173 npm start
npm run dist
```

`npm run dist` builds Windows artifacts by default. The package config also
defines a Linux AppImage target, used by the GitHub release workflow.

Pushing a tag such as `v2.2.3` triggers
`.github/workflows/release-desktop.yml`. The workflow builds:

- Windows installer: `ISCSteam-Setup-<version>.exe`
- Windows portable executable: `ISCSteam.exe`
- Linux AppImage: `ISCSteam-<version>.AppImage`
- updater metadata for Electron auto-update

```bash
git tag v2.2.3
git push origin v2.2.3
```

## API Overview

All client calls use `/api`.

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | public | Server and database health. |
| `POST /api/auth/register` | public | Create an account; first user becomes admin. |
| `POST /api/auth/login` | public | Log in and receive a JWT. |
| `GET /api/auth/me` | token | Read the current user. |
| `GET /api/games` | public | Published store catalog. |
| `GET /api/games/tags` | public | Available tags. |
| `GET /api/games/:slug` | public/optional token | Game details. |
| `GET /api/games/:slug/media/:mediaId` | public | Cover and screenshot media. |
| `GET /api/games/:slug/download?platform=linux` | token | Download a packaged game; omit `platform` for Windows. |
| `GET /api/games/:slug/reviews` | public/optional token | List reviews. |
| `POST /api/games/:slug/reviews` | token | Create or update your review. |
| `DELETE /api/games/:slug/reviews` | token | Delete your review. |
| `GET /api/games/mine` | student/admin | Publisher's games. |
| `POST /api/games/inspect-repo` | student/admin | Inspect a repository before publishing. |
| `POST /api/games` | student/admin | Create a game entry and package upload/build. |
| `POST /api/games/:slug/rebuild` | student/admin | Rebuild a submitted game. |
| `PATCH /api/games/:slug` | student/admin | Update game metadata/media/package. |
| `DELETE /api/games/:slug` | student/admin | Delete a game. |
| `GET /api/library` | token | Current user's library. |
| `POST /api/library/:slug` | token | Add a game to the library. |
| `DELETE /api/library/:slug` | token | Remove a game from the library. |
| `POST /api/library/:slug/playtime` | token | Add tracked playtime. |
| `GET /api/social/friends` | token | List friends. |
| `POST /api/social/friends` | token | Send a friend request. |
| `POST /api/social/friends/:friendshipId/accept` | token | Accept a request. |
| `DELETE /api/social/friends/:friendshipId` | token | Remove a friendship/request. |
| `GET /api/social/messages/:userId` | token | List one-to-one messages. |
| `POST /api/social/messages/:userId` | token | Send a text message. |
| `POST /api/social/messages/:userId/image` | token | Send an image message. |
| `POST /api/social/messages/:userId/read` | token | Mark a chat as read. |
| `GET /api/social/media/:messageId` | token | Fetch chat image media. |
| `GET /api/users/resolve` | public | Resolve display names to profile users. |
| `GET /api/users/:username` | public/optional token | Public profile. |
| `GET /api/users/:username/activity` | public | Profile activity. |
| `PATCH /api/users/me/profile` | token | Update your profile. |
| `POST /api/users/me/avatar` | token | Upload avatar. |
| `POST /api/users/me/banner` | token | Upload banner. |
| `GET /api/users/:username/comments` | public/optional token | Profile comments. |
| `POST /api/users/:username/comments` | token | Add a profile comment. |
| `DELETE /api/users/:username/comments/:commentId` | token | Delete a profile comment. |
| `POST /api/users/:username/comments/:commentId/like` | token | Like/unlike a comment. |
| `GET /api/admin/stats` | admin | Admin dashboard stats. |
| `GET /api/admin/users` | admin | User management. |
| `PATCH /api/admin/users/:id` | admin | Change a user role. |
| `DELETE /api/admin/users/:id` | admin | Delete a user. |
| `GET /api/admin/games` | admin | All games, including unpublished entries. |
| `PUT /api/admin/announcement` | admin | Update the site announcement. |
| `GET /api/announcement` | public | Active announcement. |
| `GET /api/releases` | public | Desktop release metadata. |

## Project Structure

```text
client/
  src/
    api/              Fetch wrapper and download URLs
    components/       Layout, cards, reviews, social dock, profile widgets
    context/          Auth and social/presence state
    hooks/            Theme hook
    pages/            Store, game detail, library, dashboard, admin, profile
    styles/           Theme tokens and page styles
desktop/
  main.js             Electron shell
  preload.js          Browser bridge for install/launch features
  games.js            Local install and launch helpers
  discord.js          Discord Rich Presence integration
deploy/
  nginx-iscsteam.conf Host nginx reverse-proxy example
  Caddyfile           Optional Caddy reverse-proxy example
docs/
  ISC_MANIFEST.md     isc.json specification
  examples/           Example manifests
server/
  src/
    config/           MongoDB and GridFS setup
    controllers/      Route handlers
    middleware/       Auth, DB guard, error handling
    models/           Mongoose models
    routes/           API route definitions
    services/         Manifest parsing, build pipeline, presence
  vendor/             Checked-in and cached build dependencies
Dockerfile            Production API/client/build-toolchain image
docker-compose.yml    Local MongoDB
docker-compose.prod.yml Production app + Mongo stack
```

## Production Deployment

The included production stack is designed for an Ubuntu VPS where host nginx
terminates HTTPS and proxies to the app container on localhost.

```bash
git clone <this repo>
cd ISC-Steam
cp .env.example deploy/.env
# edit deploy/.env: DOMAIN, JWT_SECRET, PUBLISHER_CODE, and any build settings
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
```

The app container binds to `127.0.0.1:5174`. Use
[`deploy/nginx-iscsteam.conf`](deploy/nginx-iscsteam.conf) as the host nginx
template, including the `/socket.io/` WebSocket proxy rules. Certbot or another
host-level TLS tool can manage HTTPS certificates.

To update a deployed server:

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
```

`deploy/Caddyfile` is kept for setups where Caddy handles HTTPS instead of host
nginx.

## Attribution

The ISC logos are copyrighted by their authors and licensed
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) via
[ISC-HEI/isc-logos](https://github.com/ISC-HEI/isc-logos). Keep the attribution
in the footer and respect the non-commercial license.

"Steam" is used here as a class-project nickname. This project is not affiliated
with Valve.
