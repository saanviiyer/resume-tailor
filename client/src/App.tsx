import { useEffect, useRef, useState } from "react";
import type {
  Application,
  GenerateResponse,
  GenerateResult,
  ServerInfo,
  SupplementalAnswer,
} from "./types";
import { useAuth, getAccessToken } from "./useAuth";
import { AuthHeader, SignIn } from "./Auth";

const SAMPLE_RESUME = `Jordan Lee
Software Engineer | jordan.lee@email.com | github.com/jordanlee

EXPERIENCE
Software Engineer, Northwind Labs (2021–present)
- Built and maintained REST APIs in Node.js serving 2M requests/day
- Led migration of a monolith to containerized microservices, cutting deploy time 60%
- Mentored 3 junior engineers and ran weekly code reviews

Junior Developer, BluePeak (2019–2021)
- Developed internal React dashboards used by 200+ staff
- Wrote automated tests raising coverage from 45% to 82%

EDUCATION
B.S. Computer Science, State University (2019)

SKILLS
JavaScript, TypeScript, Node.js, React, Docker, PostgreSQL, Git`;

const SAMPLE_JOB = `Senior Backend Engineer — Acme Cloud

We're hiring a Senior Backend Engineer to scale our distributed platform. You will:
- Design and operate high-throughput microservices on Kubernetes
- Own reliability, observability, and on-call for core services
- Mentor engineers and drive engineering best practices

Requirements:
- 4+ years building backend services (Go or Node.js)
- Strong experience with containerization (Docker, Kubernetes)
- Experience with PostgreSQL and event-driven architectures
- Track record of mentoring and technical leadership`;

// fetch wrapper that attaches the Supabase JWT (when signed in) as a bearer token.
async function authedFetch(input: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 75
      ? "bg-green-100 text-green-800 border-green-300"
      : score >= 55
      ? "bg-amber-100 text-amber-800 border-amber-300"
      : "bg-rose-100 text-rose-800 border-rose-300";
  return (
    <div
      className={`inline-flex items-baseline gap-1 rounded-full border px-4 py-1.5 ${color}`}
    >
      <span className="text-2xl font-bold">{score}</span>
      <span className="text-sm font-medium">/ 100 match</span>
    </div>
  );
}

function BulletList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "gap" | "tip";
}) {
  const dot =
    tone === "good"
      ? "text-green-600"
      : tone === "gap"
      ? "text-rose-600"
      : "text-blue-600";
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-700">
            <span className={`mt-1 ${dot}`}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const auth = useAuth();

  const [resume, setResume] = useState("");
  const [jobPosting, setJobPosting] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [result, setResult] = useState<GenerateResult | null>(null);
  const [tailored, setTailored] = useState("");
  const [answers, setAnswers] = useState<SupplementalAnswer[]>([]);
  const [history, setHistory] = useState<Application[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: ServerInfo) => setServer(d))
      .catch(() => setServer(null));
  }, []);

  // Load history + usage once the user is known (Supabase mode only).
  useEffect(() => {
    if (!auth.enabled || !auth.user) {
      setHistory([]);
      return;
    }
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.enabled, auth.user]);

  async function refreshHistory() {
    try {
      const res = await authedFetch("/api/applications");
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.applications ?? []);
    } catch {
      /* non-fatal */
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    setError(null);

    // Plain text formats: read directly in the browser, no server round-trip.
    if (
      name.endsWith(".txt") ||
      name.endsWith(".md") ||
      name.endsWith(".markdown") ||
      file.type.startsWith("text/")
    ) {
      const reader = new FileReader();
      reader.onload = () => setResume(String(reader.result || ""));
      reader.readAsText(file);
      e.target.value = "";
      return;
    }

    // PDF / DOCX: parse server-side.
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authedFetch("/api/parse-resume", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to parse the file.");
      setResume(data.text || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse the file.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function generate() {
    setError(null);
    setSavedNote(null);
    if (!resume.trim()) {
      setError("Please paste or upload your base resume.");
      return;
    }
    if (!jobPosting.trim()) {
      setError("Please paste the job posting description.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const jobTitle = jobPosting.split("\n").map((l) => l.trim()).find(Boolean);
      const res = await authedFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jobPosting, jobUrl, jobTitle }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Generation failed.");
      setResult(data.result);
      setTailored(data.result.tailoredResume);
      setAnswers(data.result.supplementalAnswers);
      setMockMode(!!data.mockMode);
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      if (auth.enabled && auth.user) refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveResume() {
    if (!resume.trim()) return;
    setSavedNote(null);
    try {
      const title = resume.split("\n").map((l) => l.trim()).find(Boolean);
      const res = await authedFetch("/api/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: resume }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save resume.");
      }
      setSavedNote("Resume saved to your account.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save resume.");
    }
  }

  function loadApplication(app: Application) {
    setResult(app.result);
    setTailored(app.result.tailoredResume);
    setAnswers(app.result.supplementalAnswers);
    setMockMode(!!app.mock_mode);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadSample() {
    setResume(SAMPLE_RESUME);
    setJobPosting(SAMPLE_JOB);
    setError(null);
  }

  const answersMarkdown = answers
    .map((a) => `## ${a.question}\n\n${a.answer}`)
    .join("\n\n");

  // Require sign-in for the tool when Supabase is configured.
  const needsSignIn = auth.enabled && !auth.loading && !auth.user;

  return (
    <div className="min-h-full text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold">Resume Tailor</h1>
            <p className="text-sm text-slate-500">
              Review, tailor, and answer — grounded only in your real experience.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {server && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  server.mockMode
                    ? "bg-amber-100 text-amber-800"
                    : "bg-green-100 text-green-800"
                }`}
              >
                {server.mockMode ? "Mock mode (no API key)" : "Live (Claude)"}
              </span>
            )}
            {auth.user && <AuthHeader user={auth.user} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {needsSignIn ? (
          <div className="py-10">
            <SignIn />
          </div>
        ) : (
          <>
            {/* Usage banner */}
            {auth.enabled && auth.user && server && server.dailyCap > 0 && (
              <div className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                Daily generations:{" "}
                <span className="font-semibold text-slate-900">
                  {remaining === null
                    ? `${server.dailyCap} / day`
                    : `${remaining} of ${server.dailyCap} left today`}
                </span>
              </div>
            )}

            {/* Inputs */}
            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold">Base resume</h2>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      {uploading ? "Parsing…" : "Upload PDF / DOCX / TXT"}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={handleFile}
                      className="hidden"
                    />
                    {auth.enabled && auth.user && (
                      <button
                        type="button"
                        onClick={saveResume}
                        className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium hover:bg-slate-50"
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  placeholder="Paste your resume, or upload a PDF / DOCX / TXT / MD file…"
                  className="h-72 w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold">Job posting</h2>
                </div>
                <input
                  type="url"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                  placeholder="Job posting URL (optional, for your reference)"
                  className="mb-2 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                <textarea
                  value={jobPosting}
                  onChange={(e) => setJobPosting(e.target.value)}
                  placeholder="Paste the full job description here…"
                  className="h-60 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
            </section>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={generate}
                disabled={loading}
                className="rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {loading ? "Analyzing…" : "Review & Tailor"}
              </button>
              <button
                type="button"
                onClick={loadSample}
                className="rounded-lg border border-slate-300 px-4 py-2.5 font-medium hover:bg-slate-50"
              >
                Load sample
              </button>
              {mockMode && result && (
                <span className="text-sm text-amber-700">
                  Showing mock output — add an ANTHROPIC_API_KEY for full AI results.
                </span>
              )}
              {savedNote && (
                <span className="text-sm text-green-700">{savedNote}</span>
              )}
              {error && <span className="text-sm text-rose-600">{error}</span>}
            </div>

            {/* Results */}
            {result && (
              <div className="mt-10 space-y-8">
                {/* Review */}
                <section className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold">Review</h2>
                    <ScoreBadge score={result.review.matchScore} />
                  </div>
                  <div className="grid gap-6 md:grid-cols-3">
                    <BulletList
                      title="Matching strengths"
                      items={result.review.strengths}
                      tone="good"
                    />
                    <BulletList
                      title="Gaps & missing keywords"
                      items={result.review.gaps}
                      tone="gap"
                    />
                    <BulletList
                      title="Improvement suggestions"
                      items={result.review.suggestions}
                      tone="tip"
                    />
                  </div>
                </section>

                {/* Tailored resume */}
                <section className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold">Tailored resume</h2>
                      <p className="text-sm text-slate-500">
                        Editable. Nothing was fabricated — only your content, reframed.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <CopyButton text={tailored} />
                      <button
                        type="button"
                        onClick={() => download("tailored-resume.md", tailored)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Download .md
                      </button>
                      <button
                        type="button"
                        onClick={() => download("tailored-resume.txt", tailored)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        .txt
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={tailored}
                    onChange={(e) => setTailored(e.target.value)}
                    className="h-96 w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-sm focus:border-slate-500 focus:outline-none"
                  />
                </section>

                {/* Supplemental answers */}
                <section className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold">Supplemental answers</h2>
                      <p className="text-sm text-slate-500">
                        Editable drafts, grounded only in your resume.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <CopyButton text={answersMarkdown} label="Copy all" />
                      <button
                        type="button"
                        onClick={() =>
                          download("supplemental-answers.md", answersMarkdown)
                        }
                        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Download .md
                      </button>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {answers.map((a, i) => (
                      <div key={i}>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="font-semibold text-slate-800">
                            {a.question}
                          </label>
                          <CopyButton text={a.answer} />
                        </div>
                        <textarea
                          value={a.answer}
                          onChange={(e) => {
                            const next = [...answers];
                            next[i] = { ...next[i], answer: e.target.value };
                            setAnswers(next);
                          }}
                          className="h-32 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm focus:border-slate-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* History (Supabase mode) */}
            {auth.enabled && auth.user && history.length > 0 && (
              <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="mb-3 text-lg font-bold">Your recent applications</h2>
                <ul className="divide-y divide-slate-100">
                  {history.map((app) => (
                    <li
                      key={app.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {app.job_title || "Untitled role"}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(app.created_at).toLocaleString()}
                          {app.mock_mode ? " · mock" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadApplication(app)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium hover:bg-slate-50"
                      >
                        Load
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-slate-400">
        Anti-fabrication is enforced: the model only reframes and emphasizes your
        real experience — it never invents employers, titles, degrees, or metrics.
      </footer>
    </div>
  );
}
