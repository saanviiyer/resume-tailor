import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";

import { supabaseEnabled, getUserFromRequest } from "./supabase.js";
import { resolveDailyCap, isOverDailyLimit, remainingGenerations } from "./rateLimit.js";
import {
  ensureProfile,
  countGenerationsToday,
  recordGeneration,
  saveApplication,
  listApplications,
  saveResume,
  listResumes,
} from "./db.js";
import { parseResumeBuffer, MAX_UPLOAD_BYTES } from "./parse.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const MODEL = "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MOCK_MODE = !API_KEY;
const DAILY_CAP = resolveDailyCap(process.env.FREE_DAILY_GENERATIONS);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The built client (vite build) lands in <repo>/client/dist.
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// In-memory upload handling for resume file parsing (PDF/DOCX/TXT).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Serve the built client as static files. In dev the client is served by Vite
// on 5173; in production this is how the SPA is delivered.
app.use(express.static(CLIENT_DIST));

const client = MOCK_MODE ? null : new Anthropic({ apiKey: API_KEY });

// ---------------------------------------------------------------------------
// Auth middleware.
//
// Two fallbacks are preserved (see README):
//   - ANONYMOUS mode: Supabase env unset -> auth/limits/persistence bypassed;
//     the app behaves like the original demo. req.user stays null.
//   - When Supabase IS configured, protected routes require a valid JWT and set
//     req.user; missing/invalid tokens get 401.
// ---------------------------------------------------------------------------
async function requireAuth(req, res, next) {
  if (!supabaseEnabled) {
    req.user = null; // anonymous mode
    return next();
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return res
      .status(401)
      .json({ error: "Please sign in to continue.", authRequired: true });
  }
  req.user = user;
  try {
    await ensureProfile(user);
  } catch (err) {
    console.error("ensureProfile failed:", err.message);
  }
  next();
}

// ---------------------------------------------------------------------------
// System prompt — anti-fabrication is a hard rule.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an expert resume reviewer and career coach. You help a candidate
tailor their EXISTING resume to a specific job posting and draft answers to common
supplemental application questions.

HARD RULES — these are non-negotiable:
- NEVER invent, fabricate, or embellish credentials. Do not add employers, job titles,
  degrees, certifications, dates, metrics, tools, or accomplishments that are not present
  in the candidate's provided resume.
- You may ONLY reframe, reorder, re-emphasize, and rephrase what the candidate already
  provided, and mirror the language/keywords of the job posting where the candidate's real
  experience genuinely supports it.
- If the posting emphasizes a skill the candidate lacks, do NOT claim it. Instead surface it
  as a gap in the review section.
- Every supplemental answer must be grounded ONLY in the candidate's actual resume content.
  Do not invent stories, projects, or specifics.
- Keep the candidate's real facts intact: do not change numbers, dates, or company names.

Return your output by calling the provided structured format. Be concrete and specific,
and write in the first person where natural for the supplemental answers.`;

function buildUserPrompt(resume, jobPosting) {
  return `Here is the candidate's BASE RESUME (verbatim — treat every fact here as the only allowed source of truth):

<resume>
${resume}
</resume>

Here is the JOB POSTING they are applying to:

<job_posting>
${jobPosting}
</job_posting>

Do all of the following:
1. REVIEW: Assess how well the resume matches this posting. Give a match score from 0-100,
   list the key matching strengths, list gaps / important keywords the posting emphasizes that
   are weak or missing from the resume, and give concrete improvement suggestions.
2. TAILOR: Produce a rewritten, tailored version of the resume that emphasizes the most
   relevant experience and mirrors the posting's language — WITHOUT fabricating anything.
   Keep it as clean plain text / markdown that the candidate can paste into a document.
3. SUPPLEMENTAL: Draft answers to common supplemental application questions, grounded only in
   the resume: "Why this company/role?", "Why are you a strong fit?", and
   "Describe a relevant project or accomplishment.".`;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    review: {
      type: "object",
      properties: {
        matchScore: { type: "integer" },
        strengths: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } },
      },
      required: ["matchScore", "strengths", "gaps", "suggestions"],
      additionalProperties: false,
    },
    tailoredResume: { type: "string" },
    supplementalAnswers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["review", "tailoredResume", "supplementalAnswers"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Mock generator — realistic output so the app is fully usable with zero setup.
// ---------------------------------------------------------------------------
function mockResult(resume, jobPosting) {
  const resumeLines = resume
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const firstLine = resumeLines[0] || "Candidate";

  // Naive keyword extraction from the posting for a believable review.
  const stop = new Set(
    "the a an and or of to in for with on at as is are be we you your our their this that will can must should have has who what when where role team work experience years using across into from job posting company".split(
      " "
    )
  );
  const freq = {};
  (jobPosting.toLowerCase().match(/[a-z][a-z+.#-]{2,}/g) || []).forEach((w) => {
    if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  const resumeLower = resume.toLowerCase();
  const present = topKeywords.filter((k) => resumeLower.includes(k));
  const missing = topKeywords.filter((k) => !resumeLower.includes(k));

  const score = Math.max(
    45,
    Math.min(92, 55 + present.length * 5 - missing.length * 2)
  );

  return {
    review: {
      matchScore: score,
      strengths: [
        present.length
          ? `Your resume already reflects language the posting emphasizes: ${present
              .slice(0, 5)
              .join(", ")}.`
          : "Your resume shows relevant background that can be reframed toward this role.",
        `The opening (${firstLine.slice(
          0,
          60
        )}) can be sharpened into a headline aligned to this posting.`,
        "Concrete, quantifiable bullet points in your resume are strong anchors to emphasize.",
      ],
      gaps: missing.length
        ? missing
            .slice(0, 6)
            .map(
              (k) =>
                `The posting emphasizes "${k}" but your resume does not clearly mention it — surface it if you genuinely have it, otherwise treat it as a growth area.`
            )
        : [
            "No major keyword gaps detected — focus on reordering to lead with the most relevant experience.",
          ],
      suggestions: [
        "Lead each relevant bullet with the impact/metric, then the action, mirroring the posting's terminology where it honestly applies.",
        "Move the experience most relevant to this posting to the top of each section.",
        "Trim unrelated content so the reviewer sees the strongest match in the first third of the page.",
        "Add a short professional summary that echoes the posting's core responsibilities using only your real experience.",
      ],
    },
    tailoredResume: `${firstLine}
${"=".repeat(Math.min(firstLine.length, 60))}

PROFESSIONAL SUMMARY
--------------------
Results-driven professional aligning directly with this role's focus${
      present.length ? ` on ${present.slice(0, 3).join(", ")}` : ""
    }. (Reframed from your existing experience — no new claims added.)

TAILORED EXPERIENCE (reordered & reworded from your resume)
-----------------------------------------------------------
${resumeLines
  .slice(0, 40)
  .map((l) => (l.startsWith("-") || l.startsWith("•") ? l : `• ${l}`))
  .join("\n")}

NOTE
----
This mock tailored resume only reorders and rephrases your provided content.
Add your ANTHROPIC_API_KEY to generate a fully rewritten, posting-aligned version.`,
    supplementalAnswers: [
      {
        question: "Why this company/role?",
        answer: `This role aligns closely with the experience shown in my resume${
          present.length ? `, particularly around ${present.slice(0, 3).join(", ")}` : ""
        }. I'm drawn to the responsibilities described in the posting because they build directly on work I've already done. (Draft grounded only in your resume — add your API key for a company-specific answer.)`,
      },
      {
        question: "Why are you a strong fit?",
        answer: `My background maps to what this posting asks for: ${
          present.length ? present.slice(0, 4).join(", ") : "the core responsibilities listed"
        }. Each of these is backed by real experience already in my resume, which I can speak to in detail.`,
      },
      {
        question: "Describe a relevant project or accomplishment.",
        answer: `Drawing from my resume: ${
          resumeLines.find((l) => l.length > 40) ||
          resumeLines[1] ||
          "a project already listed in my experience"
        } — this demonstrates the skills the posting prioritizes. (Add your API key to expand this into a full STAR-format answer using only your real details.)`,
      },
    ],
  };
}

async function generateResult(resume, jobPosting) {
  if (MOCK_MODE) {
    return { mockMode: true, result: mockResult(resume, jobPosting) };
  }
  // Stream to avoid HTTP timeouts on the large tailored-resume output.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: "user", content: buildUserPrompt(resume, jobPosting) }],
  });

  const message = await stream.finalMessage();
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text content returned from the model.");

  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }
  return { mockMode: false, result };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mockMode: MOCK_MODE,
    model: MODEL,
    supabaseEnabled,
    dailyCap: DAILY_CAP,
  });
});

app.post("/api/generate", requireAuth, async (req, res) => {
  const { resume, jobPosting, jobTitle, jobUrl, resumeId } = req.body || {};
  if (!resume || !resume.trim()) {
    return res.status(400).json({ error: "Please provide your base resume." });
  }
  if (!jobPosting || !jobPosting.trim()) {
    return res.status(400).json({ error: "Please provide the job posting." });
  }

  // Enforce the per-user daily cap BEFORE spending any AI call.
  let usedToday = 0;
  if (supabaseEnabled) {
    try {
      usedToday = await countGenerationsToday(req.user.id);
    } catch (err) {
      console.error("usage count error:", err.message);
      return res.status(500).json({ error: "Could not verify your usage limit." });
    }
    if (isOverDailyLimit(usedToday, DAILY_CAP)) {
      return res.status(429).json({
        error: `Daily limit reached (${DAILY_CAP} generations/day). Try again tomorrow.`,
        limitReached: true,
        dailyCap: DAILY_CAP,
        remaining: 0,
      });
    }
  }

  try {
    const { mockMode, result } = await generateResult(resume, jobPosting);

    let remaining = null;
    if (supabaseEnabled) {
      // Record the generation against the cap and persist the application.
      try {
        await recordGeneration(req.user.id);
        await saveApplication(req.user.id, {
          resumeId: resumeId ?? null,
          jobTitle: jobTitle ?? null,
          jobUrl: jobUrl ?? null,
          jobPosting,
          resumeSnapshot: resume,
          result,
          mockMode,
        });
      } catch (err) {
        // Persistence failure should not lose the user's generated result.
        console.error("persistence error:", err.message);
      }
      remaining = remainingGenerations(usedToday + 1, DAILY_CAP);
    }

    res.json({ mockMode, result, remaining });
  } catch (err) {
    console.error("Generation error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to generate. Please try again." });
  }
});

// Parse an uploaded resume file (PDF / DOCX / TXT / MD) to plain text.
app.post("/api/parse-resume", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  try {
    const text = await parseResumeBuffer(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );
    if (!text || !text.trim()) {
      return res.status(422).json({
        error:
          "Could not extract any text from that file. If it is a scanned image PDF, paste the text instead.",
      });
    }
    res.json({ text, filename: req.file.originalname });
  } catch (err) {
    console.error("Parse error:", err.message);
    res.status(400).json({ error: err.message || "Failed to parse the file." });
  }
});

// Multer errors (e.g. file too large) arrive as an error middleware.
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  }
  next(err);
});

// History: a user's recent applications. Empty in anonymous mode.
app.get("/api/applications", requireAuth, async (req, res) => {
  if (!supabaseEnabled) return res.json({ applications: [] });
  try {
    const applications = await listApplications(req.user.id);
    res.json({ applications });
  } catch (err) {
    console.error("list applications error:", err.message);
    res.status(500).json({ error: "Could not load your history." });
  }
});

// Saved resumes.
app.get("/api/resumes", requireAuth, async (req, res) => {
  if (!supabaseEnabled) return res.json({ resumes: [] });
  try {
    const resumes = await listResumes(req.user.id);
    res.json({ resumes });
  } catch (err) {
    console.error("list resumes error:", err.message);
    res.status(500).json({ error: "Could not load your resumes." });
  }
});

app.post("/api/resumes", requireAuth, async (req, res) => {
  if (!supabaseEnabled) {
    return res.status(400).json({ error: "Saving resumes requires sign-in." });
  }
  const { title, content } = req.body || {};
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Resume content is empty." });
  }
  try {
    const resume = await saveResume(req.user.id, { title, content });
    res.json({ resume });
  } catch (err) {
    console.error("save resume error:", err.message);
    res.status(500).json({ error: "Could not save the resume." });
  }
});

// SPA catch-all: any non-/api GET falls back to index.html so client routing
// works. The /api routes above take precedence.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  const aiMode = MOCK_MODE ? "MOCK MODE — no API key" : `LIVE — model ${MODEL}`;
  const authMode = supabaseEnabled
    ? `Supabase ON — ${DAILY_CAP > 0 ? `${DAILY_CAP}/day cap` : "no cap"}`
    : "Supabase OFF — anonymous, no persistence";
  console.log(
    `Resume Tailor server on http://localhost:${PORT}  [${aiMode}]  [${authMode}]`
  );
});
