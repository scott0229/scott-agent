---
name: release-trader
description: Ship a new scott-agent-trader desktop app release end-to-end — bumps package.json, builds the Windows installer, uploads the zip to BOTH R2 buckets, bumps the LATEST_VERSION constant the Cloudflare Worker advertises to running clients, commits, pushes, and deploys the worker. Use whenever the user says "release trader X.Y.Z", "ship trader X.Y.Z", "bump trader to X.Y.Z and deploy", "publish trader update", "build + deploy new trader version", or asks for any new desktop installer that running clients should pick up. Critically: do NOT just bump package.json or just upload the zip — running clients only learn there's an update by polling LATEST_VERSION on the Worker, and forgetting that step silently breaks the in-app "安裝新版" pill. This skill exists because that step kept getting missed.
---

# release-trader

A new trader release is "shipped" only when BOTH halves land together:

1. The Windows installer for the new version is built and uploaded to R2
2. The Cloudflare Worker route `/api/trader/latest-version` advertises the new version

If only #1 lands, R2 has new bits but no running client knows. If only #2 lands, the worker tells clients to download a version that isn't on R2 yet → 404 → broken install. The whole point of this skill is that both halves happen in the same release run.

## Repo layout

- Repo root: `C:\Users\scott\scott-agent`
- Trader subdir: `C:\Users\scott\scott-agent\scott-agent-trader`

Both share the same git repo (no submodules). Some commands run from the trader subdir, others from the root — each step below says which. Use absolute paths when invoking files (`--file=C:\...`); use working-directory-relative paths for npm scripts and git.

## Inputs

The user supplies a target version like `1.1.84`. Validate it matches semver `X.Y.Z`. If not provided, ASK before proceeding — never guess. If the user uses `v` prefix (`v1.1.84`), strip it.

## Pre-flight

Before touching anything, sanity-check the starting state:

1. `cat scott-agent-trader/package.json | grep version` — the CURRENT trader version
2. `grep "LATEST_VERSION = " src/app/api/trader/latest-version/route.ts` — what the worker currently advertises
3. Confirm the target version is strictly newer than the current package.json version
4. `git status` — if there are unrelated dirty files, mention them to the user but proceed

If the worker's `LATEST_VERSION` already lags behind `package.json`, that's the historical bug — note this to the user. The skill catches it back up.

## The 11 steps

### 1. Bump scott-agent-trader/package.json

Edit `scott-agent-trader/package.json` and change `"version": "X.Y.Z"` to the target. Touch nothing else.

### 2. Typecheck the trader

From `scott-agent-trader`:
```
npm run typecheck
```

Exit code 0 means types pass. If it fails, stop and surface the error — fix typecheck before continuing.

### 3. Commit the version bump

From `scott-agent-trader`:
```
git add package.json
git commit -m "chore: bump trader to <VERSION>"
```

Don't push yet — combine with later commits.

### 4. Build the Windows installer

From `scott-agent-trader`:
```
npm run build:win
```

This takes 1–3 minutes. Run it in the background and wait for completion. After it exits successfully, verify the artifact exists:
```
ls scott-agent-trader/dist/scott-agent-trader-<VERSION>-setup.exe
```

The filename embeds the version — that's the cross-check that the right thing was built.

### 5. Zip the installer

Use PowerShell's built-in Compress-Archive (no extra deps). The .exe is ~93MB; the .zip is similar (already compressed).
```powershell
$src = 'C:\Users\scott\scott-agent\scott-agent-trader\dist\scott-agent-trader-<VERSION>-setup.exe'
$dst = 'C:\Users\scott\scott-agent\scott-agent-trader\dist\scott-agent-trader-<VERSION>-setup.zip'
if (Test-Path $dst) { Remove-Item $dst -Force }
Compress-Archive -Path $src -DestinationPath $dst -CompressionLevel Optimal
Write-Output ("zipped: " + (Get-Item $dst).Length + " bytes")
```

The zip is necessary because Chrome's Safe Browsing flags unsigned `.exe` downloads as dangerous. We don't have a code-signing cert, so the zip is the workaround until we do.

### 6. Upload the zip to BOTH R2 buckets

The key is the SAME in both buckets — `apps/scott-agent-trader-setup.zip` — so a given trader environment (staging or production) reads from its own bucket without filename gymnastics.

From the repo root `C:\Users\scott\scott-agent`:
```
npx wrangler r2 object put "scott-agent-staging/apps/scott-agent-trader-setup.zip" \
  --file="C:\Users\scott\scott-agent\scott-agent-trader\dist\scott-agent-trader-<VERSION>-setup.zip" \
  --content-type="application/zip" --remote

npx wrangler r2 object put "scott-agent-production/apps/scott-agent-trader-setup.zip" \
  --file="C:\Users\scott\scott-agent\scott-agent-trader\dist\scott-agent-trader-<VERSION>-setup.zip" \
  --content-type="application/zip" --remote
```

Both must print `Upload complete.` If either fails, stop and surface — don't proceed with a partial upload. The most common cause is `wrangler login` having expired.

### 7. ⚡ THE STEP THAT KEEPS GETTING MISSED — bump LATEST_VERSION

Edit `src/app/api/trader/latest-version/route.ts`. There's exactly one line like:
```
const LATEST_VERSION = '<old>';
```
Change it to:
```
const LATEST_VERSION = '<NEW>';
```

This constant is the single source of truth running trader apps poll hourly to decide whether to show "安裝新版 X.Y.Z". Without this bump, every step above is invisible to users — the .exe sits in R2 and nobody downloads it. This is the only reason this skill exists.

After editing, grep again to verify the file actually changed:
```
grep "LATEST_VERSION = " src/app/api/trader/latest-version/route.ts
```
Output must show `<NEW>`. If not, redo the edit.

### 8. Commit the LATEST_VERSION bump

From the root:
```
git add src/app/api/trader/latest-version/route.ts
git commit -m "chore: advertise trader <VERSION> to running clients"
```

### 9. Push everything

```
git push
```

This sends both commits (from steps 3 and 8) to origin/main.

### 10. Build + deploy the Cloudflare Worker

From the root:
```
npm run build:cf
npx wrangler deploy --env production
```

⚠️ Do NOT run `npm run deploy:production`. That script chains `migrate:production → build:cf → deploy`, and `migrate:production` fails with Cloudflare API code 7403 (auth not authorized for D1) — for a typical release there are zero schema migrations anyway, so skipping migrate is correct.

`build:cf` is ~30 seconds; `deploy` is ~15 seconds. Verify the deploy output ends with a line like:
```
Current Version ID: <some-uuid>
```
Record that ID for the final report.

### 11. Report

Tell the user:
- **EXE path**: `scott-agent-trader/dist/scott-agent-trader-<VERSION>-setup.exe`
- **ZIP path**: `scott-agent-trader/dist/scott-agent-trader-<VERSION>-setup.zip`
- **R2 keys overwritten**:
  - `scott-agent-staging/apps/scott-agent-trader-setup.zip`
  - `scott-agent-production/apps/scott-agent-trader-setup.zip`
- **Advertised version**: `<VERSION>` in `src/app/api/trader/latest-version/route.ts`
- **Worker Version ID**: from step 10
- **Client-side**: running trader apps will see "安裝新版 <VERSION>" pill on their next hourly poll, or sooner if they manually trigger via `trader:checkUpdate` IPC

## What can go wrong

- **Typecheck fails (step 2)** — Don't commit. Surface the error; fix it; retry from step 2.
- **build:win fails (step 4)** — Tail the build log. Most often a renderer or main process edit broke the pipeline. Fix and rerun build:win.
- **R2 upload fails (step 6)** — Probably wrangler auth expired (`Error: Unauthenticated` or 401). Run `npx wrangler login`, then retry just step 6. NEVER proceed past step 6 with a partial upload — clients on the un-uploaded environment will 404.
- **Worker deploy fails (step 10)** — Same auth issue, OR a TypeScript error in the worker code. Read the actual error.
- **You realize after pushing that LATEST_VERSION wasn't bumped** — Recoverable with a one-line PR: edit the constant, commit + push + redeploy worker. No need to redo R2 uploads or rebuild.

## What this skill does NOT do

- D1 schema migrations. If a release requires one, run `npx wrangler d1 migrations apply DB --remote --env production` separately first, before invoking this skill.
- Git tags or GitHub Releases. If you want a tag, add `git tag v<VERSION>` after step 9.
- External announcements (Slack/email). Out of scope.
- Mac or Linux builds. Trader app is Windows-only.

## Quick reference: the 4-thing checklist that must hold at the end

| Thing | Where | How to verify |
|---|---|---|
| New version in package.json | `scott-agent-trader/package.json` | grep version |
| New installer in dist/ | `scott-agent-trader/dist/scott-agent-trader-<V>-setup.exe` | ls |
| New zip in R2 (×2) | `apps/scott-agent-trader-setup.zip` in both buckets | wrangler r2 object get (optional) |
| New LATEST_VERSION on deployed Worker | `https://scott-agent.com/api/trader/latest-version` returns `<V>` | (optional, requires api key) |

If all four check, the release is shipped.
