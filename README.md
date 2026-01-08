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

### Staging

To deploy to the staging environment (separate D1 database and worker):

1.  **Run Migrations**:

    ```bash
    npm run migrate:staging
    ```

2.  **Deploy**:
    ```bash
    npm run deploy:staging
    ```
    This script builds the OpenNext application and deploys it to the staging environment.

### Production

To deploy to the production environment:

1.  **Run Migrations**:

    ```bash
    npm run migrate:production
    ```

2.  **Deploy**:
    ```bash
    npm run deploy:production
    ```

## Development Notes

- **Database**: This project uses Cloudflare D1 (SQLite). Schema changes are managed via SQL migration files in the `migrations` folder.
- **Assets**: Static assets allow OpenNext to serve Next.js content. `npm run build:cf` builds the correct asset bundle.
- **Troubleshooting**:
  - **EBUSY Error**: If you encounter `EBUSY: resource busy or locked` during build/deploy, it likely means the local dev server is locking files. Stop the dev server (`Ctrl+C`) or kill the node process (`taskkill /f /im node.exe` on Windows) and try again.
