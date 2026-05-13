# Dry-run case study: 15 days of job-radar

> A day-by-day narrative of how the Hamel Husain + Shreya Shankar methodology gets applied to job-radar in practice. The protagonist is Mate — Croatian mobile QA engineer applying for remote roles. Skills: Appium, Cypress, Java, mobile QA. The story starts the day Phase 1 ships.

This is the doc that turns abstract methodology into a concrete loop you can feel.

---

## Cast and setup

- **Mate** — you. Mobile QA engineer in Zagreb. Looking for remote mobile QA roles within EMEA/Worldwide.
- **job-radar** — Phase 1 just shipped. Free-API pollers running. `jd_normalizer` v1 in production. `$ai_generation` flowing to PostHog. No evals yet.
- **Skills profile**:
  ```json
  {
    "skills": [
      { "name": "Appium",    "proficiency": 5 },
      { "name": "Cypress",   "proficiency": 4 },
      { "name": "Java",      "proficiency": 4 },
      { "name": "mobile QA", "proficiency": 5 },
      { "name": "JUnit",     "proficiency": 4 },
      { "name": "TestNG",    "proficiency": 3 }
    ],
    "allowed_regions": ["Worldwide", "EU", "EMEA", "Croatia"]
  }
  ```

---

## Day 1 — Monday

**Phase 1 ships.** The pollers fired overnight; this morning the `/jobs` page shows 38 jobs from Remotive, RemoteOK, Himalayas, WeWorkRemotely. The first 5 look reasonable.

Mate spends 10 minutes scrolling. Three jobs catch his eye; he opens them on the source site to apply. One requires US authorization (despite "Remote" tag) — annoying. He thumbs-down it in the UI, adds a note: "Says remote but body says US only."

He doesn't open the eval inbox. He doesn't write a judge. He doesn't read documentation. **He's just using the tool.** That's correct. The data must come from real use first.

---

## Day 2 — Tuesday

Another 27 jobs overnight. Six look interesting; two get thumbs-down.

Mate notices the salary on one job is shown as "$60,000" but the source page says "€60,000." He thumbs-down with note: "Currency wrong: € parsed as $."

By end of day: 65 jobs ingested, 5 thumbs-downs total.

---

## Day 3–5 — Wed, Thu, Fri

Three more days of passive use. Each day ~25 new jobs, ~5 thumbs-downs.

By Friday end: **128 jobs ingested, 18 thumbs-downs. ~14% bad rate.** Mate feels "the tool works but it's missing nuances."

He does NOT yet:
- Open the failure taxonomy
- Write a judge
- Iterate on prompts

He DOES:
- Glance at the PostHog LLM-health dashboard each morning (30 seconds)
- Note: `schema_valid` rate is 99.2% — fine.
- Note: average `confidence_score` is 0.84 — looks healthy on the surface.

---

## Day 6 — Saturday

**Hamel quote in his head:** *"30 minutes manually reviewing 20-50 LLM outputs whenever you make significant changes."*

It's been a week. No significant changes (prompt hasn't been touched) but a week of data accumulated. Time for the first error-analysis session.

Mate blocks 90 minutes Saturday morning. Coffee. Phone in another room.

He opens `/evals/inbox`. 18 thumbs-downs. He decides to look at 30 traces total — all 18 thumbs-downs plus 12 random non-thumbed jobs (avoiding selection bias per `interpreting_first_50_traces.md`).

He works through the 30 traces with the 20-item checklist next to him. Open-coded notes. Not categorizing yet.

His scratch notes (representative sample):

```
01HXM…01  Said US-only but JD says "Remote, Europe-based candidates preferred"
01HXM…02  Currency: € parsed as $ on row about Berlin startup
01HXM…03  Skills: "mobile automation" as separate skill from "Appium". Both in same JD.
01HXM…04  Confidence 0.92 — output was wrong though
01HXM…05  Said "EMEA" but excluded_regions: ["EU"] — self-contradiction
01HXM…06  Listed "JavaScript" as required, JD said "TypeScript preferred" — JS synonym?
01HXM…07  Looks fine
01HXM…08  Skills list missing "Espresso" — was in "experience with" sentence
01HXM…09  Title "Senior QA Engineer (Mobile)" → just "Senior QA Engineer". Mobile lost.
01HXM…10  Looks fine
01HXM…11  Salary "$80k-$120k" parsed as min=80000 max=80000. Range collapse.
01HXM…12  Title says "Mid-level / Senior" → seniority parsed as "mid". Lost "Senior" option.
01HXM…13  Said US-only — JD says "anywhere"
01HXM…14  Looks fine
01HXM…15  Skills: "iOS" and "Android" parsed but not "mobile QA" umbrella
01HXM…16  Salary in £ (UK role) parsed as $
01HXM…17  Looks fine
01HXM…18  "Remote — must overlap PST" → is_actually_remote=true. (Wrong — needs to handle timezone)
01HXM…19  Skill "Cypress" listed in nice_to_have but JD has it as required. Wrong section.
01HXM…20  Looks fine
01HXM…21  Said US-only — JD says "remote, no location restrictions"
01HXM…22  Skill list missing Java entirely — was buried in "tech stack" paragraph
01HXM…23  Looks fine
01HXM…24  Confidence 0.95 — output mostly right but missed visa_sponsorship clause
01HXM…25  Currency wrong again (£ → $)
01HXM…26  "Worldwide" parsed as allowed_regions: ["Worldwide", "US"] — what?
01HXM…27  Looks fine
01HXM…28  Skill "Maestro" extracted as "Mestro" — typo
01HXM…29  Looks fine
01HXM…30  Said EU-friendly when JD said "must reside in Germany only"
```

90 minutes. 12 of 30 had real issues. He's tired but energized — there's clearly stuff to fix.

He saves the scratch notes as `evals/scratch/2026-05-23.md`. **Doesn't categorize today.** That's tomorrow.

---

## Day 7 — Sunday

Re-reads the scratch notes after coffee. Now he looks for patterns.

Pass 1 — highlight repeats. Pass 2 — name clusters:

| Cluster name | Notes matching | Severity |
|---|---|---|
| Region misclassification: "Europe-based" / "Worldwide" tagged US-only | 01, 13, 21, 30 | 3 (catastrophic) |
| Currency: €/£ stripped to $ | 02, 16, 25 | 3 (catastrophic for filtering by salary) |
| Skill over-decomposition: umbrella terms split | 03, 15 | 2 |
| Confidence uncorrelated with correctness | 04, 24 | 2 |
| Self-contradicting regions (EMEA + excluded EU) | 05, 26 | 2 |
| Skill section misattribution (required vs nice-to-have) | 19 | 2 |
| Title truncation: "(Mobile)" / qualifier lost | 09, 12 | 1 |
| Skills hidden in prose, not extracted | 08, 22 | 2 |
| Salary range collapse | 11 | 2 |
| Timezone-as-region missed | 18 | 3 |

Ten failure modes from 30 notes. He picks the three highest priority (severity × frequency) and writes proper FM files:

- `FM-001-region-europe-misclassified-as-us-only.md` — sev 3, freq 4/30 → score 12
- `FM-002-currency-symbol-stripped.md` — sev 3, freq 3/30 → score 9
- `FM-007-timezone-as-region.md` — sev 3, freq 1/30 → score 3

Other 7 modes get one-line entries in `evals/failure_modes/_watchlist.md` for later.

He spends 30 more minutes documenting. Sunday afternoon: **failure taxonomy v1 done. 3 prioritized modes. 7 watchlist.**

---

## Day 8 — Monday (Day 8 of project)

Phase 2 build day. Mate adds HN Who's Hiring + Wellfound + LinkedIn Jobs pollers. ~150 more jobs accumulate over the day. He doesn't touch the eval system; he's coding.

End of day: 280 jobs total. 22 new thumbs-downs (some on the new sources, which surface different failure patterns — LinkedIn Jobs has noisier descriptions).

---

## Day 9 — Tuesday

**First prompt fix attempt.** Hamel's principle: highest leverage first. FM-001 is the top mode.

Hypothesis: the model has US-centric training bias on phrases like "Europe-based" — interprets them as "company is in Europe; therefore US-restricted" instead of "candidates must be in Europe."

**Attempt 1**: add 2 few-shot examples to `prompts/jd_normalizer/v1.md`:

```
Example: "Remote — Europe-based candidates preferred"
→ allowed_regions: ["EU", "Europe"], is_actually_remote: true

Example: "Remote within EMEA timezones"
→ allowed_regions: ["EMEA"], is_actually_remote: true, timezone_constraints: "EMEA"
```

Commits as v2 (sha changes). Runs promptfoo against his ad-hoc test of 10 hand-picked European JDs from the scratch notes.

Result: FM-001 frequency 4/10 → 3/10. **Disappointing.** Adding examples helped a bit but didn't fix the systematic bias.

Mate's insight (the kind that comes from looking at the data): the model isn't just missing examples — it's making structural assumptions about what "Remote + [location]" means. Examples nudge the surface but don't change the underlying structure.

He decides to try the bigger fix: **switch to Anthropic tool-use mode with a hard-enum for `allowed_regions`**.

He spends an evening reading the structured-output policy doc and the prompt-engineering-primer doc. Refactors `jd_normalizer` to use tool-use with a forced enum:

```json
"allowed_regions": {
  "type": "array",
  "items": { "enum": ["Worldwide","EU","EMEA","US","LATAM","APAC","UK","Other"] }
}
```

Commits as v3.

---

## Day 10 — Wednesday

Re-runs v3 against the same 10 ad-hoc European JDs.

Result: FM-001 frequency 4/10 → **1/10**. 

The enum forces the model to choose from a list that doesn't include "US-only as default" — so it can't silently fall back to "US."

He notes this in the v3 changelog: *"Switched to tool-use with allowed_regions enum. Fixed FM-001 systematic bias by removing the model's freedom to fall back to US-style strings."*

But: this was an **ad-hoc 10-row test, not the dev set.** N=10 is way too small to ship on. He needs a real eval set.

---

## Day 11 — Thursday

**Phase 3 starts: build the labeled-dataset infrastructure.**

He:
- Ships the thumbs-down UI improvements (adds the "edit corrected output" modal)
- Implements `eval_labels` table writes from the UI
- Implements the `/evals/inbox` review page
- Sits down for an hour and labels 70 of the now ~280 jobs

70 labels — but applied to which set? Per `dataset_methodology.md`: stratified across sources.

- Remotive: 12 dev, 5 test, 2 adversarial
- RemoteOK: 12 dev, 5 test, 2 adversarial
- Himalayas: 12 dev, 5 test, 2 adversarial
- WWR: 8 dev, 4 test
- HN: 8 dev, 4 test, 2 adversarial
- Wellfound: 8 dev, 3 test, 2 adversarial
- LinkedIn Jobs: 6 dev, 2 test, 4 adversarial (LinkedIn data is messy → adversarial)

Total: 66 dev, 28 test, 14 adversarial. He'll grow this to 70/30/20 over the next week as more sources come in.

**Test set rule applied**: the inbox UI marks test-set rows as locked. He can't open them after assignment without flagging an override.

---

## Day 12 — Friday

**First proper eval run.**

He runs `pnpm exec promptfoo eval` against the dev set (66 examples) with v1, v2, v3 in parallel.

Output:

```
component        metric                    v1 (orig)   v2 (examples)   v3 (tool-use)
─────────────────────────────────────────────────────────────────────────────────────
region_clf       precision                  0.74        0.79             0.93
region_clf       recall                     0.71        0.76             0.88
region_clf       F1                         0.72        0.77             0.90

normalizer       title exact-match          0.86        0.86             0.88
normalizer       required_skills F1         0.62        0.63             0.65
normalizer       schema_valid               0.97        0.97             1.00
```

(95% Wilson intervals omitted for readability; CI script computes them.)

He runs Holm-Bonferroni:
- region_clf F1: p = 0.001 → significant ✓
- title: p = 0.7 → not significant
- required_skills F1: p = 0.4 → not significant
- schema_valid: p = 0.2 → not significant

**Verdict:** v3 ships. Region classifier went from F1 0.72 to 0.90. No regressions elsewhere.

He writes `evals/experiments/E-001-jd_normalizer-v3.md`:

```markdown
# E-001 — jd_normalizer v3 (tool-use mode for region enum)

## Hypothesis
Region misclassification (FM-001) is a structural model bias, not an example coverage problem.
Constraining the output via enum should force the model out of US-default behavior.

## Method
- Switched from free-text JSON to Anthropic tool-use mode
- Added enum constraint on allowed_regions: ["Worldwide","EU","EMEA","US","LATAM","APAC","UK","Other"]
- Same dev set as v2 (N=66, stratified across 7 sources)

## Results
- region_classifier F1: 0.72 → 0.90 (Holm-Bonferroni p=0.001, significant) ✓
- normalizer schema_valid: 0.97 → 1.00 (tool-use enforces structure) ✓
- No significant regressions on other fields

## FM impact
- FM-001 frequency: 4/30 → 0/66 on dev set
- Status: open → mitigated
- Added regression test (adversarial example ADV-009)

## Shipped: sha:b1d4e72, 2026-05-30
```

He pushes to the public repo. The experiment file becomes the first portfolio artifact.

---

## Day 13 — Saturday

**Write the first judge.**

Now that v3 is shipped, he wants to monitor region_classifier in production without re-labeling every output by hand. Time for an LLM-as-judge.

He follows `judges/example_region_judge.md`:

1. Copies the example judge prompt
2. Configures GPT-4o-mini as judge (cross-family — generator is Claude)
3. Runs calibration script on a 30-row sample from labeled dev set

Output:

```
Judge calibration on N=30:
  raw agreement: 0.73
  Cohen's κ:      0.62 [0.45-0.78]

Verdict: ❌ judge needs work
```

κ = 0.62 — below the 0.80 threshold. He looks at the 8 disagreements:

- 3 cases: judge said "incorrect" when Mate said "correct." Examining: judge is being more strict on ambiguous JDs.
- 2 cases: judge said "correct" when Mate said "incorrect." Judge missed phrases.
- 3 cases: real disagreements where on re-reading even Mate isn't sure (ambiguous JDs that should probably be marked ambiguous on both sides)

The 3 ambiguous cases get moved out of the calibration set and into a new `evals/dev_set_ambiguous.jsonl` — these are JDs where the right answer is "we genuinely cannot tell." Cleaning the dataset.

The 5 real disagreements: he tightens the judge prompt:
- Adds a "give the candidate the benefit of the doubt on ambiguous regions" rule
- Adds 2 counter-examples (the cases the judge missed)
- Caps `reasoning` to 150 chars (down from 200 — pushing for terseness)

Saves as `prompts/judges/region_judge_v2.md`.

Re-calibrates on the cleaned N=27:

```
Judge calibration on N=27:
  raw agreement: 0.93
  Cohen's κ:      0.83 [0.68-0.93]

Verdict: ✅ judge approved
```

κ = 0.83. Within target. He commits the judge.

---

## Day 14 — Sunday

**Wire the judge to PostHog.**

He enables an LLM-judge evaluator in PostHog at 25% sample rate. The judge starts running on production traces. He spends Sunday afternoon updating his `evals/judges/region_judge_v2.md` doc to be a polished portfolio artifact — full calibration writeup, disagreement diagnosis, the move-ambiguous-out-of-cal-set decision.

That writeup turns into blog post #1:

> **"Calibrating my first LLM-as-judge: κ 0.62 → 0.83 in three changes"**
>
> by Mate · 6 min read
>
> I just wrote my first LLM-as-judge for job-radar, my personal AI job-search aggregator.
> The judge evaluates whether my region classifier got the answer right. Out of the gate,
> the judge agreed with my human labels at Cohen's κ = 0.62 — well below the 0.80 threshold
> Hamel Husain and Shreya Shankar recommend. Here's what I changed to get it to 0.83, and
> what I learned about my own labels along the way.
> [...]

Posted to his blog. Shared on X with a screenshot of the calibration output. **First public AI-evals-engineer artifact in the wild.**

---

## Day 15 — Monday

**Stepping back: what just happened in 2 weeks?**

The numbers:
- 8 days of passive use → 280 jobs ingested, 40 thumbs-downs
- 1 error-analysis session → 10 failure modes discovered, 3 prioritized
- 2 prompt iterations → v1 → v2 (small) → v3 (big, shipped)
- region_classifier F1: 0.74 → 0.93 (within 2 weeks of starting)
- First labeled dataset: 66 dev + 28 test + 14 adversarial
- First calibrated judge: κ = 0.83, cross-family, bias-mitigated
- First experiment writeup published
- First public blog post published

The pattern that emerged:
1. **Use the tool first.** Don't build evals before you have real data.
2. **Look at the data on a calendar cadence.** First session = 30 traces. Find clusters.
3. **Pick one mode. Fix it. Measure it. Ship it.** Not 5 modes in parallel.
4. **Build the eval infrastructure after the data demands it.** Not as scaffolding before the data exists.
5. **Each loop produces 1 portfolio artifact.** Experiment writeup or blog post.

This is the Hamel-and-Shreya methodology in motion. **Looking at data → clustering → hypothesis → fix → measure → ship → write up.** The loop, not the framework, is what makes you an AI Evals Engineer.

---

## What Mate didn't do (and you shouldn't either)

❌ Build a fancy eval framework before knowing what to evaluate
❌ Write 10 prompts before measuring any of them
❌ Run a judge before calibrating it
❌ Use raw agreement instead of kappa
❌ Iterate against test set (he didn't — he kept it frozen, the script enforces this)
❌ Auto-apply or auto-DM (Sonara-class tools — he resists the temptation)
❌ Try to make the model handle every failure simultaneously
❌ Spend a weekend on the LinkedIn poller before the eval system existed

---

## What Mate DID do that's worth copying

✓ Used the tool daily before building evals
✓ Wrote scratch notes during error analysis, didn't categorize until next day
✓ Picked one mode and fixed it with one change before moving to the next
✓ Calibrated the judge against his own labels before trusting it
✓ Cleaned the dataset when he found genuinely ambiguous examples (moved them out)
✓ Wrote up every experiment with before/after numbers and statistical-significance check
✓ Published a portfolio artifact within 2 weeks of starting

---

## The next 4 weeks (sketch)

| Week | Focus | New failure modes addressed | New eval artifacts |
|---|---|---|---|
| 3 | FM-002 (currency stripping) — likely fix is regex pre-extraction | currency-clf precision | 2nd experiment writeup |
| 4 | Skill over-decomposition (FM-003 from the watchlist) | required_skills F1 | Updated judge for skill matching |
| 5 | Cover-letter drafter (Phase 5 starts) | Cover-letter rubric scores | Cover-letter rubric doc + first 10 hand-written gold letters |
| 6 | Cover-letter rubric judge | Cover-letter quality monitoring | Blog post #2: "Rubric-based judges for open-ended generation" |
| 7 | Recruiter discovery pipeline (Phase 4) | recruiter_specialty_clf | First recruiter DM template |
| 8 | Eval cost optimization | Sampling rate tuning | Blog post #3: "How I cut my eval cost 4x with smarter sampling" |

By week 8: **3 blog posts, 5 experiment writeups, 12 closed failure modes, 200-row labeled dataset, 2 calibrated judges in production, ~100 jobs scored per day, ~3 applications per week.**

That portfolio + the QA background = the AI Evals Engineer pivot is essentially done. Outbound DMs to AI-lab recruiters now go out with concrete artifacts attached.

---

## TL;DR for someone reading this case study

The work isn't writing the eval framework. The work is:

1. **Using the tool daily** (this is when data accumulates)
2. **Looking at the data weekly** (this is when failure modes get discovered)
3. **Fixing one thing carefully** (this is when prompts improve)
4. **Measuring with a real test set** (this is when you know you actually shipped)
5. **Writing up every change** (this is when it becomes a portfolio)

Everything else — the docs, the schemas, the judges — exists to support that loop. The loop is the thing.
