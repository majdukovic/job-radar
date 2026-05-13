# Structured-output policy (Blocker 5)

> Schemas, retry logic, fallback strategy, and monitoring for every LLM call that returns structured data. Schema-validity failure rate is one of the few production metrics that, if ignored, kills the product silently.

---

> ### 🟢 Beginner TL;DR
>
> When you ask Claude to "return JSON," sometimes it doesn't — it returns prose-then-JSON, or invalid JSON, or wrong-shape JSON. Your code crashes 4 layers later. Three things prevent this:
>
> 1. **Define a Zod schema** (TypeScript-style strict type) for the output. Validates the LLM's return.
> 2. **Use Anthropic "tool-use mode"** or OpenAI "json_schema mode" instead of asking for JSON in prose. Cuts schema failures by ~50%.
> 3. **Retry once with a stronger prompt** when validation fails. Almost always works on retry 1.
>
> The full `callLLMStructured()` wrapper code is in this doc — copy it. After that you never directly call the LLM API; you call the wrapper, which handles all of this for you.
>
> Monitor: schema-validity rate should be ≥ 99%. If it drops to 95%, your prompt has rotted.

---

## Why this exists

Three things go wrong with structured LLM outputs in production:

1. **Invalid JSON.** The model returns "```json\n{...\n}\n```" with trailing prose. `JSON.parse` throws. Pipeline drops the trace.
2. **Valid JSON, invalid schema.** Field types wrong, required fields missing, extra hallucinated fields. Downstream code crashes 4 layers later.
3. **Valid schema, wrong values.** `is_actually_remote: true` for a JD that clearly says "US only." This is a quality issue, not a structure issue — handled by the eval system, not this doc.

This doc handles (1) and (2). The eval system handles (3).

---

## The policy in one sentence

**Every structured LLM call goes through `callLLMStructured(component, schema, prompt, opts)` which validates against a Zod schema, retries up to 2 times with prompt strengthening, and routes irrecoverable failures to a manual-review queue.**

---

## Schemas per component

### `jd_normalizer`

```ts
import { z } from "zod";

export const JdNormalizerSchema = z.object({
  // Identity
  title: z.string().min(2).max(200),
  company: z.string().min(1).max(200),

  // Region (most important)
  is_actually_remote: z.boolean(),
  allowed_regions: z.array(
    z.enum([
      "Worldwide", "EU", "EMEA", "Europe", "Croatia",
      "US", "Americas", "LATAM", "APAC", "MENA",
      "Asia", "UK", "Germany", "Netherlands", "Other",
    ])
  ),
  excluded_regions: z.array(z.string()).default([]),
  timezone_constraints: z.string().nullable(),
  visa_sponsorship: z.enum(["yes", "no", "unspecified"]),

  // Seniority + compensation
  seniority: z.enum(["junior", "mid", "senior", "staff", "principal", "unspecified"]),
  salary_min: z.number().int().min(0).nullable(),
  salary_max: z.number().int().min(0).nullable(),
  salary_currency: z.string().length(3).nullable(),  // ISO 4217

  // Skills
  required_skills: z.array(z.string()).max(30),
  nice_to_have_skills: z.array(z.string()).max(30),

  // Self-report
  confidence_score: z.number().min(0).max(1),
  uncertain_fields: z.array(z.string()).default([]),
});
```

Notes:
- `allowed_regions` is a closed enum. The LLM is told "if the region doesn't fit, return `Other` and note it in `uncertain_fields`."
- `confidence_score` is the model's own confidence (0–1) that the extraction is accurate. Used downstream as a routing signal (low confidence → manual review).
- `uncertain_fields` lists the field names the model wasn't sure about. Drives sampling priority for error analysis.

### `region_classifier`

```ts
export const RegionClassifierSchema = z.object({
  is_applicable_for_user: z.boolean(),
  reasoning: z.string().min(10).max(500),
  confidence: z.number().min(0).max(1),
  triggered_rules: z.array(z.enum([
    "explicit_us_only", "explicit_eu_only", "explicit_worldwide",
    "timezone_only", "visa_required", "ambiguous", "no_signal",
  ])),
});
```

### `cover_letter_drafter`

```ts
export const CoverLetterSchema = z.object({
  cover_letter_markdown: z.string().min(200).max(3000),
  word_count: z.number().int().min(100).max(800),
  skills_referenced: z.array(z.string()),
  company_specific_lines: z.array(z.string()).min(1),
  ai_tells_self_check: z.array(z.string()).default([]),
});
```

The `ai_tells_self_check` field asks the model to flag its own potential AI-tells. A clever cheap trick: a model that knows what an AI-tell looks like won't produce one.

### `recruiter_specialty_classifier`

```ts
export const RecruiterSpecialtySchema = z.object({
  is_niche_recruiter: z.boolean(),
  niche_alignment_score: z.number().min(0).max(1),
  niche_keywords_matched: z.array(z.string()),
  evidence_post_ids: z.array(z.string()),
  reasoning: z.string().min(20).max(400),
});
```

---

## Retry policy

```ts
async function callLLMStructured<T extends z.ZodType>(
  component: ComponentName,
  schema: T,
  buildPrompt: (extraInstruction?: string) => string,
  opts: { maxRetries?: number; model?: string } = {},
): Promise<{ data: z.infer<T> | null; traceId: string; retries: number }> {
  const maxRetries = opts.maxRetries ?? 2;
  const traceId = ulid();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const extraInstruction = attempt === 0
      ? ""
      : `Your previous output failed validation: ${formatZodError(lastError)}. Return ONLY a JSON object matching the schema exactly. No code fences, no prose.`;

    const response = await callLLM(buildPrompt(extraInstruction), opts);

    try {
      const parsed = JSON.parse(extractJsonBlock(response));
      const validated = schema.parse(parsed);
      emitTrace({ component, traceId, schema_valid: true, retry_count: attempt, ... });
      return { data: validated, traceId, retries: attempt };
    } catch (e) {
      lastError = e;
      emitTrace({ component, traceId, schema_valid: false, retry_count: attempt, ... });
    }
  }

  // All retries exhausted → route to manual review
  await enqueueForManualReview({ traceId, component, lastError });
  return { data: null, traceId, retries: maxRetries };
}
```

Properties:
- **Idempotent retries**: each retry gets its own LLM call but shares the `traceId` for grouping. The `retry_count` field on the trace makes attempt failures inspectable.
- **Prompt strengthening on retry**: the second attempt tells the model what went wrong with the first. This single technique catches ~80% of schema failures in practice.
- **Bounded**: max 2 retries (so worst case 3 LLM calls per logical operation). Stops you from burning cost on a permanently confused prompt.

---

## Fallback model strategy

If the primary model (Haiku 4.5) hits structural failure even after retries, route the *single failed call* to a stronger model (Sonnet 4.6) as a one-time bail-out:

```ts
if (allRetriesFailed && component === "jd_normalizer") {
  // one-time bail-out to Sonnet — costs ~10x but rare
  return callLLMStructured(component, schema, buildPrompt, {
    maxRetries: 1,
    model: "claude-sonnet-4-6",
  });
}
```

Triggered for high-severity components only (jd_normalizer, region_classifier). Logged as `fallback_used: true` on the trace. Alert if `fallback_used` rate > 1% — it means the primary prompt has rotted.

---

## Manual-review queue

When all retries (and any fallback) fail, the trace is enqueued for human review rather than dropped:

```
manual_review(
  trace_id, component, input_text,
  last_error, attempts, created_at,
  status: "pending" | "fixed" | "discarded",
  resolution_notes
)
```

Surfaced on `/evals/review` page. You triage:
- **Fixed**: write the correct output manually; the row becomes a labeled example in the dataset (adversarial set candidate).
- **Discarded**: the input itself was garbage (truncated JD, non-English, irrelevant).

Manual-review backlog size is itself a metric. Sustained > 5 pending = quality alarm.

---

## Schema-failure monitoring

| Metric | Target | Alert |
|---|---|---|
| Per-component first-attempt schema-validity rate | ≥ 0.985 | Slack alert if < 0.96 over rolling 100 traces |
| Per-component post-retry schema-validity rate | ≥ 0.999 | Pager if < 0.99 |
| Fallback-model usage rate | < 0.01 | Slack alert if > 0.02 |
| Manual-review queue size | < 5 | Slack alert if > 10 |

Dashboarded in PostHog as a "Reliability" insight separate from quality metrics. **A model can be 99% quality-accurate and still unshipable if schema validity is < 99%** — production crashes don't care about quality.

---

## Native structured-output features

For maximum reliability, use the provider's native structured-output mode when available:

- **Anthropic**: tool-use mode with a single forced tool whose schema is the output structure. ~50% lower schema-failure rate than free-text JSON.
- **OpenAI**: `response_format: { type: "json_schema", json_schema: {...} }`.

The wrapper picks the right mode based on `model_provider`:

```ts
if (modelProvider === "anthropic") {
  return callViaToolUse(schema, prompt);  // forced single-tool
}
if (modelProvider === "openai") {
  return callViaJsonSchema(schema, prompt);
}
return callViaPlainJson(schema, prompt);  // fallback for others
```

This single decision is worth several percentage points of schema reliability and zero engineering effort once the wrapper exists.

---

## Edge cases the wrapper must handle

| Case | Handling |
|---|---|
| Model returns ```json ... ``` fences | `extractJsonBlock()` strips fences before parse |
| Model returns prose then JSON | Look for first `{` and last `}`; parse that substring |
| Model returns array when object expected | Schema validation catches; retry with explicit instruction |
| Model returns nested JSON-as-string | Pre-parse step: if a string field looks like JSON, attempt parse |
| Empty response | Throw `EmptyResponseError`; retry counts as a regular failure |
| API timeout | Retry once with exponential backoff; counts against retry budget |
| Rate-limited | Don't count against retry budget; wait + retry up to 3 times |
| Provider 500 | Same as rate-limit handling |

All edge cases logged with the specific failure reason in `last_error` so the manual-review page shows you exactly what happened.

---

## Cost implications

Schema failures + retries are real money. Budget:

- Baseline expected: 1.02 calls per logical op (98% first-attempt success)
- Acceptable: 1.05 calls per logical op (95% first-attempt)
- Alarm: 1.10 calls per logical op (rotting prompt or model drift)

Cost-aware retry: if a component has `cost_per_call > $0.05`, cap retries at 1 instead of 2. (Don't apply to job-radar yet — Haiku calls are ~$0.001 each.)

---

## Status / next steps

- [x] All schemas drafted (above).
- [ ] Implement `callLLMStructured` wrapper in Phase 1.
- [ ] Implement Anthropic tool-use mode adapter in Phase 1.
- [ ] Implement OpenAI json_schema mode adapter in Phase 1.
- [ ] Manual-review page in Phase 2.
- [ ] Reliability dashboard in PostHog in Phase 2.
- [ ] Cost-aware retry caps revisited at month 2.
