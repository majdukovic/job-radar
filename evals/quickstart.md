# Quickstart — zero to first trace

> Sequential setup. Don't skip; don't re-order. Plan ~2–3 hours the first time. After this you can write the first real prompt.

---

## What you'll have at the end

- Empty Next.js + Supabase + Inngest project deployed locally
- Anthropic + OpenAI + PostHog accounts wired
- One working `$ai_generation` trace flowing into PostHog
- A `prompts/jd_normalizer/v1.md` file you can iterate on

That's enough to start Phase 1 proper.

---

## 0. Accounts to create (do these first, in parallel browser tabs)

| Service | Why | Free tier? | Approx setup time |
|---|---|---|---|
| [Anthropic Console](https://console.anthropic.com/) | LLM API (Claude Haiku 4.5) | $5 free credit on signup | 10 min |
| [OpenAI Platform](https://platform.openai.com/) | Embeddings + cross-family judge (GPT-4o-mini) | $5 first deposit | 10 min |
| [PostHog](https://posthog.com/) | LLM Analytics tracing | Free under 1M events/mo | 10 min |
| [Supabase](https://supabase.com/) | Postgres + pgvector + auth | Free under 500MB | 10 min |
| [Inngest](https://www.inngest.com/) | Background workers | Free tier covers you | 5 min |
| [Vercel](https://vercel.com/) | Deployment (optional Phase 1) | Free hobby | 5 min |
| [Apify](https://apify.com/) | LinkedIn / Wellfound scraping (Phase 2) | $5 free credit | 5 min |

**Set a $20/mo soft spending cap on Anthropic and OpenAI.** Both consoles have this setting. It prevents an accidentally-recursive job from costing $500.

---

## 1. Local dev environment

```bash
# Confirm Node 20+ is installed
node --version    # should be v20.x or v22.x

# Install pnpm if you don't have it
npm install -g pnpm

# Confirm git is installed
git --version
```

---

## 2. Bootstrap the project

```bash
cd ~/GithubProjects
pnpm create next-app@latest job-radar
# When prompted, choose:
#   ✓ TypeScript
#   ✓ ESLint
#   ✓ Tailwind CSS
#   ✓ src/ directory
#   ✓ App Router
#   ✗ Turbopack (stick with webpack for now)
#   ✓ import alias (default @/*)

cd job-radar
git init -b main
```

---

## 3. Add the eval scaffolding

```bash
# Copy the planning docs into the repo
mv ~/Desktop/job-radar-evals ./evals
mv ~/Desktop/job-radar-plan.md ./PLAN.md

# Commit
git add .
git commit -m "chore: import planning docs and eval scaffolding"
```

---

## 4. Install dependencies

```bash
pnpm add @anthropic-ai/sdk openai posthog-node @supabase/supabase-js \
         inngest zod ulid resend simple-statistics
pnpm add -D promptfoo dotenv-cli
```

---

## 5. Environment variables

Create `.env.local` (DO NOT commit):

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (for embeddings + cross-family judge)
OPENAI_API_KEY=sk-...

# PostHog (LLM Analytics)
POSTHOG_API_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # for server-side only; never expose

# Inngest
INNGEST_SIGNING_KEY=signkey-...
INNGEST_EVENT_KEY=...

# Resend (Phase 3+)
RESEND_API_KEY=re_...
```

Add to `.gitignore`:

```
.env.local
.env.*.local
evals/_private/
```

---

## 6. Supabase setup

In the Supabase dashboard:

1. **Create a new project** (name: `job-radar`, region: `eu-central-1` for Croatia)
2. **Enable pgvector**: SQL Editor → run `CREATE EXTENSION IF NOT EXISTS vector;`
3. **Disable RLS for now**: Authentication → Policies → leave tables RLS-off until Phase 6 (single-seat app)
4. **Copy connection strings** into `.env.local`

Schema (run in SQL Editor):

```sql
-- minimal schema for Phase 1
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  raw_source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  company TEXT,
  raw_text TEXT NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  -- normalized fields populated by jd_normalizer
  is_actually_remote BOOLEAN,
  allowed_regions TEXT[],
  excluded_regions TEXT[],
  required_skills TEXT[],
  nice_to_have_skills TEXT[],
  seniority TEXT,
  salary_min INT,
  salary_max INT,
  salary_currency TEXT,
  visa_sponsorship TEXT,
  confidence_score NUMERIC,
  embedding VECTOR(1536),
  -- scoring
  region_fit BOOLEAN,
  skill_match_score INT,
  overall_fit_score INT,
  score_explanation TEXT,
  state TEXT DEFAULT 'new',
  UNIQUE (raw_source, source_id)
);

CREATE TABLE eval_labels (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL,
  component TEXT NOT NULL,
  input TEXT NOT NULL,
  llm_output JSONB,
  your_label TEXT,           -- "good" | "bad" | null
  your_correction JSONB,
  your_notes TEXT,
  set_assignment TEXT,       -- "dev" | "test" | "adversarial" | null
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eval_labels_component ON eval_labels(component);
CREATE INDEX idx_eval_labels_set ON eval_labels(set_assignment);
```

---

## 7. PostHog setup

1. Log in to PostHog → create project `job-radar`.
2. **Enable LLM Observability**: Sidebar → Product Analytics → LLM Observability → toggle on.
3. Copy the project API key into `.env.local` as `POSTHOG_API_KEY`.

---

## 8. First trace — the "hello world" of job-radar

Create `src/lib/posthog.ts`:

```ts
import { PostHog } from "posthog-node";

let client: PostHog | null = null;

export function getPostHog(): PostHog {
  if (!client) {
    client = new PostHog(process.env.POSTHOG_API_KEY!, {
      host: process.env.POSTHOG_HOST,
      flushAt: 1,           // dev: send immediately. In prod, increase.
    });
  }
  return client;
}
```

Create `src/lib/llm.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { ulid } from "ulid";
import { z } from "zod";
import { getPostHog } from "./posthog";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// minimal Phase 1 normalizer schema — will grow
const JdNormalizerSchemaV1 = z.object({
  title: z.string(),
  is_actually_remote: z.boolean(),
  allowed_regions: z.array(z.string()),
  required_skills: z.array(z.string()),
  confidence_score: z.number().min(0).max(1),
});

const PROMPT_V1 = `You are a careful extractor of structured data from job postings.

Read the job description below and return JSON with these fields:
- title: the canonical role title
- is_actually_remote: true only if a Croatia/EU-based candidate can apply
- allowed_regions: array of region codes from {Worldwide, EU, EMEA, US, LATAM, Other}
- required_skills: array of required technical skills as listed
- confidence_score: 0.0 to 1.0 your confidence the extraction is accurate

Return ONLY the JSON object. No prose, no code fences.

Job description:
"""
{{JD_TEXT}}
"""`;

export async function normalizeJd(jdText: string, correlationId?: string) {
  const traceId = ulid();
  const corr = correlationId ?? traceId;
  const t0 = Date.now();
  const prompt = PROMPT_V1.replace("{{JD_TEXT}}", jdText);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const outputRaw = response.content[0].type === "text"
    ? response.content[0].text
    : "";

  let outputParsed = null;
  let schemaValid = false;
  try {
    outputParsed = JdNormalizerSchemaV1.parse(JSON.parse(outputRaw));
    schemaValid = true;
  } catch (e) {
    // Phase 1: log and move on. Retry logic comes from structured_output_policy.md.
    console.warn("Schema validation failed:", e);
  }

  const ph = getPostHog();
  ph.capture({
    distinctId: "single-seat",
    event: "$ai_generation",
    properties: {
      trace_id: traceId,
      correlation_id: corr,
      component: "jd_normalizer",
      prompt_template_name: "jd_normalizer_v1",
      prompt_version: "sha:bootstrap",   // proper SHA-based versioning in Phase 1 task
      model: "claude-haiku-4-5-20251001",
      model_provider: "anthropic",
      temperature: 0,
      max_tokens: 1024,
      input_text: jdText,
      output_raw: outputRaw,
      output_parsed: outputParsed,
      schema_valid: schemaValid,
      latency_ms: Date.now() - t0,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: estimateCost(response.usage),
      timestamp_ms: Date.now(),
      sampling_bit: Math.random(),
      retry_count: 0,
      source_platform: "test",
    },
  });
  await ph.shutdown();  // dev only; ensures event is sent before exit

  return { traceId, outputParsed };
}

function estimateCost(usage: { input_tokens: number; output_tokens: number }) {
  // Haiku 4.5 pricing as of 2026-05; check current prices on anthropic.com
  return (usage.input_tokens * 0.25 + usage.output_tokens * 1.25) / 1_000_000;
}
```

Create `scripts/hello-trace.ts`:

```ts
import "dotenv/config";
import { normalizeJd } from "../src/lib/llm";

const sampleJd = `
Senior QA Engineer — Remote (Europe-based)

We're hiring a mid-to-senior QA engineer to join our distributed team.
Must-have: 3+ years of mobile automation with Appium, strong Java skills.
Nice-to-have: Cypress, experience with iOS/Android device farms.

Location: fully remote within EMEA timezones.
`;

(async () => {
  const result = await normalizeJd(sampleJd);
  console.log("Trace ID:", result.traceId);
  console.log("Parsed output:", JSON.stringify(result.outputParsed, null, 2));
})();
```

Run it:

```bash
pnpm exec tsx scripts/hello-trace.ts
```

Expected output:
```
Trace ID: 01HXMC2BSPM5QYQ0HCR0X3PZAE
Parsed output: {
  "title": "Senior QA Engineer",
  "is_actually_remote": true,
  "allowed_regions": ["EMEA", "EU"],
  "required_skills": ["Appium", "Java"],
  "confidence_score": 0.92
}
```

---

## 9. Verify the trace landed in PostHog

1. Open PostHog → LLM Observability → Traces
2. You should see the trace with `component: jd_normalizer`
3. Click in — verify `input_text`, `output_parsed`, `prompt_version` all populated

If anything is missing, double-check `.env.local` and `flushAt: 1`. **First-trace troubleshooting is usually env-var-related.**

---

## 10. Commit

```bash
git add .
git commit -m "feat: hello-world LLM trace emitting to PostHog"
```

---

## 11. What comes next (Phase 1 proper)

Now you're ready to:
- Replace the hardcoded `sha:bootstrap` with real prompt SHA versioning (see `trace_schema.md`)
- Add the `region_classifier` smart baseline (see `baselines.md`)
- Wire the first Inngest poller against Remotive's free API
- Build the `/jobs` page that reads from Supabase

Phase 1 estimate: ~3 evenings if you're new to Next.js App Router + Inngest. ~1 day if you're not.

---

## Troubleshooting hierarchy

When something doesn't work, check in this order:

1. **Env vars present?** `node --eval "console.log(process.env.ANTHROPIC_API_KEY?.slice(0,10))"`
2. **API quota?** Check Anthropic / OpenAI console dashboards
3. **Network?** `curl https://api.anthropic.com/v1/messages -i` (you'll get 401 — that confirms reachability)
4. **PostHog ingestion?** Look at Activity → Live Events in PostHog dashboard; events appear within ~10 seconds
5. **TypeScript errors?** `pnpm tsc --noEmit`
6. **Stuck after 30 minutes?** Stop, document what you tried in a scratch file, sleep on it. Most stuck-points dissolve overnight.

---

**You're ready.** Next read: `prompt_engineering_primer.md` and `dry_run_case_study.md`.
