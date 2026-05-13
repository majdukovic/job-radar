# Success criteria (Blocker 4)

> Pre-registered metrics, thresholds, and release gates per LLM component. Authored before code so the goalposts can't move subconsciously.

---

> ### 🟢 Beginner TL;DR — what "good" looks like, in plain English
>
> Before you start, write down what counts as "good enough to ship." If you don't, you'll move the goalpost subconsciously every time you fail a test.
>
> Use these starter targets (skip the statistical bits below until you've shipped something):
>
> | Component | Easy-mode target | Don't ship if |
> |---|---|---|
> | region classifier | 19/20 right on dev set | < 17/20 |
> | normalizer required_skills | "Mostly right" on 15/20 examples | < 12/20 |
> | cover letter | 4/5 letters feel good when you read them | < 3/5 |
> | schema validity | "JSON parses 99/100 calls" | < 96/100 |
>
> When you're more comfortable, upgrade those rough targets to the precision/recall/F1 numbers in the table below. The methodology is the same; just more rigorous wording.
>
> **Beginner-honest project timeline**:
> - Quickstart + Phase 1: 1 evening if Next.js is familiar, 3 evenings if it's not
> - Phase 2: 1 evening
> - Phase 3 (first labeled dataset + first promptfoo): 1 weekend
> - Phase 4 (first judge): 1 weekend
> - Phase 5–6: ~2 weekends total
>
> Total: 5–8 weekends to portfolio-grade v0.6. That's normal — most of the time is learning, not typing.

---

## Why this exists

Without pre-registered thresholds, two failure modes are guaranteed:

1. **Goalpost drift**: after a week of prompt-engineering, you redefine "good" downward to match what you've shipped. Numbers feel acceptable; nothing actually is.
2. **Cannot stop**: with no target, prompt engineering becomes infinite. You optimise forever for no measurable gain.

Hamel calls this the "what does good look like?" step. It's the most-skipped step in personal AI projects and the single biggest separator between hobby work and portfolio-grade work.

---

## How to read this doc

Each component has:

- **Primary metric** — the one number that determines ship/no-ship
- **Secondary metrics** — additional safeguards
- **Pre-registered threshold** — the value at which the component is "shippable"
- **CI gate** — when the build should fail (usually stricter than ship threshold to leave headroom)
- **Severity weight** — how much this component matters relative to others (used in overall release scoring)
- **Rationale** — why this metric, why this number

---

## Component 1: `region_classifier`

**What it does:** Binary classification per job — can the user (Croatia/EU resident) realistically apply?

| Metric | Type | Target | CI gate |
|---|---|---|---|
| **Precision** (primary) | proportion | ≥ 0.95 | Block if < 0.92 |
| Recall | proportion | ≥ 0.90 | Block if < 0.85 |
| F1 | derived | ≥ 0.92 | — |
| Schema validity | proportion | ≥ 0.995 | Block if < 0.99 |
| Cohen's kappa vs human | kappa | ≥ 0.80 | Block if < 0.70 |

**Severity weight:** 1.0 (highest — this is the differentiator vs Teal/Sonara)

**Rationale:**
- Precision over recall: showing 100 fake-remote jobs wastes user time and trust; missing some real ones is recoverable (we'll find them next run).
- 0.95 precision = at most 5% false positives on a typical 30-job daily digest = at most 1.5 wasted opens per day.
- κ ≥ 0.80 vs human: this is the standard Hamel/Shreya threshold for "judge can be trusted."

**How to measure:**
1. Run prompt on `dev_set` (70 examples).
2. Compute confusion matrix vs ground-truth labels.
3. Wilson 95% confidence interval on precision; lower bound must be ≥ 0.92 for ship.

**What "ship" looks like:**
> `region_classifier_v3.md`, sha:a3f2b9c — precision 0.96 [0.92–0.98], recall 0.91 [0.85–0.95], κ 0.83 on dev_set v1.2. Cleared for ship 2026-06-12.

---

## Component 2: `jd_normalizer` — per-field extraction

This is the parent component; it has multiple sub-fields each with their own target.

| Field | Metric | Target | CI gate | Severity |
|---|---|---|---|---|
| `title` | exact match | ≥ 0.92 | Block < 0.88 | 0.3 |
| `company` | exact match | ≥ 0.90 | Block < 0.85 | 0.3 |
| `seniority` | category-F1 | ≥ 0.85 | Block < 0.80 | 0.4 |
| `salary_min/max` | within ±10% when present, null when absent | ≥ 0.80 | Block < 0.70 | 0.4 |
| `required_skills` | F1 per skill bag | ≥ 0.80 | Block < 0.75 | 0.7 |
| `nice_to_have_skills` | F1 per skill bag | ≥ 0.70 | Block < 0.60 | 0.4 |
| `visa_sponsorship` | binary precision | ≥ 0.95 (when value present) | Block < 0.90 | 0.5 |
| `timezone_constraints` | string-similarity ≥ 0.8 | ≥ 0.75 | Block < 0.65 | 0.3 |
| **Overall schema validity** | proportion of valid-JSON returns | ≥ 0.995 | Block < 0.99 | 1.0 |

**Severity weight (component overall):** 0.9

**Rationale:** Salary and seniority being slightly off is annoying; missing required_skills is catastrophic (kills skill_matcher downstream). Schema validity is the production reliability floor.

**Sampling for evaluation:** stratified by source per `dataset_methodology.md`.

---

## Component 3: `skill_matcher`

**What it does:** Score a job 0–100 for how well user's skills match required + nice-to-have, with substitution credit.

| Metric | Target | CI gate |
|---|---|---|
| **Pairwise agreement** (primary) | ≥ 0.75 | Block < 0.70 |
| Top-3 jaccard with your top-3 picks | ≥ 0.60 | Block < 0.50 |
| Spearman ρ between LLM ranking and your ranking | ≥ 0.65 | Block < 0.55 |

**Severity weight:** 0.7

**Rationale:**
- Pairwise: present 30 (job_A, job_B) pairs to yourself; pick which is the better fit; check agreement with the LLM's score-based ordering. This is the metric most resistant to score-scale drift.
- Pairwise agreement is *not* kappa — it's the proportion of times the LLM's higher-scored job matches your choice.
- Top-3 jaccard checks that the model gets the headlines right, even if mid-rank is fuzzy.

**Open question** (decide in Phase 3): does the smart_baseline (substitution graph, no LLM) already hit ≥ 0.75? If yes, **don't ship the LLM** — save the cost.

---

## Component 4: `cover_letter_drafter`

**What it does:** Open-ended generation. Hardest to evaluate.

| Metric | Target | CI gate |
|---|---|---|
| **Mean rubric score** (5-criterion, 1–5) | ≥ 3.5/5 | Block < 3.2 |
| Hallucination rate (judge-flagged) | ≤ 2% | Block > 5% |
| Length within 200–500 words | ≥ 95% | Block < 90% |
| AI-tell phrases (judge-flagged) | ≤ 10% | Block > 20% |
| Pairwise win-rate vs `smart_baseline` template | ≥ 0.70 | Block < 0.60 |

**Severity weight:** 0.6

**Rationale:** Hallucinating fake user experience is unforgivable; everything else is taste. AI-tells ("As an AI assistant..." or generic phrases like "I am passionate about...") get cover letters thrown out by recruiters.

**The rubric** lives in `evals/rubrics/cover_letter.md` (Phase 5). Five anchored 1–5 criteria:
- Specificity to JD
- Voice match (vs user's writing samples)
- No hallucinated experience
- Length-appropriate
- No AI-tells

**Judge specifics:** Cross-family — if the generator is Claude, the judge is GPT-4o-mini or vice versa. Position-randomized in pairwise. Length-aware rubric (otherwise verbosity bias inflates scores).

---

## Component 5: `recruiter_specialty_classifier`

**What it does:** Decide if a LinkedIn user is a niche QA/mobile recruiter worth contacting.

| Metric | Target | CI gate |
|---|---|---|
| **Precision** | ≥ 0.80 | Block < 0.70 |
| Recall | ≥ 0.70 | Block < 0.60 |
| Top-10 ranking by `specialty_score` agreement with your manual top-10 | ≥ 0.60 jaccard | Block < 0.50 |

**Severity weight:** 0.5

**Rationale:** This pipeline drives outbound DMs. Precision > recall: DM-ing a generalist recruiter is awkward; missing a niche one is recoverable.

**Open question** (decide in Phase 4): does the smart_baseline (title regex + keyword in last 5 posts) hit precision 0.78? If the LLM doesn't beat by ≥ 0.05, **don't ship the LLM** for this component.

---

## Component 6: `recruiter_outreach_drafter`

Same shape as `cover_letter_drafter`. Targets specified in Phase 4 after rubric is authored.

---

## Overall release scoring

Each component contributes a normalized score in [0, 1] (1 = exactly at target, 0 = at CI-gate floor, linear scale). The release score is the **severity-weighted average**:

```
release_score = Σ (component_score × severity_weight) / Σ severity_weight
```

**Ship thresholds:**
- `release_score ≥ 0.85` → green, ship
- `0.75 ≤ release_score < 0.85` → yellow, ship with monitoring (alert if production deltas appear)
- `release_score < 0.75` → red, do not ship

The CI gate is **per-component**, not on the overall score. Any single component below its CI gate blocks the release even if overall score is green. This prevents "average across known regressions."

---

## Statistical-significance discipline

A delta is **not significant** until it clears these bars:

| Eval set size | Min detectable delta (binary proportions) |
|---|---|
| N = 30 | 18% |
| N = 50 | 14% |
| N = 70 (dev_set v1.0) | 12% |
| N = 100 | 10% |
| N = 200 | 7% |
| N = 400 | 5% |

In English: at the starting dev_set size of 70, a 5% improvement is **noise**. Don't celebrate it. Don't ship for it. Wait for the dataset to grow OR run a larger ad-hoc eval.

Confidence intervals reported on every metric in the dashboard via Wilson interval for proportions, bootstrap for everything else.

---

## Multiple-testing discipline

If you check 6 components per release at p < 0.05, the probability that **at least one** appears to regress by chance is ~26%. To control family-wise error:

- **Bonferroni**: divide α by N (6 → use p < 0.0083 per test) — conservative
- **Holm-Bonferroni**: sort p-values; require p < α/k for rank k — less conservative, recommended

The CI script applies Holm-Bonferroni automatically. Reports `family-wise significant: true/false` next to each per-component result.

---

## How thresholds evolve

Pre-registered thresholds are **the starting contract**, not eternal truth. To change one:

1. Document the rationale in `evals/threshold_changes.md` with date + reason.
2. The change applies to FUTURE releases only. Historical pass/fail labels are not rewritten.
3. Loosening a threshold requires a corresponding tightening elsewhere or a written justification. Otherwise the contract degrades silently.

Acceptable reasons to change:
- "Production data shows threshold X is too strict; we shipped 4 in a row at 0.93 and users were happy."
- "Failure mode FM-007 is more severe than originally weighted; bump component's severity from 0.5 to 0.7."

Unacceptable reasons:
- "Couldn't hit it; lowering."

---

## Public-repo presentation

Each successful release writes a row to `evals/releases.md`:

```
## v0.5.2 — 2026-07-09 (green)
Overall score: 0.89

Components:
- region_classifier: precision 0.96 [0.92–0.98] ✓
- jd_normalizer: per-field summary [link]
- skill_matcher: pairwise 0.78 [0.72–0.83] ✓
- cover_letter_drafter: rubric 3.7/5 ✓
- recruiter_specialty: not in release

Notable: shipped jd_normalizer v3 (sha:a3f2b9c). region recall up from 0.88 → 0.91, no regressions elsewhere.
```

That row is the artifact recruiters at AI labs will skim when looking at your repo.

---

## Status / next steps

- [x] All thresholds pre-registered.
- [ ] Implement the Wilson-CI + Holm-Bonferroni helpers in `scripts/eval_stats.ts` (Phase 3).
- [ ] First measured release-scoring run at end of Phase 3.
- [ ] Threshold review at month 3 to check if any have proven wrong.
