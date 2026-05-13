# Dataset methodology (Blocker 3)

> How we collect, split, sample, and grow the labeled data that every eval depends on. If this doc is wrong, every metric in the project is wrong.

---

> ### 🟢 Beginner TL;DR
>
> You'll label ~100 jobs by thumbing them up/down with notes. Split them into 3 buckets:
> - **70 dev** — you can look at these while iterating prompts
> - **30 test** — you NEVER look at these while iterating; only run them at release decisions
> - **20 adversarial** — hand-crafted weird cases you keep forever
>
> Why split? Otherwise you'll subconsciously tune your prompt to ace the same examples you measure with. Your numbers go up; real-world performance doesn't.
>
> Concepts to learn: **Cohen's kappa** (agreement between two raters; better than raw % when one class is much more common — see `glossary.md`).
>
> Stats helpers ready-made in `lib_eval_stats_explained.md`. Don't reinvent.

---

## Why this exists

Without strict dataset hygiene, three failure modes are guaranteed:

1. **Overfitting to dev**: you iterate prompts against the same examples you measure on. Numbers go up; generalisation doesn't.
2. **Selection bias**: you only label thumbs-down outputs, so your dataset thinks the system is worse than it is.
3. **Non-stationarity blindness**: your evals don't represent today's traffic, but no one notices because there's no protocol for refreshing the set.

This doc closes all three.

---

## The three sets

| Set | Size target | Purpose | Visibility |
|---|---|---|---|
| **Dev set** | 70 examples (Phase 3), growing to 200 by Phase 6 | Iterate prompts; LLM-as-judge calibration; failure-mode discovery | **You see these.** Read freely while prompt-engineering. |
| **Test set** | 30 examples (Phase 3), growing to 60 by Phase 6 | Frozen, only touched at release decisions. Detects overfitting on dev. | **You do not look at these examples** when writing prompts. Run, record metric, move on. |
| **Adversarial / red-team set** | 20 examples (Phase 3), grows as you find new edge cases | Robustness check; intentionally tricky cases | Visible. Used pre-release. |

**Total starting target: 120 labels.** Achievable in ~2 weeks of daily use given Phase 3's thumbs-up/down UI.

---

## The "test set is frozen" rule

This is the single most-violated rule in personal ML projects. The rule:

> **You may only run the test set as a black box. You may not read its examples. You may not iterate any prompt against its scores. If you accidentally look at a test-set example, you must move it to dev and replace it with a fresh held-out example.**

Why this matters: if you look at 30 test failures and tune the prompt to fix them, you've leaked the test set into the prompt. Your "test score" is now a dev score. Generalisation collapses.

Enforcement mechanisms:
- The CLI tool that runs the eval set displays only the **aggregate metric**, not row-level outputs, when `--set=test`.
- `eval_set.jsonl` rows have a `set: "dev" | "test" | "adversarial"` field. The dashboard hides `set=test` row details by default.
- Reviewing test failures requires `--explicit-overfit-risk` flag and logs a warning to `evals/audit_log.md`.

---

## Sampling strategy for collecting examples

Random sampling alone biases toward your most common source (Remotive — clean postings) and under-samples the messy ones (LinkedIn posts — where the tool's edge lives).

### Stratified sampling protocol

For each component, label examples drawn proportionally from each source AND each known failure mode:

| Source | Dev examples | Test examples | Adversarial |
|---|---|---|---|
| Remotive | 12 | 5 | 2 |
| RemoteOK | 12 | 5 | 2 |
| Himalayas | 12 | 5 | 2 |
| WeWorkRemotely | 8 | 4 | 1 |
| HN Who's Hiring | 8 | 4 | 2 |
| Wellfound | 8 | 3 | 2 |
| LinkedIn Jobs | 6 | 2 | 4 (most edge cases live here) |
| LinkedIn Posts (hidden jobs) | 4 | 2 | 5 (most edge cases) |
| **Total** | **70** | **30** | **20** |

Manually crafted adversarial examples can violate proportions (they're chosen *because* they're hard, not representative).

---

## Adversarial examples — what to deliberately include

Twenty hand-crafted examples to stress the system. Examples to seed the set with:

| # | Description | Component stressed |
|---|---|---|
| ADV-001 | JD says "Remote (we're based in NYC but open to global)" — ambiguous | region_classifier |
| ADV-002 | JD says "Remote — must overlap 4 hours with Mountain Time" — soft regional | region_classifier |
| ADV-003 | JD lists "Cypress preferred, Playwright a plus" — substitution test | skill_matcher |
| ADV-004 | JD says "Senior Junior Developer" — title nonsense | jd_normalizer |
| ADV-005 | JD in mixed language (English + German) | jd_normalizer |
| ADV-006 | LinkedIn post with no job title in first paragraph | jd_normalizer |
| ADV-007 | Recruiter post about hiring but it's actually about their own job change | recruiter_classifier |
| ADV-008 | Salary listed as "competitive, equity-only" | salary extraction |
| ADV-009 | "Remote within EMEA but excluding sanctioned countries" | region_classifier |
| ADV-010 | JD says "USA-friendly hours" but body says nothing about US-only | region_classifier (negative test) |
| ADV-011–020 | Add as you discover real-world weird cases |

This set never shrinks. Cases never removed (they're a regression museum).

---

## How labels are collected

### Primary source: thumbs UI from daily use

Every LLM-rendered field in the `/jobs/[id]` page has a thumbs-up/down. On click:

1. Emits a `$ai_evaluation` event (see `trace_schema.md`).
2. Writes a row to the `eval_labels` table in Supabase:
   ```
   eval_labels(
     id, trace_id, component, input, llm_output,
     your_label, your_correction, your_notes,
     set_assignment,           -- null until promoted
     created_at
   )
   ```

### Promotion to dataset

Raw `eval_labels` rows are NOT the dataset. They're candidate examples. A weekly review session:

1. Open `/evals/inbox` page (rendered from `eval_labels WHERE set_assignment IS NULL`).
2. For each row, decide: dev / test / adversarial / discard / needs-more-context.
3. Set assignment is **random for dev/test** (~70/30) — never assign by content (assigning hard ones to test is leakage).
4. Update `set_assignment` field.
5. Commit hash of the prompt that produced the row is preserved (we never re-version the example, only annotations).

### When to discard

- Duplicate input
- The model output was actually correct and you mis-clicked
- The JD itself is garbage (test data poisoning)

Discards logged with reason. Never silently deleted.

---

## Self-agreement protocol (Blocker 3, part B)

Before trusting your own labels, measure how consistent **you** are.

### Protocol
1. Take 30 already-labeled examples from dev.
2. Wait ≥ 14 days.
3. Re-label them blind (use a UI that hides your original label).
4. Compute Cohen's kappa between t0 and t14 labels.

### Why
Hamel's "judge must agree with you ≥ 80% of the time" assumes you agree with yourself > that. If your self-agreement is κ = 0.78, asking the judge to hit κ = 0.80 is nearly free; if your self-agreement is κ = 0.95, then κ = 0.80 from a judge is mediocre.

### Expected ranges
- `region_classifier` (clear-cut binary): expect κ ≥ 0.90 with yourself
- `cover_letter_drafter` rubric: expect κ ≥ 0.70 (rubric scores are noisier)
- `skill_matcher` pairwise: expect κ ≥ 0.75

If self-agreement is lower than expected: **your rubric is underspecified, not the data**. Tighten the rubric anchors before re-running.

---

## Cohen's kappa, not raw agreement

Why kappa: if 90% of jobs are "EU-friendly," a judge that always says "yes" gets 90% raw agreement but adds zero information. Kappa adjusts for base-rate skew.

### Implementation
Use `scikit-learn`'s `cohen_kappa_score`. For pairwise comparisons (skill_matcher), use weighted kappa.

### Reporting target
- Raw agreement: secondary, for intuition
- Kappa: the headline metric reported everywhere
- Confidence interval: bootstrap with 1000 resamples, report 95% CI

---

## Confidence intervals on every metric

A 4% delta at N=50 is noise. Pre-registered rule:

| N | Detectable delta at p<0.05 (binary metric) |
|---|---|
| 30 | ~18% |
| 50 | ~14% |
| 100 | ~10% |
| 200 | ~7% |
| 400 | ~5% |

Implication: **growing the dataset to 200 is more valuable than running more experiments at N=50.** Plan growth deliberately.

Use Wilson interval for proportions; bootstrap for everything else. Show the CI in every reported metric.

---

## Dataset versioning

`eval_set.jsonl` is committed to the repo. Version it in two ways:

1. **Git history** for full audit.
2. **`dataset_version` field on each row** — semver-like (`v1.0`, `v1.1`, `v2.0`). Increment major when you add a new category; minor when you add examples.

Every eval result is logged against `dataset_version` so that comparisons remain meaningful when the set changes.

---

## PII handling for the public repo

You chose a public GitHub repo. Therefore:

| Field | Handling |
|---|---|
| `input_text` from LinkedIn posts | Run a redaction pass before commit: emails, phone numbers, full names of non-public-figure recruiters → `<redacted>` |
| Recruiter names / profile URLs | Never in `eval_set.jsonl`. Stored only in private `recruiters` table. |
| Your CV / cover-letter user profile | Never in the public repo. Stored as `evals/_private/user_profile.json` in `.gitignore`. |
| Your real cover-letter outputs | Sanitize company names → `<COMPANY>`, role titles → `<ROLE>`, before committing as gold examples. |

The redaction pass is a script: `scripts/redact_for_public.ts`. CI runs it pre-commit. Any unredacted email/phone fails the build.

---

## Growing the dataset over time

| Cadence | Action |
|---|---|
| Daily | Use the tool, thumb things, build the inbox |
| Weekly | Review inbox, assign to dev/test/adv, update `eval_set.jsonl` |
| Monthly | Compute self-agreement on a fresh 30-row sample; recalibrate judges if drifted |
| Quarterly | Re-measure baselines; check whether dataset is still representative of current production distribution |

Target growth curve: 120 labels by end of Phase 3, 200 by end of Phase 6, 400 by month 6.

---

## What "done" looks like for this doc

- [x] Methodology fully specified.
- [ ] `eval_set.jsonl` schema implemented in Phase 3.
- [ ] Inbox UI implemented in Phase 3.
- [ ] Self-agreement first measurement: end of Phase 4.
- [ ] Redaction script implemented before first public commit.
- [ ] Monthly recalibration calendar set in Phase 6.
