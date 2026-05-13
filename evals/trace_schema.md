# Trace schema (Blocker 1)

> Every LLM call in job-radar emits a `$ai_generation` event matching this schema. If you cannot tell which prompt version produced a metric, the metric is meaningless. This doc is the contract.

---

> ### 🟢 Beginner TL;DR
>
> Every time your code calls Claude or GPT, you log a row to PostHog with the input, the output, **and the SHA hash of the prompt file you used.** That last bit is the only non-obvious part — without it you can't compare prompt v1 to v2 later. The rest is metadata (cost, latency, tokens, model name) you'd want anyway for debugging.
>
> Concrete starter: copy the `normalizeJd()` function from `quickstart.md` step 8. It already emits a correct-shaped trace. Modify from there.
>
> Open `glossary.md` if any term below is unfamiliar.

---

## Why this exists

You will run hundreds of prompt experiments over the project's life. Some will improve metrics, some will silently regress them. The *only* way to attribute a metric change to a specific prompt change is to **log the prompt's content hash on every call**. Most teams discover this 3–6 months in, after their first "did the eval go down because of model X or prompt Y?" debugging session takes a day. We pre-empt it.

This schema also enables: re-running a historical trace through a new prompt version, sampling production traffic for online evals, deduplicating events across retries, and attributing user feedback (thumbs up/down) back to the call that produced the output.

---

## Required fields (must be present on every event)

| Field | Type | Example | Purpose |
|---|---|---|---|
| `trace_id` | uuid | `01HX7…` | Unique per LLM call |
| `correlation_id` | uuid | `01HX7…` | Same across all calls for one job (normalizer → scorer → drafter) |
| `component` | string enum | `"jd_normalizer"` | One of the 6 known components (see below) |
| `prompt_template_name` | string | `"jd_normalizer_v3"` | Human-readable name |
| `prompt_version` | string | `"sha:a3f2b9c"` | Git short SHA of the prompt file at call time |
| `model` | string | `"claude-haiku-4-5-20251001"` | Pinned model version, NOT a family alias |
| `model_provider` | string enum | `"anthropic"` | `anthropic` \| `openai` \| `groq` \| ... |
| `temperature` | float | `0.0` | |
| `max_tokens` | int | `1024` | |
| `input_text` | string | full JD text | Not truncated; we need this to re-run |
| `output_raw` | string | raw LLM response | Pre-parse |
| `output_parsed` | json \| null | parsed JSON | Null if schema validation failed |
| `schema_valid` | bool | `true` | Did the structured-output policy succeed? |
| `latency_ms` | int | `842` | End-to-end wall time |
| `input_tokens` | int | `1320` | |
| `output_tokens` | int | `412` | |
| `cost_usd` | float | `0.00132` | Computed at log-time, not derived later |
| `timestamp_ms` | int | unix ms | |
| `sampling_bit` | float | `0.0–1.0` | Uniform random; lets us sample N% for online eval |
| `retry_count` | int | `0` | Schema-fail retries; see `structured_output_policy.md` |
| `source_platform` | string | `"linkedin"` | Where the input data came from |

---

## Optional fields (present when applicable)

| Field | Type | When |
|---|---|---|
| `parent_trace_id` | uuid | When this call is a retry of another |
| `judge_of_trace_id` | uuid | When this call is itself a judge evaluation of another trace |
| `experiment_id` | string | When this call is part of an A/B test |
| `variant` | string | `"control"` \| `"treatment_a"` for A/B |
| `user_label` | enum | `"good"` \| `"bad"` \| `null` — attached post-hoc when user clicks thumbs |
| `user_correction` | json | The corrected output if user provided one |
| `eval_set_membership` | string | `"dev"` \| `"test"` \| `"adversarial"` \| `null` |

`user_label` and `user_correction` are written via a follow-up event, not the original `$ai_generation`. PostHog supports this via `posthog.capture("$ai_evaluation", { $ai_trace_id: trace_id, ... })`.

---

## Known components

These are the canonical `component` values. New components require a doc update + a baseline entry in `baselines.md` and a success target in `success_criteria.md`.

1. `jd_normalizer` — extracts structured fields from a job posting
2. `region_classifier` — sub-task of normalizer; can be split for evaluation purposes
3. `skill_matcher` — scores user skills vs required skills with substitution credit
4. `cover_letter_drafter` — generates cover letter draft
5. `recruiter_specialty_classifier` — decides if a LinkedIn user is a niche recruiter
6. `recruiter_outreach_drafter` — generates outreach DM draft

A 7th, `judge:<rubric_name>`, is emitted by judges themselves so we can monitor their cost and behaviour over time.

---

## Example event payload

```json
{
  "event": "$ai_generation",
  "properties": {
    "trace_id": "01HXMC2BSPM5QYQ0HCR0X3PZAE",
    "correlation_id": "01HXMC2BSPM5QYQ0HCR0X3PZA0",
    "component": "jd_normalizer",
    "prompt_template_name": "jd_normalizer_v3",
    "prompt_version": "sha:a3f2b9c",
    "model": "claude-haiku-4-5-20251001",
    "model_provider": "anthropic",
    "temperature": 0.0,
    "max_tokens": 1024,
    "input_text": "Senior QA Engineer (Remote, EU only)…",
    "output_raw": "{\"title\":\"Senior QA Engineer\",\"is_actually_remote\":true,\"allowed_regions\":[\"EU\"],…}",
    "output_parsed": {
      "title": "Senior QA Engineer",
      "is_actually_remote": true,
      "allowed_regions": ["EU"],
      "required_skills": ["Cypress", "JavaScript"]
    },
    "schema_valid": true,
    "latency_ms": 842,
    "input_tokens": 1320,
    "output_tokens": 142,
    "cost_usd": 0.00046,
    "timestamp_ms": 1747146023000,
    "sampling_bit": 0.31,
    "retry_count": 0,
    "source_platform": "linkedin_jobs"
  }
}
```

---

## Prompt versioning scheme

Each prompt template lives in a file under `prompts/<component>/<name>.md`. The "version" is the **git short SHA of that file at call time** (NOT the HEAD of main).

```ts
// pseudo-code
import { execSync } from "child_process";

function promptVersion(promptPath: string): string {
  // git log -1 --format=%h -- prompts/jd_normalizer/v3.md
  const sha = execSync(
    `git log -1 --format=%h -- ${promptPath}`
  ).toString().trim();
  return `sha:${sha}`;
}
```

In production (where git history isn't available at runtime), bake the SHA into the build:

```ts
// at build time, generate prompts/_versions.json
// { "jd_normalizer/v3.md": "a3f2b9c", ... }
```

Then at runtime read from `_versions.json` — fast, deterministic, doesn't require git.

---

## How to emit from Next.js / Inngest

```ts
import { PostHog } from "posthog-node";
import { ulid } from "ulid";

const posthog = new PostHog(process.env.POSTHOG_KEY!, {
  host: "https://us.i.posthog.com",
});

export async function normalizeJD(rawJd: string, correlationId: string) {
  const traceId = ulid();
  const promptVersion = PROMPT_VERSIONS["jd_normalizer/v3.md"];
  const t0 = Date.now();

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: buildPrompt(rawJd) }],
  });

  const outputRaw = response.content[0].text;
  let outputParsed = null;
  let schemaValid = false;
  try {
    outputParsed = JdNormalizerSchema.parse(JSON.parse(outputRaw));
    schemaValid = true;
  } catch (_) {
    /* see structured_output_policy.md for retry handling */
  }

  posthog.capture({
    distinctId: "single-seat",
    event: "$ai_generation",
    properties: {
      trace_id: traceId,
      correlation_id: correlationId,
      component: "jd_normalizer",
      prompt_template_name: "jd_normalizer_v3",
      prompt_version: promptVersion,
      model: "claude-haiku-4-5-20251001",
      model_provider: "anthropic",
      temperature: 0,
      max_tokens: 1024,
      input_text: rawJd,
      output_raw: outputRaw,
      output_parsed: outputParsed,
      schema_valid: schemaValid,
      latency_ms: Date.now() - t0,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: estimateCost(response.usage, "haiku-4-5"),
      timestamp_ms: Date.now(),
      sampling_bit: Math.random(),
      retry_count: 0,
      source_platform: "linkedin_jobs",
    },
  });

  return { traceId, outputParsed };
}
```

`correlationId` is generated once per job ingest; all downstream LLM calls (region classifier, skill match, cover letter drafter) share it. This lets you reconstruct the full per-job pipeline in PostHog.

---

## How user feedback (thumbs) gets attached

The `/jobs/[id]` page has thumbs-up/down. When clicked, fire a second event:

```ts
posthog.capture({
  distinctId: "single-seat",
  event: "$ai_evaluation",
  properties: {
    $ai_trace_id: targetTraceId,    // the original $ai_generation
    component: "jd_normalizer",     // duplicate for filtering
    rater: "human:mate",
    label: "bad",
    corrected_output: { ... },      // optional, from edit modal
    notes: "Missed that 'Remote within EMEA' restricts visa sponsorship",
    failure_mode_id: "FM-007",      // optional, links to taxonomy
  },
});
```

PostHog's LLM Analytics joins these via `$ai_trace_id` automatically; you can build a Trends insight on "% of `jd_normalizer` traces with label = bad" out of the box.

---

## PII / public-repo handling

Some `input_text` values (LinkedIn posts, recruiter profile JSON) contain personal data. The instrumentation layer applies a **redaction pass before logging** when the source is LinkedIn or X:

```ts
const REDACTABLE_SOURCES = new Set(["linkedin_jobs", "linkedin_posts", "x"]);

function maybeRedact(text: string, source: string): string {
  if (!REDACTABLE_SOURCES.has(source)) return text;
  return text
    .replace(EMAIL_REGEX, "<email>")
    .replace(PHONE_REGEX, "<phone>")
    .replace(LINKEDIN_URL_REGEX, "<linkedin>");
}
```

Recruiter-specific fields (name, profile URL) are stored only in the `recruiters` table, never in `$ai_generation` events that may eventually be exported for public posts.

---

## Validation

The PostHog SDK doesn't enforce a schema. We enforce it at the wrapper layer:

```ts
const AiGenerationProperties = z.object({
  trace_id: z.string().min(1),
  correlation_id: z.string().min(1),
  component: z.enum([
    "jd_normalizer", "region_classifier", "skill_matcher",
    "cover_letter_drafter", "recruiter_specialty_classifier",
    "recruiter_outreach_drafter",
  ]).or(z.string().startsWith("judge:")),
  prompt_version: z.string().regex(/^sha:[a-f0-9]{7,40}$/),
  // … rest of required fields
});

function emitAiGeneration(props: unknown) {
  const parsed = AiGenerationProperties.parse(props); // throws on bad payload
  posthog.capture({ event: "$ai_generation", properties: parsed, ... });
}
```

Throwing on bad payload is intentional — better to fail loudly in dev than silently log malformed events.

---

## Status / next steps

- [x] Schema defined (this doc).
- [ ] Implement the wrapper helper `emitAiGeneration()` in Phase 1.
- [ ] Add `prompts/_versions.json` build step in Phase 1.
- [ ] Implement redaction pass in Phase 3 (when LinkedIn sources land).
- [ ] Backfill: when migrating prompts from v1 → v2, do NOT mutate historical trace `prompt_version` fields. They're immutable history.
