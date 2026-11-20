# cedar-pr-review

Partition a GitHub PR into **architectural micro-reviews** (one virtual slice per component), then paint the **whole picture** with a composite review only after every touched slice has been reviewed successfully.

## Flow

1. Fetch PR files and map each file to a component via `components.yaml`.
2. Run **micro-review** per component (static rules on patches/hunks).
3. If any slice **fails**, post a *pending composite* notice — no whole-picture synthesis.
4. When **all touched slices pass**, emit **Component board** + **Complete review** + **Whole picture** narrative.

## Setup

```bash
npm install
cp .env.example .env   # add GITHUB_TOKEN
```

### GitHub token (reviews & approvals)

Cedar **reads** PRs with a read-only token, but **Approve virtual PR** / **Approve on GitHub** call [`POST /pulls/{id}/reviews`](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request). If you see `Resource not accessible by personal access token`:

| Token type | Required access |
|------------|-----------------|
| **Fine-grained** | Repository includes your repo · **Pull requests: Read and write** · **Contents: Read** |
| **Classic** | Scope **`repo`** (private) or **`public_repo`** (public only) |
| **Org repo** | Authorize **SSO** for the token under GitHub → Settings → Developer settings → PATs |

Update `.env` and restart `npm run dev:api`.

Edit `components.yaml` to match your repo layout (used when `OPENROUTER_API_KEY` is unset or `CEDAR_PARTITION_MODE=yaml`).

With **OpenRouter**, Cedar analyzes the PR diff and defines micro-PR breakouts automatically, then runs AI-assisted slice reviews before the composite whole picture.

Default model: **`anthropic/claude-sonnet-4.6`**. Override in `.env`, e.g. `OPENROUTER_MODEL=anthropic/claude-sonnet-5.5`.

## Web UI (Tailwind CSS)

Dev (API + Vite with hot reload):

```bash
# terminal 1
npm run dev:api

# terminal 2
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to port `3847`.

Production:

```bash
npm run build:web
npm start
```

Serves the built UI from `dist/web` and the same review API.

## CLI

```bash
# Markdown to stdout (exit 2 if composite still pending)
npm run review -- --url https://github.com/myorg/myapp/pull/42

# Save report
node src/cli.js review --owner myorg --repo myapp --pr 42 --out report.md --json report.json

# Post micro + composite to GitHub
node src/cli.js review --owner myorg --repo myapp --pr 42 --post-micro --post
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All component slices passed; whole picture generated |
| 1 | Error (auth, config, API) |
| 2 | Micro-reviews done but composite blocked (fix slice blockers) |

## Output sections

- **Component review board** — status per architectural slice
- **Micro-review** (optional on GitHub) — per-component findings
- **Complete architectural PR review** — rollup table, cross-cutting notes, verdict
- **Whole picture** — layer stack + architectural narrative (only when gate is ready)

## Customization

- `components.yaml` — path globs, `depends_on` ordering
- `src/review-engine.js` — rules and composite narrative
- Plug in an LLM later by wrapping `reviewMicroPr` or replacing heuristic findings