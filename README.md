# Resume Tailor

> Paste a job posting and get a tailored resume plus drafted application answers.


A resume reviewer + tailor. Paste your base resume and a job posting, and the app:

1. **Reviews** the resume against the posting — a match score, matching strengths, gaps / missing keywords, and concrete improvement suggestions.
2. **Tailors** a rewritten resume that emphasizes relevant experience and mirrors the posting's language — **without fabricating anything**.
3. **Drafts supplemental answers** to common application prompts ("Why this company/role?", "Why are you a strong fit?", "Describe a relevant project") grounded only in your resume.

Paste your resume, upload it as **PDF / DOCX / TXT / MD** (parsed server-side), or load the sample. Everything is editable, copyable, and downloadable as `.txt` / `.md`.

With Supabase configured it becomes a real multi-user product: **email magic-link sign-in**, **cloud-persisted** resumes / job postings / generated results, and a **per-user daily generation cap**. With Supabase unset it stays a zero-setup demo (see [Fallbacks](#two-fallbacks-so-it-always-runs)).

## Anti-fabrication policy

This is a hard rule baked into the system prompt: the model **never invents** employers, titles, degrees, dates, certifications, tools, or metrics that are not in your provided resume. It only reframes, reorders, re-emphasizes, and rephrases your real content, mirroring the posting's language where your genuine experience supports it. Skills the posting wants but you lack are surfaced as *gaps*, never claimed.

## Tech

- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Backend:** Node + Express (keeps the Anthropic + Supabase service-role keys server-side — never in the browser)
- **Model:** Claude (`claude-sonnet-5`) via `@anthropic-ai/sdk`
- **Auth + data:** Supabase (email magic-link OTP; Postgres with Row Level Security)
- **File parsing:** `unpdf` (PDF) + `mammoth` (DOCX), server-side, via `multer` uploads
- **`concurrently`** runs client + server together in dev

## Two fallbacks so it always runs

The app ships with two independent zero-setup fallbacks, so it runs fully with no keys at all:

1. **Mock AI mode** — when `ANTHROPIC_API_KEY` is unset, the server returns realistic canned review / tailored resume / answers.
2. **Anonymous mode** — when the Supabase env vars are unset, auth, limits, and persistence are bypassed and the app behaves exactly like the original demo.

When Supabase **is** configured, sign-in is required to generate and the per-user daily cap is enforced. The two fallbacks are independent — you can run live Claude anonymously, or mock AI with full accounts.

## Run it

### Mock mode (zero setup — no API key needed)

```bash
npm install
npm run dev
```

Then open the client (Vite prints the URL, typically <http://localhost:5173>). With no `ANTHROPIC_API_KEY` set, the server runs in **MOCK MODE** and returns a realistic review, tailored resume, and supplemental answers so the app is fully usable out of the box. Click **Load sample** to try it instantly.

### Live mode (real Claude output)

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm install
npm run dev
```

The header badge shows **Mock mode** vs **Live (Claude)**.

## Build (production client)

```bash
npm run build
```

This type-checks and builds the client to `client/dist` with no TypeScript errors.

## How it works

- The React client posts `{ resume, jobPosting }` to `POST /api/generate`, attaching the Supabase access token (JWT) as `Authorization: Bearer <token>` when signed in.
- The Express server (`server/index.js`) verifies the JWT with the Supabase **service-role** key, enforces the per-user daily cap, calls Claude with a strict anti-fabrication system prompt and a JSON-schema structured output, then persists and returns `{ review, tailoredResume, supplementalAnswers }`.
- File uploads go to `POST /api/parse-resume`, which extracts text server-side (PDF via `unpdf`, DOCX via `mammoth`).
- In dev, Vite proxies `/api/*` to the Express server on port `3001`.

## Make it real / Production setup

By default the app is a demo. To turn it into a real multi-user product with accounts, cloud persistence, and per-user rate limiting, wire up Supabase.

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. From **Settings → API**, copy: the **Project URL**, the **anon public** key, and the **service_role** key (keep the service_role key secret — it bypasses RLS).

### 2. Run the migrations

The schema lives in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It creates `profiles`, `resumes`, `applications`, and `usage_events` — every table keyed by `user_id uuid references auth.users`, with **RLS enabled** and `auth.uid() = user_id` policies. Apply it either way:

- **Dashboard:** paste the file into the **SQL Editor** and run it.
- **CLI:** `supabase link --project-ref <ref>` then `supabase db push`.

### 3. Set env vars locally

```bash
cp .env.example .env
# then fill in:
#   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY   (client, public)
#   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY     (server, secret)
#   FREE_DAILY_GENERATIONS=5
#   ANTHROPIC_API_KEY=sk-ant-...                 (optional; mock mode if unset)
npm install && npm run dev
```

The `VITE_*` vars are read at **client build time**, so they must be present when the client is built (`npm run build`), not just at runtime.

### 4. Set env vars on Render

`render.yaml` declares all five keys with `sync: false` (dashboard-set secrets) plus `FREE_DAILY_GENERATIONS`. Set the `VITE_*` values **before the first deploy** so they are baked into the client build. Render injects `PORT` automatically.

### How the daily limit works

- Each successful generation inserts a row into `usage_events`. Before every generation the server counts that user's events since **00:00 UTC** and returns **HTTP 429** with a clear message once the count reaches the cap.
- The cap is `FREE_DAILY_GENERATIONS` (default `5`; set `0` for unlimited). The counting logic is pure and unit-tested — see [`server/rateLimit.js`](server/rateLimit.js) / [`server/rateLimit.test.mjs`](server/rateLimit.test.mjs) (`npm test`).

### Raising limits / where Stripe plugs in later

- To raise the limit for everyone, change `FREE_DAILY_GENERATIONS`.
- For per-user limits, the `profiles` table already has a `plan` column (default `'free'`). **TODO (Stripe hook):** add a Stripe subscription, set `profiles.plan` from a Stripe webhook (`checkout.session.completed` / `customer.subscription.updated`), and make the cap a function of the plan in `server/index.js` (resolve the cap from `profiles.plan` instead of the single env constant). Stripe is intentionally **not** implemented here — this is the seam where it goes.

## Deploy

This ships as a **single service**: the Express server serves the built client (`client/dist/`) as
static files and also hosts `/api` on one port. `/api` takes precedence; every other path falls back to
`index.html` so client routing works. The API key stays server-side and never reaches the browser.

### Single-service flow (any Node host)

```bash
npm install        # installs server deps + (via postinstall) client deps
npm run build      # builds the client to client/dist/
npm start          # NODE_ENV=production, serves API + client on PORT (default 3001)
```

With no `ANTHROPIC_API_KEY`, it runs in **mock mode** (fully usable). Set the key to go live.

### Docker

A multi-stage `Dockerfile` builds the client in stage 1 and runs a slim Node runtime in stage 2, serving
API + static client on `$PORT` (default 3001, `EXPOSE`d). With no env keys it runs in mock mode; pass
`ANTHROPIC_API_KEY` to go live.

```bash
docker build -t resume-tailor .
docker run -p 3001:3001 resume-tailor                    # mock mode
docker run -p 3001:3001 -e ANTHROPIC_API_KEY=sk-ant-... resume-tailor   # live
```

### Render (Blueprint)

`render.yaml` defines a Node web service — build `npm install && npm run build`, start `npm start`, with
`ANTHROPIC_API_KEY` as a dashboard-set secret (`sync:false`). Render injects `PORT` automatically.

- Never ship the API key to the browser — all Anthropic calls go through the server.

## Project layout

```
resume-tailor/
├── package.json              # root scripts + server deps + concurrently
├── .env.example
├── render.yaml               # Render blueprint (all env vars)
├── supabase/
│   └── migrations/
│       └── 0001_init.sql     # profiles / resumes / applications / usage_events + RLS
├── server/
│   ├── index.js              # Express API: auth gate, generate, parse, persistence
│   ├── supabase.js           # service-role client + JWT verification
│   ├── db.js                 # per-user persistence + usage tracking
│   ├── rateLimit.js          # pure daily-cap logic
│   ├── rateLimit.test.mjs    # unit tests (npm test)
│   └── parse.js              # PDF (unpdf) + DOCX (mammoth) text extraction
└── client/                   # Vite + React + TS + Tailwind
    ├── index.html
    ├── vite.config.ts        # proxies /api → :3001
    └── src/
        ├── App.tsx
        ├── Auth.tsx          # sign-in card + signed-in header
        ├── useAuth.ts        # auth-state hook + access-token helper
        ├── supabase.ts       # browser Supabase client
        ├── types.ts
        ├── main.tsx
        └── index.css
```
