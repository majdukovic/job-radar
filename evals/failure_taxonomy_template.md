# Failure taxonomy template (Blocker 6)

> The schema for documenting LLM failure modes. Without this structure, failure notes rot into useless markdown within 6 weeks. With it, the taxonomy becomes the highest-value artifact in the entire eval directory — and the centerpiece of the public-repo portfolio.

---

> ### 🟢 Beginner TL;DR
>
> Every time you find a recurring AI failure, give it an ID (`FM-001`, `FM-002`, …) and a one-page markdown file. The file template is in this doc. Each file has: title, severity (1–3), how often it happens, examples, hypothesis, and a log of fix attempts.
>
> Why bother? Because in 6 weeks you'll forget what FM-001 was — but the file remembers. And the directory of FM files **is** your portfolio. When you blog about your AI work, you cite "FM-007: closed in 2 attempts" with the receipts.
>
> First failure file to write: after your first error-analysis session (`interpreting_first_50_traces.md`). Aim for 4–7 modes from your first 50 traces.
>
> Worked example FM-001 lives at the bottom of this doc — copy that structure.

---

## Why this exists

Hamel Husain's #1 finding from years of consulting on LLM systems: **"the people who do error analysis ship better systems."** The taxonomy is what error analysis produces. A flat `notes.md` of random observations is not a taxonomy. A taxonomy is:

- Stable IDs (so commits can reference modes)
- Categorical structure (so failures can be counted)
- A status workflow (so you can show progress: open → mitigated)
- Fix-attempt history (so a mode that recurs has its full debugging trail in one place)

This doc is the **template** (the schema). Each individual failure mode lives in its own file at `evals/failure_modes/FM-XXX.md`.

---

## The schema per failure mode

```markdown
---
id: FM-007
title: Region "Remote (Europe)" parsed as US-only
component: region_classifier
severity: 3
status: mitigated
first_seen: 2026-05-23
last_seen: 2026-06-12
frequency_in_sample: 8/100
fix_attempts:
  - { sha: "a3f2b9c", date: "2026-05-24", result: "no_change", note: "added 'Europe' to prompt examples; no impact" }
  - { sha: "b1d4e72", date: "2026-05-28", result: "fixed", note: "switched to Anthropic tool-use mode; now 1/100" }
related: [FM-002, FM-015]
---

## Definition
The normalizer marks `is_actually_remote: false` and `allowed_regions: ["US"]` when the JD says "Remote (Europe-based)" or "Remote within Europe." Root cause: prompt examples skewed toward US-only patterns.

## Representative examples
- Trace `01HXM…AE` — JD: "Senior QA Engineer, Remote (Europe)" → output: `{is_actually_remote: false}`
- Trace `01HXP…XQ` — JD: "Mobile QA, fully remote within EMEA" → output: `{allowed_regions: ["US"]}`
- Trace `01HXR…LM` — JD: "Permanent remote — Europe-based candidates" → output: `{is_actually_remote: false}`

## Severity rationale
3/3 (catastrophic) — false negative on the user's primary filter. Causes the user to never see jobs they could actually apply to. Direct revenue/career impact.

## Hypothesis
Prompt's few-shot examples disproportionately use US-only phrasing. Model has learned that "Remote + geographic word" → "restricted to that geographic word as US-style state restriction."

## Mitigations attempted
1. **2026-05-24, sha a3f2b9c, no_change**: added 3 Europe-only examples to prompt. Failure rate unchanged. Inference: examples not the bottleneck; model isn't generalizing.
2. **2026-05-28, sha b1d4e72, fixed**: switched to Anthropic tool-use mode with explicit enum for `allowed_regions`. Failure rate dropped to 1/100. Tool-use constraint forced model to choose from `{Worldwide, EU, EMEA, Europe, …}` rather than free-text US-style strings.

## Eval coverage
- Adversarial example added: ADV-009.
- Regression test in `evals/test_set.jsonl` (rows 23, 47, 51).
- promptfoo deterministic check: assert `allowed_regions` contains at least one of `["EU", "Europe", "EMEA", "Worldwide"]` when JD contains regex `/Europe/i`.

## Lessons
- Few-shot examples are not always the right lever for systematic biases. Structural constraints (enums, tool-use) catch what examples miss.
- Always log `triggered_rules` field on classifications — diagnosing this took 2 hours; with rule logs it would have taken 15 minutes.
```

---

## Required frontmatter fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string `FM-NNN` | yes | Auto-incremented; never renumbered |
| `title` | string | yes | One-line crisp description |
| `component` | enum | yes | Must match a known component from `trace_schema.md` |
| `severity` | int 1–3 | yes | 1 = cosmetic, 2 = annoying, 3 = catastrophic |
| `status` | enum | yes | `open` \| `investigating` \| `mitigated` \| `accepted` \| `regressed` |
| `first_seen` | date | yes | When the failure first appeared in your traces |
| `last_seen` | date | yes | Updated on every recurrence |
| `frequency_in_sample` | string `N/M` | yes | Frequency on most recent labeled sample |
| `fix_attempts` | array | optional | One entry per attempted fix, append-only |
| `related` | array of FM-IDs | optional | Other modes that interact with this one |

---

## Status workflow

```
        ┌──── regressed ◄─── (re-appears in new evals)
        │
        ▼
     open ────► investigating ────► mitigated
        │                                │
        └────────► accepted ◄────────────┘
        (consciously decided not to fix:
         out of scope, too rare, or
         fix would harm other modes)
```

- `open`: just observed, not yet investigated
- `investigating`: hypothesis exists, fix attempts logged
- `mitigated`: most recent measurement shows ≤ 1/100 in sample; covered by regression test
- `accepted`: decision logged in body — "we accept this fails because [reason]"
- `regressed`: previously mitigated, now back; must trace why

A mode never moves from `mitigated` to `closed` or `done`. It stays `mitigated` forever (with regression coverage) so future-you remembers the history.

---

## Severity scoring

| Level | Definition | Example |
|---|---|---|
| **1 — cosmetic** | Misclassification with no downstream effect on user behavior | `seniority` extracted as "mid" instead of "mid-senior" |
| **2 — annoying** | Wastes user time but recoverable in the same session | Cover letter has one generic line, you delete and retry |
| **3 — catastrophic** | False filter result; user misses a good job, or wastes effort on a bad one | `region_classifier` false-negative on EU-friendly JD |

Severity drives:
- Prioritisation order for fixes (highest severity × highest frequency first)
- Weighted scoring in `success_criteria.md`'s release scoring
- Sampling priority for error-analysis sessions (50/25/25 random/low-judge/thumbs-down weighted toward 3s)

---

## How modes get added

### Source 1: error-analysis sessions
During the 30–60 min/day ritual, you keep journal-style notes on a separate scratch file. At the end of the week:

1. Re-read the week's scratch notes.
2. Cluster similar observations.
3. For each cluster of ≥ 3 observations, create a new `FM-NNN.md` file.
4. Single-instance observations stay in the scratch file as "watching."

This is the **bottom-up** discovery path. Slow but high signal.

### Source 2: thumbs-down clusters
The thumbs-down inbox (from `dataset_methodology.md`) is the **top-down** path:

1. Filter `eval_labels WHERE your_label = 'bad'`.
2. Sort by component.
3. Within a component, scan for repeated phrases in `your_notes`.
4. If you see the same correction shape ≥ 3 times → new mode.

### Source 3: production data drift
When a previously-mitigated mode's count goes up:

1. Status moves `mitigated → regressed`.
2. New `fix_attempts` entry required within 7 days.

### Anti-pattern: speculative modes
Do not create a mode for "things that might fail." Modes describe **observed failures in real traces**, with trace IDs as evidence. Speculative concerns go in a separate file: `evals/concerns.md`.

---

## Worked example (use this as the template for your first mode)

Save as `evals/failure_modes/FM-001.md` after Phase 2 error-analysis session:

```markdown
---
id: FM-001
title: Skills with version numbers stripped during extraction
component: jd_normalizer
severity: 2
status: open
first_seen: 2026-06-04
last_seen: 2026-06-04
frequency_in_sample: 4/50
fix_attempts: []
related: []
---

## Definition
JDs that list "Python 3.10+" or "React 18+" return `required_skills` containing only "Python" or "React" — the version is dropped. Downstream skill_matcher then can't distinguish a "Python 2 maintenance role" from a modern Python role.

## Representative examples
- Trace `01HXM…AB` — JD listed "Python 3.10+, FastAPI" → extracted: `["Python", "FastAPI"]`
- Trace `01HXM…CD` — JD listed "React 18+, TypeScript 5+" → extracted: `["React", "TypeScript"]`
- Trace `01HXM…EF` — JD listed "Java 17, Spring Boot 3" → extracted: `["Java", "Spring Boot"]`
- Trace `01HXM…GH` — JD listed "Node.js v20+, Express" → extracted: `["Node.js", "Express"]`

## Severity rationale
2/3 — annoying but not catastrophic. User can still see the job; mismatch in version only affects ranking precision, not visibility.

## Hypothesis
Prompt instructs "extract skills as canonical names." Model interprets "canonical" as "version-less." Need to clarify: include major version when JD specifies a minimum.

## Mitigations attempted
None yet.

## Eval coverage
- None yet. Will add adversarial example ADV-021 after first fix attempt.

## Lessons
TBD.
```

---

## Indexing

The full taxonomy is a directory of files. A summary index is auto-generated:

```
evals/failure_modes/
  _index.md           ← auto-generated, sorted by severity × frequency
  FM-001.md
  FM-002.md
  ...
```

`_index.md` example (generated by `scripts/build_taxonomy_index.ts`):

```markdown
# Failure modes — current state

| ID | Title | Component | Sev | Freq | Status |
|---|---|---|---|---|---|
| FM-007 | Region "Remote (Europe)" parsed as US-only | region_classifier | 3 | 1/100 | mitigated |
| FM-001 | Skills with version numbers stripped | jd_normalizer | 2 | 4/50 | open |
| ... |
```

This index is the artifact you screenshot for blog posts and the public repo's main `evals/` page. It tells a story: "here's what I found, here's what I fixed, here's the progression."

---

## Public-repo presentation

The full `evals/failure_modes/` directory is checked in. PII redaction applies (no recruiter names, no full JD bodies if they identify a specific small company — paraphrase if needed).

Blog post template `evals/experiments/_template.md` references modes by ID:

```markdown
# Experiment: jd_normalizer v3 — switching to Anthropic tool-use mode

**Goal**: fix FM-007, FM-012.
**Hypothesis**: enum-constrained `allowed_regions` will prevent US-style misclassification of European regions.
**Method**: same dev set v1.2, same prompt body, change only the call mode.

**Results**:
- FM-007 frequency: 8/100 → 1/100 ✅
- FM-012 frequency: 3/100 → 2/100 (within noise)
- region_classifier precision: 0.94 → 0.96, recall: 0.88 → 0.91
- No regressions elsewhere (Holm-Bonferroni adjusted, family-wise p > 0.05 for all other components)

**Shipped**: sha:b1d4e72, dataset_version 1.2.
```

That format is the gold standard for AI-Evals-Engineer portfolio writing. Compact, replicable, defensible.

---

## Status / next steps

- [x] Template fully specified.
- [ ] Create `evals/failure_modes/` directory in repo when Phase 1 starts.
- [ ] First `FM-001.md` written after Phase 2 error-analysis session (≥ 50 outputs reviewed).
- [ ] `scripts/build_taxonomy_index.ts` written in Phase 3.
- [ ] First experiment writeup in Phase 3 (`evals/experiments/E-001-...md`).
