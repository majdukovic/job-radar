# promptfoo starter

> The minimum viable promptfoo setup for job-radar. Install, write one YAML, run, read results.

---

## What promptfoo is and isn't

**Is:** an open-source CLI + library that runs your prompt against a list of test cases and computes pass/fail per case. Test cases are defined in YAML. Used by OpenAI and Anthropic internally (OpenAI acquired the project in March 2026, MIT-licensed).

**Isn't:** a tracing tool (use PostHog for that), a labeling UI (use the thumbs UI), or a judge platform (it can *call* judges; it doesn't manage them).

For job-radar, promptfoo runs **offline / CI evals** against a fixed dataset. Online evals = PostHog.

---

## Install

Already added to `package.json` during quickstart:

```bash
pnpm add -D promptfoo
```

Run via:

```bash
pnpm exec promptfoo eval
```

Or, with the convenience CLI:

```bash
pnpm dlx promptfoo@latest eval     # always-latest standalone
```

---

## Minimal viable config — `promptfooconfig.yaml`

Put this at the repo root. Annotated so every line is clear.

```yaml
# promptfooconfig.yaml
description: "job-radar — jd_normalizer region_classifier evals"

# Which prompt(s) to test. We point at the actual prompt file.
prompts:
  - file://prompts/jd_normalizer/v1.md

# Which model(s) to run them against.
providers:
  - id: anthropic:messages:claude-haiku-4-5-20251001
    config:
      temperature: 0
      max_tokens: 1024

# Test cases: each is one row from your eval set.
# Inputs are interpolated into the prompt via {{varname}}.
tests:
  - description: "EU-explicit remote"
    vars:
      jd_text: |
        Senior QA Engineer — Remote (Europe-based)
        Must-have: 3+ years Appium, Java.
        Location: fully remote within EMEA.
    assert:
      - type: is-json
      - type: javascript
        value: |
          const out = JSON.parse(output);
          return out.is_actually_remote === true &&
                 (out.allowed_regions.includes("EU") ||
                  out.allowed_regions.includes("EMEA"));

  - description: "US-only sneaky phrasing"
    vars:
      jd_text: |
        QA Automation Engineer — Remote
        We're a fully distributed team.
        Note: must be authorized to work in the United States.
    assert:
      - type: is-json
      - type: javascript
        value: |
          const out = JSON.parse(output);
          return out.is_actually_remote === false;

  - description: "Adversarial — timezone-as-region"
    vars:
      jd_text: |
        Mobile QA — Remote, must overlap 4 hours with PST
    assert:
      - type: is-json
      - type: javascript
        value: |
          const out = JSON.parse(output);
          return out.is_actually_remote === false ||
                 (out.timezone_constraints &&
                  out.timezone_constraints.toLowerCase().includes("pst"));
```

---

## Running it

```bash
# First run — interactive HTML report
pnpm exec promptfoo eval && pnpm exec promptfoo view

# CI-friendly run — JSON output, exit code reflects pass rate
pnpm exec promptfoo eval --output results.json
```

The HTML report opens in your browser at `http://localhost:15500`. It shows:
- Pass/fail per case
- The full prompt + model output per case
- A diff view between prompts when you compare two versions
- Aggregate stats

**Click any failed case.** You see the input, the model's response, and which assertion failed. That's the eval debugger.

---

## Reading the YAML

| Field | What it does |
|---|---|
| `prompts` | List of prompt files or inline templates. `file://...` reads from disk. |
| `providers` | Which LLM endpoints to call. Format: `provider:type:model`. |
| `tests` | The eval set, one row per case. |
| `vars` | Variables interpolated into the prompt with `{{name}}` syntax. |
| `assert` | Pass/fail rules. Multiple assertions per test = all must pass. |
| `description` | Free-form label that shows up in the report. |

---

## The assertion types you'll use most

```yaml
assert:
  # Output is valid JSON
  - type: is-json

  # Output matches a JSON schema (built-in Zod-like)
  - type: is-json
    value:
      type: object
      required: [title, is_actually_remote, allowed_regions]

  # Substring match
  - type: contains
    value: "Senior QA"

  # Regex match
  - type: regex
    value: "Senior\\s+QA"

  # Custom JS — full programmatic check
  - type: javascript
    value: |
      const out = JSON.parse(output);
      return out.confidence_score >= 0.7;

  # LLM-as-judge — only after Phase 4 when you have a calibrated judge
  - type: llm-rubric
    value: "Output correctly identifies the region; explanation matches the JD"

  # Threshold-based — fails if metric below value
  - type: cost
    threshold: 0.005      # cents per call max

  - type: latency
    threshold: 2000       # ms max
```

For Phase 1–3 stick to `is-json`, `contains`, `regex`, `javascript`. Add `llm-rubric` in Phase 4 after the judge is calibrated.

---

## Loading the eval set from disk (Phase 3+)

When the dev set grows past ~10 hand-written cases, move it to JSONL and load:

```yaml
# promptfooconfig.yaml
tests: file://evals/dev_set.jsonl
```

Where `evals/dev_set.jsonl` is one JSON object per line:

```jsonl
{"vars":{"jd_text":"…"}, "assert":[{"type":"javascript","value":"…"}]}
{"vars":{"jd_text":"…"}, "assert":[{"type":"javascript","value":"…"}]}
```

This is the standard format for shipping eval sets — diffable in git, easy to merge with new examples.

---

## Comparing two prompt versions side-by-side

The killer feature. List multiple prompts:

```yaml
prompts:
  - file://prompts/jd_normalizer/v1.md
  - file://prompts/jd_normalizer/v2.md
  - file://prompts/jd_normalizer/v3.md
```

Run:

```bash
pnpm exec promptfoo eval
pnpm exec promptfoo view
```

Report shows a grid: rows = test cases, columns = prompts. You can see at a glance which cases got better in v3 vs v2, and which regressed.

This is the artifact you screenshot for blog posts.

---

## CI integration — GitHub Actions

Once promptfoo is comfortable locally, wire it to CI:

```yaml
# .github/workflows/evals.yml
name: evals
on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'src/lib/llm.ts'
      - 'evals/dev_set.jsonl'

jobs:
  promptfoo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec promptfoo eval --output results.json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: results.json
```

Make `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` repository secrets in GitHub settings.

**Budget guard**: in CI, the eval set runs against the real LLM API. At N=30 dev cases × $0.001 per call × every PR ≈ $0.03/PR. Cheap, but worth a monthly review.

---

## Failure-budget gate (Phase 6)

The CI gate decides ship/no-ship on the basis of overall pass rate:

```yaml
# In your CI script after promptfoo eval
EVAL_PASS_RATE=$(jq '.stats.successes / .stats.totalAssertions' results.json)
THRESHOLD=0.85
if (( $(echo "$EVAL_PASS_RATE < $THRESHOLD" | bc -l) )); then
  echo "❌ Eval pass rate $EVAL_PASS_RATE below threshold $THRESHOLD"
  exit 1
fi
```

In practice the gate is per-component, not overall (see `success_criteria.md`). Add per-component thresholds as you grow.

---

## What promptfoo can't do (so you don't fight it)

| Need | Use instead |
|---|---|
| Tracing production traffic | PostHog LLM Analytics |
| Persistent labeled dataset with annotations | Your `eval_labels` table in Supabase |
| Multi-judge consensus | Custom script or Braintrust |
| Long-running online evals | PostHog scheduled insights |
| Red-teaming generation (adversarial inputs) | Built-in `promptfoo redteam`! |

The last one — promptfoo's built-in red-teaming mode — is genuinely good. After Phase 3 try:

```bash
pnpm exec promptfoo redteam init
pnpm exec promptfoo redteam run
```

It auto-generates adversarial inputs for your prompt. Adds candidates to your adversarial set you'd never have thought of.

---

## TL;DR

1. `pnpm add -D promptfoo`
2. `promptfooconfig.yaml` at repo root with 5–10 hand-written cases
3. `pnpm exec promptfoo eval && pnpm exec promptfoo view`
4. Iterate prompt → re-run → compare versions in the report
5. Wire CI gate in Phase 6
6. Run `promptfoo redteam` for free adversarial cases

This is the offline half of your eval system. PostHog is the online half. Together they're enough.
