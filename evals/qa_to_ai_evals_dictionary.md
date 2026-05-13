# QA Engineer → AI Evals Engineer dictionary

> You already understand 60% of AI evals. You just call things by different names. This doc maps your existing QA vocabulary to the AI-evals dialect.

---

## The mental shift in one sentence

**Traditional QA verifies a deterministic spec; AI evals discover and quantify the behavior of a stochastic system whose spec is partly emergent from the data.**

You're already comfortable with: test cases, regression suites, coverage, flakiness, defect taxonomy, CI gates, root-cause analysis. All of these have direct AI-evals analogs. A few don't translate cleanly — those are the conceptual leaps worth understanding.

---

## Direct translations (terms you know → terms they use)

| Your QA term | AI-evals term | Same? |
|---|---|---|
| Test case | Eval example / dataset row | Yes |
| Test suite | Eval set (dev set / test set / adversarial set) | Yes, but split into dev/test/adversarial |
| Regression test | Regression eval / CI eval | Yes, with statistical-significance overlay |
| Bug / defect | Failure mode / failure case | Yes |
| Defect taxonomy | Failure taxonomy | Yes (this doc literally exists as `failure_taxonomy_template.md`) |
| Severity (S1/S2/S3) | Severity 1–3 in failure modes | Yes |
| Test plan | Eval plan | Yes |
| Test data | Eval dataset | Yes |
| Pass/fail criteria | Success criteria / CI gates | Yes (`success_criteria.md`) |
| Smoke test | Quick sanity eval | Yes |
| Soak test | Long-running production-traffic monitoring | Sort of |
| Coverage (code paths) | **Failure-mode coverage** (different lens) | Conceptually similar |
| Flaky test | **Non-determinism** in LLM output | Different cause |
| Test pyramid | Eval pyramid (deterministic → judge → human) | Similar shape |
| Black-box vs white-box | Output-based eval vs trace-based eval | Yes |
| Acceptance criteria | Pre-registered thresholds | Yes |
| Bug bash | Error-analysis session | Yes |
| Postmortem | Failure-mode writeup (`evals/failure_modes/FM-NNN.md`) | Yes |
| RCA (Root Cause Analysis) | Hypothesis + fix-attempt history per mode | Yes |
| Test automation | Promptfoo / programmatic evals | Yes |
| Manual testing | Manual labeling / error-analysis session | Yes (more conceptual than UI clicking) |

---

## Concepts that need a mental shift

### Determinism → stochasticity

**QA world**: Same input → same output. A test that passes today should pass tomorrow. Flakiness is a bug to fix.

**AI evals world**: Same input → distribution of outputs. The model has a temperature; even at temperature 0, providers can return slightly different responses across runs. Flakiness isn't always a bug; sometimes it's the system telling you the prompt is on the edge of two interpretations.

**Practical implication**: you measure with proportions and confidence intervals, not pass/fail counts. "97/100 correct" with N=100 has a ±5% Wilson CI; the same 97% on N=20 has a ±13% CI. The same number means different things.

### Binary pass/fail → continuous quality scores

**QA world**: Test asserts `expect(x).toBe(5)`. Either it passed or didn't.

**AI evals world**: A cover-letter rubric scores 1–5 across 5 criteria. The "pass" is "mean rubric ≥ 3.5/5 with hallucination rate ≤ 2%." Multi-dimensional and probabilistic.

**Practical implication**: you'll find yourself debating where to draw lines. That's fine — pre-register them (see `success_criteria.md`) and don't move them mid-experiment.

### Spec-first → spec-emergent

**QA world**: Product manager writes requirements. You write tests against those requirements.

**AI evals world**: The "spec" partly emerges from looking at data. You'll discover failure modes you couldn't have anticipated (FM-001: "skills with version numbers stripped"). Those failure modes *become* part of the spec retroactively.

**Practical implication**: error analysis (looking at 50 traces a week) is non-negotiable. In QA you can sometimes survive on just running the test suite; in AI evals, you can't — the test suite itself only grows by looking at data.

### Code coverage → failure-mode coverage

**QA world**: 80% line coverage = the suite touches 80% of code paths.

**AI evals world**: Coverage isn't lines, it's *behavioral patterns*. "Coverage" means "for every documented failure mode, there's an eval that catches it." A new mode discovered = a new coverage hole = a new eval to write.

**Practical implication**: your dataset grows over time; coverage is a moving target. Plan for it.

### Test environment fidelity → data distribution match

**QA world**: Tests pass in staging but fail in prod. Cause: staging data differs from prod.

**AI evals world**: Same issue, different cause. Your eval set was collected in May; production data in August has shifted (new platforms, new job titles, new region phrasings). Your eval numbers don't predict prod anymore.

**Practical implication**: "drift detection." Re-measure baselines monthly; refresh dataset quarterly.

---

## QA habits that transfer beautifully

These are skills you already have that are gold for AI evals:

1. **Reproducibility hygiene.** You know to capture the exact env / version / seed. In AI evals: capture model version + prompt SHA + dataset version.
2. **Edge-case obsession.** You think in "what if the input is empty / unicode / has a SQL injection / is in Klingon?" That mindset is exactly what builds the adversarial set.
3. **Triage discipline.** You know how to look at 50 bugs and rank by severity × frequency. In AI evals: same mental loop on failure modes.
4. **Root-cause patience.** You know not to ship a fix until you understand *why* the test fails. In AI evals: a prompt change that improves a metric without an explained mechanism is suspect.
5. **Skepticism of green checks.** You know "all tests passed" is meaningless if coverage is bad. In AI evals: "judge agreement is 0.94" is meaningless if the dataset was stratified wrong.
6. **Documentation rigor.** You know a bug report needs reproduction steps. A failure mode entry needs trace IDs + sample inputs + hypothesis.

---

## QA habits that need adjustment

1. **"Fix the bug to make the test pass."** In AI evals, fixing one trace can make 10 others fail. Always re-run the dev set. Always.
2. **"100% pass is the goal."** In AI evals, 100% is suspicious. You're probably overfitting to dev. 92% with a sound test set is healthier than 100% on a leaky dev set.
3. **"Same input, same output."** Re-running an LLM call gives you a different answer 5–20% of the time even at temperature 0. Run N=3 and report the mean if you really need determinism for a specific trace.
4. **Trusting your own eye.** You'll think "this output is wrong" and discover from the data that it's actually subjectively fine. Calibrate via self-agreement (relabel 30 examples 14 days apart).

---

## The vocabulary you'll need to pick up

Already covered in `glossary.md`. The terms most worth committing to memory in your first month:

- **Precision** (vs. recall — this distinction will come up daily)
- **Cohen's kappa** (you'll use it whenever you compare two raters)
- **Failure taxonomy / failure mode** (your weekly artifact)
- **Few-shot / chain-of-thought** (your prompt vocabulary)
- **Structured output / tool-use mode** (your reliability vocabulary)
- **LLM-as-judge / judge calibration** (your automation vocabulary)
- **Position / verbosity / self-preference bias** (your "watch out for this" vocabulary)
- **Dev set / test set / adversarial set** (your dataset hygiene vocabulary)

---

## How to talk about your work in interviews

The QA-engineer pivot story writes itself. A few phrasings tested against actual AI Evals job descriptions:

| Don't say | Say instead |
|---|---|
| "I tested an AI app" | "I shipped systematic offline + online evals for an LLM-based extraction pipeline" |
| "I labeled examples" | "I built and stratified a 200-row eval dataset with train/dev/test split, then validated self-agreement at κ ≥ 0.85 before trusting labels" |
| "I wrote a judge" | "I designed a cross-family LLM-as-judge with explicit bias mitigations (position-swap, length-aware rubric), calibrated to κ = 0.83 against human labels" |
| "I fixed bugs" | "I identified 7 systematic failure modes through error analysis on 300 production traces; ship rate of mitigations was 5/7 within 4 weeks" |
| "I improved the prompt" | "Prompt iterations gated by Holm-Bonferroni-corrected significance tests on a held-out test set" |

That phrasing *is* what the work is. You're not inflating; you're using the dialect.

---

## One more reframe

QA's reputation in tech is mixed — "the people who break our stuff." AI evals is the same job rebranded for the LLM era and now sits at the top of the pay scale in AI orgs. OpenAI's "Research Engineer, Frontier Evals" pays $250k+ base.

Same work. Same skills. New name. Same person — you.
