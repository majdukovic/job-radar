# Example judge: region_classifier

> A complete, annotated LLM-as-judge for evaluating whether the `region_classifier` got the answer right. Designed with all three bias mitigations applied. Copy this as your template when you write judges for other components.

---

## When you'd use this

After Phase 3, you have:
- Working `region_classifier` (and its parent `jd_normalizer`)
- ~100 hand-labeled examples in `eval_labels`
- Need to auto-evaluate every prompt change without re-labeling 100 examples by hand

This judge does that. **But:** it runs only AFTER calibration. Calibration protocol at the bottom.

---

## Architecture summary

```
JD text  ──► generator (Claude Haiku 4.5)  ──► classification (true/false)
                                                       │
                                                       ▼
                  ┌─────────────────────────────────────────────────────┐
                  │ JUDGE                                               │
                  │ - GPT-4o-mini  (cross-family → mitigates self-pref) │
                  │ - Length-aware rubric  (mitigates verbosity)        │
                  │ - For pairwise: randomized position + double-check  │
                  │   (mitigates position bias)                         │
                  └─────────────────────────────────────────────────────┘
                                                       │
                                                       ▼
                                          { verdict, reason, confidence }
                                                       │
                                                       ▼
                                      compare to held-out human label → κ
```

---

## Judge prompt (full text)

`prompts/judges/region_judge_v1.md`:

```markdown
You are an expert evaluator of LLM extractions from job descriptions.

Your task: given (a) a job description and (b) another model's classification of whether the JD is "actually remote for a Croatia/EU-based candidate," decide whether the classification is correct.

## Definitions

- **Actually remote** = a Croatia/EU resident could legally apply and work without relocation.
- **Not remote for the user** = the JD restricts to a region the user is not in (e.g. "US only", "Americas only", "LATAM only"), or requires a timezone the user can't sustainably overlap (e.g. "must overlap 6h with PST").
- **Ambiguous** = the JD doesn't clearly state. If ambiguous, "actually remote" defaults to **true** (give the user the option to apply).

## Inputs

JD:
"""
{{JD_TEXT}}
"""

The other model classified this JD as: `is_actually_remote = {{CLASSIFICATION}}`

## Your task

1. Read the JD carefully. Identify any phrases related to region, timezone, visa, work authorization.
2. Decide what the correct classification should be.
3. Compare to the model's classification.

## Output format (JSON only)

{
  "correct_classification": true | false,    // What you think the right answer is
  "model_was_correct": true | false,         // Whether the model matched you
  "evidence_phrases": ["...", "..."],        // Specific phrases from the JD that drove your decision
  "reasoning": "string, max 200 chars",      // ONE SHORT SENTENCE. Do not write long explanations.
  "confidence": 0.0 to 1.0                   // Your confidence in your own classification
}

## Rules

- Output ONLY valid JSON. No prose, no code fences.
- Keep `reasoning` to ≤ 200 chars. Long reasoning is a sign you're inventing nuance that isn't there.
- If you genuinely can't tell from the JD, set `confidence` < 0.5 and `correct_classification` = true (default to user-friendly).
```

Annotations on the prompt:

1. **Why GPT-4o-mini as judge?** Cross-family from the Claude-Haiku generator. Mitigates self-preference bias.
2. **Why the 200-char reasoning cap?** Mitigates verbosity bias. A judge that writes 3 paragraphs of reasoning to justify a guess is inflating confidence to the operator. Short reasoning is honest reasoning.
3. **Why default-to-true on ambiguity?** Domain decision (user-friendly). Documented so future-you doesn't tweak it without seeing the tradeoff.
4. **Why ask for `evidence_phrases`?** Lets you spot-check the judge: if it says "wrong" but cites no actual JD text, it's hallucinating.
5. **Why ask for the judge's own `confidence`?** Low judge confidence + judge agrees with model = weak signal. Low judge confidence + judge disagrees with model = also weak signal, possibly noise. High confidence on both sides is the trustworthy signal.

---

## Calling the judge (TypeScript)

`src/lib/judges/region_judge.ts`:

```ts
import OpenAI from "openai";
import { z } from "zod";
import { ulid } from "ulid";
import { getPostHog } from "../posthog";
import { readFileSync } from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const JudgeOutputSchema = z.object({
  correct_classification: z.boolean(),
  model_was_correct: z.boolean(),
  evidence_phrases: z.array(z.string()),
  reasoning: z.string().max(200),
  confidence: z.number().min(0).max(1),
});

const JUDGE_PROMPT = readFileSync("prompts/judges/region_judge_v1.md", "utf8");

export async function judgeRegionClassification(args: {
  jdText: string;
  modelClassification: boolean;
  originalTraceId: string;
}) {
  const judgeTraceId = ulid();
  const t0 = Date.now();

  const prompt = JUDGE_PROMPT
    .replace("{{JD_TEXT}}", args.jdText)
    .replace("{{CLASSIFICATION}}", String(args.modelClassification));

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0].message.content || "{}";
  const parsed = JudgeOutputSchema.parse(JSON.parse(raw));

  // Emit a $ai_evaluation event keyed to the original trace
  const ph = getPostHog();
  ph.capture({
    distinctId: "single-seat",
    event: "$ai_evaluation",
    properties: {
      $ai_trace_id: args.originalTraceId,        // link back to the generation
      judge_trace_id: judgeTraceId,
      component: "region_classifier",
      rater: "judge:region_v1",
      rater_model: "gpt-4o-mini",
      label: parsed.model_was_correct ? "correct" : "incorrect",
      judge_confidence: parsed.confidence,
      evidence_phrases: parsed.evidence_phrases,
      reasoning: parsed.reasoning,
      latency_ms: Date.now() - t0,
    },
  });

  return parsed;
}
```

---

## Calibration protocol (mandatory before trusting the judge)

You have 100 hand-labeled examples in `eval_labels`. Use 30 for calibration:

```ts
// scripts/calibrate_region_judge.ts
import "dotenv/config";
import { readFileSync } from "fs";
import { judgeRegionClassification } from "../src/lib/judges/region_judge";
import { cohensKappa, bootstrapCI } from "../src/lib/eval_stats";

// Sample 30 examples from dev set
const allLabeled = readFileSync("evals/dev_set.jsonl", "utf8")
  .split("\n").filter(Boolean).map(line => JSON.parse(line))
  .filter(r => r.component === "jd_normalizer");

const sample = shuffle(allLabeled).slice(0, 30);

const yourLabels: string[] = [];
const judgeLabels: string[] = [];
const pairs: { you: string; judge: string }[] = [];

for (const row of sample) {
  const judgement = await judgeRegionClassification({
    jdText: row.input,
    modelClassification: row.llm_output.is_actually_remote,
    originalTraceId: row.trace_id,
  });

  const youLabel = row.your_label === "good" ? "correct" : "incorrect";
  const judgeLabel = judgement.model_was_correct ? "correct" : "incorrect";

  yourLabels.push(youLabel);
  judgeLabels.push(judgeLabel);
  pairs.push({ you: youLabel, judge: judgeLabel });
}

const result = cohensKappa(yourLabels, judgeLabels);
const ci = bootstrapCI(
  pairs,
  (s) => cohensKappa(s.map(p => p.you), s.map(p => p.judge)).kappa,
  1000,
);

console.log(`Judge calibration on N=30:`);
console.log(`  raw agreement: ${result.rawAgreement.toFixed(3)}`);
console.log(`  Cohen's κ:      ${result.kappa.toFixed(3)} [${ci.lower.toFixed(3)}-${ci.upper.toFixed(3)}]`);
console.log();
console.log(`Verdict: ${result.kappa >= 0.80 ? "✅ judge approved" : "❌ judge needs work"}`);
```

### Expected calibration outcomes

| Result | What it means | What to do |
|---|---|---|
| κ ≥ 0.80 | Judge is trustworthy on this dataset | Ship it. Run on CI from now on. |
| 0.60 ≤ κ < 0.80 | Better than chance but not reliable | Diagnose disagreements; tighten judge prompt; re-calibrate. |
| κ < 0.60 | Don't trust the judge | Hard reset. Probably your rubric is underspecified or you're judging an ambiguous category. |

---

## Diagnosing disagreements

If calibration κ is below 0.80, **look at the disagreements**:

```ts
const disagreements = pairs
  .map((p, i) => ({ ...p, idx: i }))
  .filter(p => p.you !== p.judge);

for (const d of disagreements) {
  console.log(`\n--- Disagreement #${d.idx} ---`);
  console.log(`JD: ${sample[d.idx].input.slice(0, 200)}...`);
  console.log(`You: ${d.you}`);
  console.log(`Judge: ${d.judge}`);
}
```

Patterns you'll find:
- **You're inconsistent** — e.g. you labeled "Remote, must be authorized to work in EU" as "correct" once and "incorrect" once. Self-agreement is broken; tighten YOUR rubric.
- **Judge is overconfident on ambiguity** — judge says "correct" on ambiguous JDs because they default to true. Acceptable per the prompt's rule.
- **Judge missed a phrase** — judge didn't notice "EST timezone required" in the JD. Real failure; tighten judge prompt with a counter-example.
- **Real ambiguity** — even rereading, you can't tell. Move the example to the "ambiguous" bucket; remove from calibration set.

---

## Running the judge in production (after calibration)

Two integration paths:

### Path A: PostHog UI evaluator (Phase 4)

In PostHog → LLM Observability → Evaluators → New → "LLM judge":
- Paste the judge prompt
- Set provider: `openai/gpt-4o-mini`
- Sample rate: start 10%, increase to 50% after a week of stability
- Output schema: the Zod schema above as JSON Schema

PostHog runs the judge in the background; no code changes needed for this option.

### Path B: Custom code (better control)

Run the judge inline after every `region_classifier` call. Cost: ~$0.0002 per judgement (GPT-4o-mini on a ~500-token prompt). At 30 jobs/day = $0.006/day = $0.18/month. Negligible.

Recommendation: Path B for the first 2 weeks (you get faster iteration), then move to Path A's sample rate when you trust the judge.

---

## Bias mitigation checklist (pre-shipping checklist)

- [x] **Cross-family judge** — GPT-4o-mini judging Claude-Haiku output
- [x] **Length-aware** — judge prompt caps `reasoning` to 200 chars
- [x] **Position bias** — not applicable for pointwise binary; would apply if this were pairwise
- [x] **Calibrated** — κ ≥ 0.80 vs your hand labels on N=30
- [x] **Evidence-required** — judge must cite JD phrases, can't hallucinate verdicts
- [x] **Self-reported confidence** — judge flags its own uncertainty

For **pairwise** judges (e.g. cover-letter A vs B), add:
- [ ] **Order-randomized** — half the calls show A first, half show B first
- [ ] **Double-checked** — call the judge twice, swap order, check that verdict flips appropriately

---

## When to re-calibrate

| Event | Action |
|---|---|
| Judge prompt changed | Full re-calibration on a fresh 30-row sample |
| Generator prompt changed materially | Re-calibrate (small chance judge biases shift) |
| 30 days elapsed | Re-calibrate on a fresh 30-row sample; LLM provider drift is real |
| Production agreement % drifts > 5% from calibrated baseline | Re-calibrate; if still bad, retire the judge and re-design |

---

## What to put on your public portfolio

This file. Verbatim. With your real κ numbers filled in.

A judge prompt + calibration writeup is the canonical AI-Evals-Engineer portfolio piece. Anyone reading it can verify you understand:
- Cross-family bias mitigation
- Calibration protocol
- The difference between agreement and kappa
- Confidence intervals on agreement metrics
- How to debug disagreements

Five bullets that translate to "yes, hire this person." Worth a 30-minute writeup.

---

## TL;DR

1. Cross-family judge (GPT-4o-mini judging Claude)
2. Strict JSON output schema, 200-char reasoning cap, evidence required
3. Calibrate on N=30 with kappa, require κ ≥ 0.80
4. Re-calibrate every 30 days or after any prompt change
5. Diagnose disagreements before trusting; don't paper over them
6. Ship to PostHog evaluator at 10% sample rate; ramp up as you trust
