import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const PORT = process.env.PORT || 3001;
const MODEL = "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MOCK_MODE = !API_KEY;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The built client (vite build) lands in <repo>/client/dist.
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Serve the built client as static files. In dev the client is served by Vite
// on 5173; in production this is how the SPA is delivered.
app.use(express.static(CLIENT_DIST));

const client = MOCK_MODE ? null : new Anthropic({ apiKey: API_KEY });

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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mockMode: MOCK_MODE, model: MODEL });
});

app.post("/api/generate", async (req, res) => {
  const { resume, jobPosting } = req.body || {};
  if (!resume || !resume.trim()) {
    return res.status(400).json({ error: "Please provide your base resume." });
  }
  if (!jobPosting || !jobPosting.trim()) {
    return res.status(400).json({ error: "Please provide the job posting." });
  }

  if (MOCK_MODE) {
    return res.json({ mockMode: true, result: mockResult(resume, jobPosting) });
  }

  try {
    // Stream to avoid HTTP timeouts on the large tailored-resume output.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      messages: [
        { role: "user", content: buildUserPrompt(resume, jobPosting) },
      ],
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

    res.json({ mockMode: false, result });
  } catch (err) {
    console.error("Generation error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to generate. Please try again." });
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
  console.log(
    `Resume Tailor server on http://localhost:${PORT}  [${
      MOCK_MODE ? "MOCK MODE — no API key" : `LIVE — model ${MODEL}`
    }]`
  );
});
