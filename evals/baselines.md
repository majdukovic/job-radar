# Baselines (Blocker 2)

> Before declaring any LLM component "good," we measure how a dumb solution scores on the same eval set. If the LLM doesn't meaningfully beat the baseline, it's not earning its cost or latency.

---

> ### 🟢 Beginner TL;DR
>
> Before using Claude to extract regions, try just using a regex. Like 10 lines of code. Then test BOTH on the same 100 jobs. If Claude only beats regex by 1 or 2 points, **don't use Claude** — save your money. If Claude beats by 8+ points, ship it.
>
> Why this matters: most beginner AI projects waste money calling an LLM for things `if/else` could do. Baselines prevent that.
>
> First baseline to write: the `smartBaseline` function in this doc's "region_classifier" section. ~15 lines of TypeScript. Should land before Phase 2.

---

## Why this exists

The most common bug in AI projects: a team ships an LLM-powered classifier that's actually worse than a 5-line regex. They never measured the regex because the LLM "felt smart." Pre-registered baselines stop this.

A baseline also gives you a **floor** for the eval — when your LLM regresses 8% on next month's data, the baseline tells you whether the regression is in your prompt or in the data itself shifting.

---

## Baseline philosophy

Each LLM component has **at least two baselines**:

1. **`zero_baseline`** — the dumbest possible solution (regex, exact-match, constant). The LLM must beat this comfortably or the LLM is not the right tool.
2. **`smart_baseline`** — a non-LLM but engineering-justified solution (e.g. spaCy NER, a small fine-tuned classifier, a curated keyword dictionary). The LLM is justified only if it beats this *and* the marginal quality justifies the cost.

If the LLM doesn't beat `smart_baseline` by ≥ 5 points on the primary metric, **the LLM is not worth shipping for that component**. Either improve the prompt, switch models, or use the baseline.

---

## Component-by-component

### 1. `region_classifier` (binary: is_actually_remote_for_me)

**Inputs:** raw JD text + user's `allowed_regions` config.
**Output:** `true` if the user can legally apply from Croatia/EU, else `false`.

| Baseline | Method | Expected on 100-job dev set |
|---|---|---|
| `zero_baseline` | "Always return true if JD contains the word 'remote'" | ~62% accuracy; the famous false-positive problem |
| `smart_baseline` | Substring blacklist: if JD contains any of `["US only", "USA only", "Americas only", "US-based", "United States residents", "must be located in the US", …]` → `false`; else if contains `["remote", "anywhere", "worldwide", "EU", "Europe", "EMEA"]` → `true`; else flag for manual review | ~82% accuracy expected, precision ~0.92, recall ~0.74 |
| **LLM target** | Haiku 4.5 with structured-output prompt | Must reach precision ≥ 0.95 and recall ≥ 0.90 (see `success_criteria.md`) |

**Measurement protocol:**
1. Run the baseline scripts on `dev_set.jsonl` (100 examples).
2. Compute confusion matrix vs human labels.
3. Record precision / recall / F1 in `baselines/region_classifier_baseline.json` with a timestamp.
4. Re-measure quarterly (data drift may shift the numbers).

**Code skeleton (`scripts/baselines/region_classifier.ts`):**
```ts
const US_ONLY_PATTERNS = [
  /\bUS only\b/i, /\bUSA only\b/i, /\bUnited States only\b/i,
  /\bmust (be|reside) (in|located) (the )?US/i,
  /\b(EST|PST|CST|MST) timezone only\b/i,
  /\bauthorized to work in the (US|United States)\b/i,
  // expand as you learn
];

const REMOTE_OK_PATTERNS = [
  /\bremote\b/i, /\banywhere\b/i, /\bworldwide\b/i,
  /\b(EU|EMEA|Europe)\b/i,
];

export function smartBaseline(jdText: string): boolean | "unknown" {
  if (US_ONLY_PATTERNS.some(p => p.test(jdText))) return false;
  if (REMOTE_OK_PATTERNS.some(p => p.test(jdText))) return true;
  return "unknown";
}
```

---

### 2. `jd_normalizer` — structured field extraction

This is the parent of `region_classifier` plus salary, seniority, skills, etc.

| Baseline | Method | Metric |
|---|---|---|
| `zero_baseline` | spaCy NER for organisation + location + money entities; everything else null | F1 ≈ 0.40 across fields |
| `smart_baseline` | Combination: spaCy NER + the `region_classifier` smart baseline + a hand-curated dictionary of 200 common QA/dev skills for `required_skills` | Per-field F1: title 0.85, salary 0.60, regions 0.80, skills 0.55 |
| **LLM target** | Haiku 4.5 structured-output | Per-field F1 ≥ 0.85 (skills), ≥ 0.90 (region, title); see success criteria |

**Per-field F1 is more useful than overall F1** — `salary` failure is mild, `region` failure is catastrophic.

---

### 3. `skill_matcher` — ranked job list

**Inputs:** user's skill list + a job's required + nice-to-have skills + substitution graph.
**Output:** numeric score 0–100 for ranking.

| Baseline | Method | Metric |
|---|---|---|
| `zero_baseline` | Exact case-insensitive intersection: `len(user_skills ∩ required_skills) / len(required_skills)` | Pairwise top-3 agreement with user judgment ~58% (over-rejects) |
| `smart_baseline` | Above, plus substitution graph credit (Cypress→Playwright = 0.7), no LLM | Pairwise agreement ~72% |
| **LLM target** | Haiku rerank top-20 from smart_baseline | Pairwise agreement ≥ 75% |

**Note:** the LLM may NOT win here. Skill matching is mostly a lookup problem. The smart baseline + substitution graph might already be production-quality. If so, **don't run the LLM**, save the cost.

**Measurement:** present 30 pairs of jobs (A, B) to yourself, pick the better fit. Run both baselines and the LLM; whichever has the highest pairwise agreement with your picks wins.

---

### 4. `cover_letter_drafter` — open-ended generation

| Baseline | Method | Metric |
|---|---|---|
| `zero_baseline` | Static template with `{company}` / `{role}` / `{user_top_skill}` slots | Rubric mean ~2.4/5 (specificity dies) |
| `smart_baseline` | Template + 3 bullet-point inserts from JD (extracted by `jd_normalizer.required_skills` ∩ `user.skills`) | Rubric mean ~3.0/5 |
| **LLM target** | Haiku-drafted, prompt includes user voice profile | Rubric mean ≥ 3.5/5, hallucination rate ≤ 2% |

The rubric lives in `evals/rubrics/cover_letter.md` (authored in Phase 5). For the baseline measurement, use a 5-letter sample and rate it yourself manually.

---

### 5. `recruiter_specialty_classifier` — binary (is this person a niche QA recruiter?)

| Baseline | Method | Metric |
|---|---|---|
| `zero_baseline` | Title contains "Recruiter" OR "Talent" | Precision ~0.55 (lots of false positives — generalist recruiters) |
| `smart_baseline` | Title check + post text contains ≥1 of `["QA", "tester", "automation", "mobile", "Appium", "Cypress", "Playwright"]` in last 5 posts | Precision ~0.78 |
| **LLM target** | Haiku reads last 5 posts + profile bio | Precision ≥ 0.80 |

The LLM marginal value here is small. If `smart_baseline` already hits 0.78, **a 0.02 gain may not justify the LLM cost** — flag this for re-evaluation after Phase 4.

---

### 6. `recruiter_outreach_drafter` — open-ended generation

Same shape as cover letter. Skip detailed baseline until Phase 4 ships.

---

## How to run baselines

```
scripts/
  baselines/
    region_classifier.ts       # smart_baseline implementation
    jd_normalizer_zero.ts      # spaCy NER pipeline
    skill_matcher_exact.ts     # zero_baseline
    skill_matcher_subst.ts     # smart_baseline with substitution
    cover_letter_template.ts   # zero + smart
  measure_baseline.ts          # entry point
```

```
npm run baseline -- --component region_classifier --dataset dev_set.jsonl
```

Writes `baselines/<component>_<timestamp>.json` with the full confusion matrix + sample of 5 incorrect rows for inspection.

---

## When to re-measure

| Trigger | Action |
|---|---|
| New eval dataset version | Re-run all baselines, write new `baselines/<component>_<version>.json` |
| Data drift suspicion (a class becomes 2x more common) | Re-run that component's baseline |
| 30 days since last measurement | Re-run on a cron, just to spot drift |
| LLM regression | Re-run baseline; if baseline also dropped, problem is in the data, not the prompt |

---

## Public-repo presentation

For the portfolio angle, each baseline measurement gets a 2-sentence writeup in `baselines/`:

```
### region_classifier — baseline measurement, 2026-05-13
Method: substring-based smart_baseline against 100 dev-set examples.
Result: precision 0.92, recall 0.74, F1 0.82. LLM target: precision ≥ 0.95, recall ≥ 0.90.
Notes: smart_baseline catches obvious US-only postings but misses 26% where "United States residents" appears in a benefits paragraph.
```

This is the kind of artifact that reads beautifully on a hiring-manager screen.

---

## Status / next steps

- [x] Baseline methodology defined.
- [ ] Implement smart_baseline for region_classifier (Phase 1 prerequisite — measure before LLM ships).
- [ ] Implement spaCy zero_baseline for jd_normalizer (Phase 2).
- [ ] Implement skill_matcher exact + substitution (Phase 3).
- [ ] First baseline measurements logged before any LLM declared "ready."
