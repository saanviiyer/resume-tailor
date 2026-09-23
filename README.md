# Resume Tailor

Resume Tailor reviews and rewrites your resume for a specific job posting. Paste your resume and a job posting, and the app gives you three outputs:

1. A review with a match score, matching strengths, gaps and missing keywords, and specific suggestions.
2. A tailored resume that puts relevant experience first and uses the posting's language, with no invented content.
3. Draft answers to common application prompts ("Why this company or role?", "Why are you a strong fit?", "Describe a relevant project"), based only on your resume.

You can paste your resume, upload a PDF, DOCX, TXT, or MD file, or load the sample. All output is editable. You can copy it or download it as `.txt` or `.md`.

## Anti-fabrication policy

The system prompt contains a hard rule. The model never invents employers, titles, degrees, dates, certifications, tools, or metrics that are not in your resume. It only reorders, re-emphasizes, and rephrases your real content. It uses the posting's language only where your real experience supports it. The review lists skills you lack as gaps and never claims them.

## How it works

- The React client posts `{ resume, jobPosting }` to `POST /api/generate`. When you are signed in, it sends the Supabase access token as `Authorization: Bearer <token>`.
- The Express server (`server/index.js`) verifies the token with the Supabase service-role key and checks the daily cap. Then it calls Claude (`claude-sonnet-5`) with the anti-fabrication system prompt and a JSON-schema structured output. It saves and returns `{ review, tailoredResume, supplementalAnswers }`.
- `POST /api/parse-resume` extracts text from uploads on the server (PDF with `unpdf`, DOCX with `mammoth`).
- In development, Vite proxies `/api/*` to the server on port 3001.
- The Anthropic key and the Supabase service-role key stay on the server and never reach the browser.

### Two fallbacks

The app runs with no keys at all. The two fallbacks work independently of each other.

- Mock AI mode. If `ANTHROPIC_API_KEY` is unset, the server returns realistic canned output. The header badge shows "Mock mode" or "Live (Claude)".
- Anonymous mode. If the Supabase variables are unset, the app skips auth, limits, and persistence.

With Supabase configured, you sign in with an email magic link. Resumes, job postings, and results are saved to the cloud, and each user has a daily generation cap. Sign-in is then required to generate.

### Daily limit

Each successful generation adds a row to `usage_events`. Before each generation, the server counts that user's events since 00:00 UTC. At the cap, it returns HTTP 429 with a clear message. The cap is `FREE_DAILY_GENERATIONS` (default 5, and 0 means no limit). The counting logic is in `server/rateLimit.js` and has unit tests.

The `profiles` table has a `plan` column (default `'free'`) for per-user limits later. Stripe is not implemented. The planned hook is a Stripe webhook that sets `profiles.plan`, with the cap in `server/index.js` read from the plan.

## Run it

```bash
git clone https://github.com/saanviiyer/resume-tailor
cd resume-tailor
npm install        # server dependencies, then client dependencies (postinstall)
npm run dev        # server and client together
```

Open the URL that Vite prints (usually http://localhost:5173). Click "Load sample" to try it. For live output, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`.

```bash
npm test           # daily-cap unit tests
npm run build      # type-check and build the client to client/dist
npm start          # production: serves the API and client on $PORT (default 3001)
```

In production, one Express service serves `/api` and the built client. Other paths fall back to `index.html` for client routing.

### Supabase setup

1. Create a project at supabase.com. From Settings > API, copy the project URL, the anon public key, and the service_role key. Keep the service_role key secret, because it bypasses RLS.
2. Apply `supabase/migrations/0001_init.sql`. Paste it into the SQL Editor, or run `supabase link --project-ref <ref>` and then `supabase db push`. It creates the `profiles`, `resumes`, `applications`, and `usage_events` tables. Each table has a `user_id` that references `auth.users`, with RLS on and `auth.uid() = user_id` policies.
3. Set the variables below in `.env`.

### Deploy

```bash
docker build -t resume-tailor .
docker run -p 3001:3001 resume-tailor                                  # mock mode
docker run -p 3001:3001 -e ANTHROPIC_API_KEY=<your key> resume-tailor  # live
```

On Render, `render.yaml` defines a Node web service (build `npm install && npm run build`, start `npm start`). It declares the keys as dashboard secrets (`sync: false`), plus `FREE_DAILY_GENERATIONS`. Render sets `PORT`. Set the `VITE_*` values before the first deploy, because they are read when the client is built.

## Environment variables

All are optional. Copy `.env.example` to `.env`.

| Name | Purpose | Side |
| ---- | ------- | ---- |
| `ANTHROPIC_API_KEY` | Live Claude output. Mock mode if unset. | Server, secret |
| `VITE_SUPABASE_URL` | Supabase project URL | Client, public |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | Client, public |
| `SUPABASE_URL` | Same project URL | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Verifies tokens and writes data. Bypasses RLS. | Server, secret |
| `FREE_DAILY_GENERATIONS` | Daily cap per user (default 5, 0 for no limit) | Server |
| `PORT` | Server port (default 3001) | Server |

If the Supabase variables are blank, the app runs in anonymous mode. The `VITE_*` values are read at client build time, so set them before `npm run build`.

## Layout

```
server/
  index.js            Express API: auth check, generate, parse, persistence
  supabase.js         service-role client and token check
  db.js               per-user persistence and usage tracking
  rateLimit.js        daily-cap logic
  rateLimit.test.mjs  unit tests
  parse.js            PDF and DOCX text extraction
client/               Vite, React, TypeScript, Tailwind
  vite.config.ts      proxies /api to :3001
  src/App.tsx, Auth.tsx, useAuth.ts, supabase.ts, types.ts
supabase/migrations/0001_init.sql
Dockerfile, render.yaml, .env.example
```
