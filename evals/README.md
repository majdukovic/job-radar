# job-radar / evals

Eval-engineering scaffolding for job-radar's AI components. Read this first.

> 🟢 **Quick orientation if you're new to AI evals:** open [`index.html`](./index.html) in your browser for the visual overview, then read `glossary.md` (skim, leave in a tab), then `quickstart.md` (sequential setup), then `dry_run_case_study.md` (the methodology in narrative form). Total: ~90 minutes. After that you're ready to build.

> **Status (2026-05-13):** Authored before Phase 1 implementation. Closes the 6 Blockers identified in the pre-build audit. Lives in `~/Desktop/job-radar-evals/` until the job-radar repo is created, then moves to `job-radar/evals/`.

---

## Why these docs exist before any code

The audit found that without these six artifacts in place, every eval number job-radar produces would be uncomparable, statistically meaningless, or silently biased. The fix is roughly half a day of doc-writing *before* Phase 1 code begins. After that, evals become a normal part of the development loop instead of an afterthought.

This is the same discipline Hamel Husain + Shreya Shankar teach in their AI Evals course — except we authored it from first principles for this specific project rather than from a generic template.

---

## The 6 Blocker docs

| # | Doc | What it closes | Read when |
|---|---|---|---|
| 1 | [`trace_schema.md`](./trace_schema.md) | No prompt versioning in traces → every metric becomes ambiguous | Before writing the first LLM call |
| 2 | [`baselines.md`](./baselines.md) | No baseline → cannot tell if LLM is worth the cost | Before declaring any LLM "good" |
| 3 | [`dataset_methodology.md`](./dataset_methodology.md) | No train/dev/test split → inflated numbers that don't generalize | Before collecting the first 100 labels |
| 4 | [`success_criteria.md`](./success_criteria.md) | No pre-registered thresholds → moving goalposts | Before Phase 1 build starts |
| 5 | [`structured_output_policy.md`](./structured_output_policy.md) | JSON failures crash the pipeline silently | Before writing any structured-output prompt |
| 6 | [`failure_taxonomy_template.md`](./failure_taxonomy_template.md) | Failure notes rot into useless markdown | Before the first error-analysis session |

---

## How the docs fit together

```
                         ┌────────────────────────────────┐
                         │  trace_schema.md  (Blocker 1)  │
                         │  Every LLM call logs THIS      │
                         └──────────────┬─────────────────┘
                                        │ produces traces
                                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │  dataset_methodology.md  (Blocker 3)                      │
        │  Traces → labeled examples, stratified, train/dev/test    │
        └────────────┬───────────────────────┬──────────────────────┘
                     │                       │
                     ▼                       ▼
    ┌───────────────────────────┐   ┌──────────────────────────────┐
    │ baselines.md  (Blocker 2) │   │ failure_taxonomy_template.md │
    │ Compare LLM vs dumb       │   │  (Blocker 6)                 │
    │ regex baseline            │   │ Modes catalogued from data   │
    └────────────┬──────────────┘   └──────────┬───────────────────┘
                 │                             │
                 └─────────────┬───────────────┘
                               ▼
              ┌─────────────────────────────────────┐
              │ success_criteria.md  (Blocker 4)    │
              │ Pre-registered thresholds per       │
              │ component → CI gate                  │
              └─────────────┬───────────────────────┘
                            ▼
              ┌─────────────────────────────────────┐
              │ structured_output_policy.md         │
              │  (Blocker 5)                        │
              │ Reliability layer under all of it   │
              └─────────────────────────────────────┘
```

---

## The methodology in one minute

1. **Look at the data.** Manually review 20–50 LLM outputs whenever anything changes. 30–60 min/day. No exceptions in the first month.
2. **Cluster failure modes.** Open-ended notes → categorized failure taxonomy. Each mode gets an ID, severity, frequency.
3. **Write evals that target each mode.** Deterministic checks first (regex, schema validity). LLM-as-judge only after dataset exists and judge has been calibrated.
4. **Calibrate the judge.** Measure Cohen's kappa between judge labels and your own labels on ≥ 30 examples. Don't ship a judge below κ = 0.70.
5. **Iterate prompts, measure deltas.** Every prompt change → re-run dev set → compare to baseline → annotate the experiment.
6. **Sample production for online evals.** Random sampling bit on every trace; weekly review of the sampled subset.

The full canonical reference is [hamel.dev/blog/posts/evals-faq/](https://hamel.dev/blog/posts/evals-faq/).

---

## Tooling

| Tool | Role | Cost |
|---|---|---|
| **PostHog LLM Analytics** | Online tracing + `$ai_generation` events + simple LLM-as-judge | Free (existing PostHog account) |
| **promptfoo** | Offline / CI evals from YAML, GitHub Actions integration | Free (OSS, MIT, OpenAI-owned) |
| **Langfuse** (Phase 7 stretch) | Self-hosted OTEL tracing + datasets | Free (self-host on a VPS) |
| **Custom thumbs UI + `eval_labels` table** | Passive label collection from daily use | $0 |

Skipped: LangSmith (LangChain lock-in), Braintrust paid tier (overkill).

---

## When to update each doc

| Doc | Update when |
|---|---|
| `trace_schema.md` | A new LLM component is added or a new field becomes useful |
| `baselines.md` | A new component ships, OR a baseline measurement is re-run after >30 days |
| `dataset_methodology.md` | Sampling strategy changes; PII handling rules change; new label source added |
| `success_criteria.md` | A target metric proves wrong (too strict → blocks valid releases; too loose → ships bugs). Document the change with rationale. |
| `structured_output_policy.md` | Schema evolution, retry policy changes, fallback model rotation |
| `failure_taxonomy_template.md` | New mode discovered (don't edit the template; add the mode to `evals/failure_modes/FM-XXX.md`) |

---

## Public-repo hygiene (you chose public visibility)

- **Sanitize before each push.** No real CV, no named recruiters, no live cookies/keys.
- The `eval_set.jsonl` should have a `redacted: true` flag on rows whose original contained PII.
- Add `evals/private/` to `.gitignore` for raw production traces you don't want public.
- Blog post template lives in `evals/experiments/_template.md` (created later, in Phase 3).

---

## Companion docs (created later as the project grows)

- `evals/skill_substitution_methodology.md` — provenance for skill substitution scores (closes Gap 14 from the audit; written in Phase 3)
- `evals/rubrics/cover_letter.md` — anchored 1–5 rubric for cover-letter quality (Phase 5)
- `evals/sampling_for_error_analysis.md` — the 50/25/25 sampling rule (Phase 3)
- `evals/judges/*.md` — one file per calibrated judge (Phase 4 onward)
- `evals/experiments/*.md` — one file per shipped prompt/model change with before/after metrics
- `evals/failure_modes/FM-*.md` — one file per documented failure mode

---

## Reading order for someone new to the repo

1. This README
2. `success_criteria.md` — "what does good even mean here?"
3. `baselines.md` — "what would a dumb solution score?"
4. `trace_schema.md` — "what data are we even capturing?"
5. `dataset_methodology.md` — "how do we know our numbers aren't lies?"
6. `failure_taxonomy_template.md` — "where do failures live?"
7. `structured_output_policy.md` — "what happens when the LLM returns garbage?"

That's ~45 minutes of reading. It saves months of confused metrics.
