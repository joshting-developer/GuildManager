# Tagged container releases (Fly.io-ready)

The entire Vue/Vite frontend and Express API run inside **one Node.js 22 container** on port **3001**. This branch does not deploy to Fly.io automatically.

## GitHub Actions

- Pushes to `flyable` run `npm ci`, `npm test`, and `npm run build`.
- Pull requests targeting `main` run the same checks.
- Pushing a **v-prefixed tag** (for example, `v1.0.33`) runs those checks and, if they pass, builds and publishes `ghcr.io/joshting-developer/guildmanager:v1.0.33` to GitHub Container Registry (GHCR).
- Publishing uses the repository's automatic `GITHUB_TOKEN`, not a personal access token. Repository Actions and Packages permissions must allow publishing; package visibility/access must be configured in GitHub as needed.
- Tag the desired commit on `flyable` rather than the unmodified `main` branch.

```bash
git fetch origin
git switch flyable
git pull --ff-only origin flyable
git tag v1.0.33
git push origin v1.0.33
```

## Single-container runtime

The multistage Dockerfile compiles Vue assets and packages production Node dependencies. Express serves `/api/*` and the built frontend from the same domain/port; the Vite development workflow remains separate. The production API accepts same-origin requests and an optional canonical `APP_ORIGIN=https://your-domain.example`.

```bash
docker build -t guildmanager:local .
docker run --rm -p 3001:3001 -v guild_data:/data guildmanager:local
# Open http://localhost:3001 and check http://localhost:3001/api/health
```

**Important:** Production cookies are marked Secure, so real login sessions require HTTPS. Use the Fly HTTPS endpoint (or Cloudflare HTTPS). An HTTP-only localhost smoke test verifies static assets/API health, not production authentication.

## Data storage: not selected yet

The current application is tightly coupled to `better-sqlite3`; `DATABASE_PATH` is a SQLite **file path**, not a MySQL connection string. The container defaults to `/data/guildmanager.sqlite` and needs persistent storage to retain data. Fly Volumes can be used when deploying, but are not provisioned by this CI change. Connecting a MySQL instance on Oracle VM later requires a repository/storage-layer migration and tests, not just changing `DATABASE_PATH`.

For Fly.io later, map `internal_port = 3001`, configure persistent storage or migrated external DB, and create the Fly app separately. This workflow intentionally has no Fly token or auto-deploy step.
