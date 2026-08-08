# Resume Tailor

> Paste a job posting and get a tailored resume plus drafted application answers.


A resume reviewer + tailor. Paste your base resume and a job posting, and the app:

1. **Reviews** the resume against the posting — a match score, matching strengths, gaps / missing keywords, and concrete improvement suggestions.
2. **Tailors** a rewritten resume that emphasizes relevant experience and mirrors the posting's language — **without fabricating anything**.
3. **Drafts supplemental answers** to common application prompts ("Why this company/role?", "Why are you a strong fit?", "Describe a relevant project") grounded only in your resume.

Everything is editable, copyable, and downloadable as `.txt` / `.md`.

## Anti-fabrication policy

This is a hard rule baked into the system prompt: the model **never invents** employers, titles, degrees, dates, certifications, tools, or metrics that are not in your provided resume. It only reframes, reorders, re-emphasizes, and rephrases your real content, mirroring the posting's language where your genuine experience supports it. Skills the posting wants but you lack are surfaced as *gaps*, never claimed.

## Tech

- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Backend:** Node + Express (keeps the Anthropic API key server-side — never in the browser)
- **Model:** Claude (`claude-sonnet-5`) via `@anthropic-ai/sdk`
- **`concurrently`** runs client + server together in dev

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

- The React client posts `{ resume, jobPosting }` to `POST /api/generate`.
- The Express server (`server/index.js`) calls Claude with a strict anti-fabrication system prompt and a JSON-schema structured output, then returns `{ review, tailoredResume, supplementalAnswers }`.
- In dev, Vite proxies `/api/*` to the Express server on port `3001`.

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
├── package.json          # root scripts + server deps + concurrently
├── .env.example
├── server/
│   └── index.js          # Express API + Anthropic call + mock mode
└── client/               # Vite + React + TS + Tailwind
    ├── index.html
    ├── vite.config.ts    # proxies /api → :3001
    └── src/
        ├── App.tsx
        ├── types.ts
        ├── main.tsx
        └── index.css
```
