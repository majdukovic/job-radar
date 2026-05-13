# PostHog LLM Analytics starter

> Where to click, what events look like, how to filter, how to add a judge from the UI. Aimed at someone who has never used PostHog's LLM features specifically.

---

## What PostHog LLM Analytics gives you

Three things you don't have to build:

1. **Trace storage** for every `$ai_generation` event you emit
2. **Trace viewer UI** — search, filter, drill into a single trace and see inputs/outputs/cost
3. **Online evaluation** — attach judges (hog code or LLM-as-judge) to your traces; PostHog runs them at sample rate and stores `$ai_evaluation` events keyed back

All on PostHog's free tier under 1M events/month, which is far above what a single-seat job-radar will produce.

---

## Enabling LLM Analytics (one-time)

After you create your PostHog project in the quickstart:

1. **Sidebar → Product Analytics → LLM Observability**
2. If the page shows "Get started" — click → enable. (Some accounts have it on by default.)
3. **Project settings → Data management → Event ingestion** — confirm `$ai_generation` and `$ai_evaluation` are in the recognized events list. PostHog auto-recognizes them once your first event lands.

If you don't see the LLM Observability menu item, your account may be on an old plan. Contact PostHog support — they enable it for free for individual builders.

---

## What an `$ai_generation` trace looks like in the UI

After you run `scripts/hello-trace.ts` from the quickstart, navigate to:

**LLM Observability → Traces**

You'll see a table with one row per trace. Columns:

| Column | Meaning |
|---|---|
| Time | When the event was captured |
| Event | `$ai_generation` |
| Model | `claude-haiku-4-5-20251001` |
| Component | `jd_normalizer` (your custom property) |
| Latency | Wall time |
| Tokens | Input / output |
| Cost | Your `cost_usd` field |
| Trace ID | ULID, clickable |

**Click a row.** You see:
- Full input text
- Full output (raw + parsed)
- Every property in your trace schema
- Linked `$ai_evaluation` events (if any judges have run)

---

## Filtering the trace view

The single most useful filter for daily error analysis:

**Filter: `component = jd_normalizer` AND `schema_valid = false`**

Shows you every structured-output failure. Should be small. Investigate every one.

Other common filters:

| Filter | What it finds |
|---|---|
| `user_label = "bad"` | Things you thumbed down |
| `confidence_score < 0.6` | Model self-flagged as uncertain |
| `retry_count >= 1` | Schema failures that retried |
| `cost_usd > 0.01` | Expensive calls — investigate why |
| `latency_ms > 5000` | Slow calls — investigate why |
| `prompt_version = "sha:a3f2b9c"` | Everything from one specific prompt version |

Save filters: PostHog lets you save filter combinations as "Insights." Save 5–10 you use weekly.

---

## Trends dashboard for daily monitoring

Build an "LLM health" dashboard with these tiles:

| Tile | Insight type | Query |
|---|---|---|
| Total `$ai_generation` per day | Trends, total | Last 30 days |
| Schema-valid rate | Trends, % | `count(schema_valid=true)` / total, daily |
| Per-component breakdown | Bar chart | `breakdown_by: component` |
| Cost per day | Trends, sum | `sum(cost_usd)` |
| Thumbs-down rate | Trends, % | `count($ai_evaluation where label='bad')` / `count($ai_generation)` |
| 95th percentile latency | Trends, p95 | `latency_ms` |

This dashboard becomes your morning glance. 30 seconds, every day.

---

## Adding an LLM-as-judge in the UI (vs in code)

PostHog has two ways to run judges:

### Option A: hog evaluator (deterministic, free, fast)

Use when the check is rule-based:
- "did the output have all required fields?"
- "is `is_actually_remote` boolean?"
- "did `cost_usd` exceed a threshold?"

**LLM Observability → Evaluators → New evaluator → hog**

Hog is PostHog's custom scripting language. Looks like Python:

```hog
fn evaluate(event):
  output = event.properties.output_parsed
  if output is null: return {label: "skip"}
  required = ["title", "is_actually_remote", "allowed_regions"]
  for field in required:
    if output[field] is null: return {label: "fail", reason: f"missing {field}"}
  return {label: "pass"}
```

Runs against every `$ai_generation` automatically. Zero LLM cost. Posts `$ai_evaluation` results back.

### Option B: llm_judge evaluator (Phase 4+)

Use when the check requires judgment:
- "is the region classification correct given the JD?"
- "does the cover letter avoid AI-tells?"

**LLM Observability → Evaluators → New evaluator → LLM judge**

Configure:
- **Judge model**: cross-family from generator! If generator is Haiku, judge with GPT-4o-mini.
- **Sample rate**: 10% in Phase 4, 100% once you trust the judge.
- **Judge prompt**: the rubric. PostHog provides a template; replace with your calibrated prompt (see `judges/example_region_judge.md`).
- **Output**: schema for the judge's verdict, e.g. `{label: "correct"|"incorrect", confidence: number}`.

Runs in the background. Costs ~$0.0005 per call for Haiku-class judges at sample rate 10% on your volume → pennies a month.

**Critical**: do NOT enable an LLM judge before you've calibrated it offline against your own labels (see `dataset_methodology.md`). An uncalibrated judge will populate your dashboard with noise that looks like signal.

---

## How `$ai_evaluation` events link back to `$ai_generation`

The wire-up is: `$ai_evaluation` has a `$ai_trace_id` property that matches `$ai_generation.trace_id`. PostHog joins them automatically in the trace viewer.

In your code (Phase 3 thumbs UI):

```ts
posthog.capture({
  distinctId: "single-seat",
  event: "$ai_evaluation",
  properties: {
    $ai_trace_id: targetTraceId,     // links to the $ai_generation
    component: "jd_normalizer",
    rater: "human:mate",
    label: "bad",
    corrected_output: { ... },
    notes: "Missed Appium in required skills",
    failure_mode_id: "FM-002",       // optional link to your taxonomy
  },
});
```

In the trace view, the original `$ai_generation` row now shows your evaluation inline.

---

## Daily / weekly PostHog rituals

| Cadence | Action |
|---|---|
| Daily morning | Open LLM health dashboard. Glance. Anything red? |
| Daily eval-session | Filter `user_label IS NULL AND component = '<rotating focus>'`. Open 5 random traces. Thumb each one. |
| Weekly | Open `schema_valid = false`. Inspect every one. Decide: prompt fix, schema relax, or accept. |
| Weekly | Check judge agreement: `% of $ai_evaluation events where human label matches judge label`. Drift > 5%? Recalibrate. |
| Monthly | Look at cost-per-component. Anything blowing up? |

---

## Public-repo presentation

Your PostHog dashboard isn't public, but **a screenshot of the LLM-health tiles** is the single highest-signal image for your portfolio. Shows:
- You instrument production
- You track schema validity, not just quality
- You watch cost
- You have judges running

Annotated screenshot in a blog post = portfolio gold.

---

## Things you might want to know but don't have to set up Day 1

- **OpenTelemetry export** — PostHog can ingest OTEL spans natively. Useful in Phase 7 if you stand up Langfuse and want both to receive the same data.
- **Cohorts** — group traces by user. Single-seat doesn't need this.
- **Feature flags for prompt A/B tests** — Phase 5+ when you want to A/B test prompt v3 vs v4 in production.
- **Replay** — PostHog also does session replay. Not relevant for an LLM API project.

---

## TL;DR

1. Enable LLM Observability in PostHog
2. Emit `$ai_generation` with the trace_schema fields
3. Build the LLM-health dashboard (5 tiles, 5 minutes)
4. Wire the thumbs UI → `$ai_evaluation` in Phase 3
5. Add hog evaluators in Phase 3 for deterministic checks
6. Add LLM-judge evaluator in Phase 4 only after calibrating offline
7. Glance at dashboard daily; deep-dive weekly

Setup time: 45 minutes if you're already in PostHog; 90 minutes if you're new to the product.
