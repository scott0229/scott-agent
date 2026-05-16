# Scott Agent Project

This project is a Next.js application deployed to Cloudflare Workers using OpenNext.

## Prerequisites

- Node.js (Latest LTS recommended)
- `npm` or `yarn`
- Wrangler CLI (`npm install -g wrangler`) installed globally or used via `npx`.

## Local Development

1.  **Install Dependencies**:

    ```bash
    npm install
    ```

2.  **Environment Setup**:
    Create a `.env` file in the root directory (refer to `.env.example` if available) with necessary secrets:

    ```env
    CLOUDFLARE_TOKEN=your_token
    CLOUDFLARE_ACCOUNT=your_account_id
    CLOUDFLARE_S3_API=your_r2_s3_api
    JWT_SECRET=your_jwt_secret
    ```

3.  **Local Database Migration**:
    Initialize and apply migrations to the local D1 database:

    ```bash
    npm run migrate:local
    ```

4.  **Run Development Server**:
    Start the Cloudflare Workers simulation:
    ```bash
    npm run dev:cf
    ```
    Access the app at `http://localhost:8787`.

## Deployment

**Primary path: GitHub Actions.** Push to `main` triggers two workflows in parallel:

- `.github/workflows/deploy-staging.yml` → `staging.scott-agent.com`
- `.github/workflows/deploy-production.yml` → `scott-agent.com`

Both run: `npm ci` → `migrate:{env}` → `build:cf` → `wrangler deploy --env {env}`. Manual re-runs via the Actions tab (`Run workflow`).

> ⚠️ **Do not build / deploy from Windows.** OpenNext's bundler currently fails on Windows when the repo path contains spaces (this repo lives under `C:\Users\scott\my project\...`). `npm run deploy:*` works fine from CI's Ubuntu runners; locally on Windows it dies in `createServerBundle`. Use the CI workflows, or build from WSL / a no-space path if you must run it locally.

### CI prerequisites (one-time setup)

Two GitHub repo secrets are required (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | The account ID (also visible in `wrangler.toml`) |
| `CLOUDFLARE_API_TOKEN` | Custom API token — see permissions below |

**Cloudflare API token permissions** (create at https://dash.cloudflare.com/profile/api-tokens → Create Custom Token):

| Scope | Permission | Why |
|---|---|---|
| Account | `Workers Scripts · Edit` | `wrangler deploy` uploads the Worker |
| Account | `D1 · Edit` | `wrangler d1 migrations apply` |
| Account | `Workers R2 Storage · Edit` | R2 bucket bindings |
| **Zone** | **`Workers Routes · Edit`** | **Required for `custom_domain = true` routes** — easy to miss; without it, `wrangler deploy` fails at the route-binding step with `Authentication error [code: 10000]` against `/zones/.../workers/routes` |

Account Resources: `Include` → the specific account. Zone Resources: `Include` → `All zones from an account` (only appears after adding a Zone-scoped permission like Workers Routes).

### Local deploy (fallback, non-Windows only)

```bash
npm run deploy:staging      # or deploy:production
```

## Development Notes

- **Database**: This project uses Cloudflare D1 (SQLite). Schema changes are managed via SQL migration files in the `migrations` folder.
- **Assets**: Static assets allow OpenNext to serve Next.js content. `npm run build:cf` builds the correct asset bundle.
- **Troubleshooting**:
  - **EBUSY Error**: If you encounter `EBUSY: resource busy or locked` during build/deploy, it likely means the local dev server is locking files. Stop the dev server (`Ctrl+C`) or kill the node process (`taskkill /f /im node.exe` on Windows) and try again.
