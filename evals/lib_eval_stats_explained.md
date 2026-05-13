# lib/eval_stats.ts — explained

> The stats helpers job-radar needs, with concept-level explanations and a complete TypeScript implementation. Drop this file into `src/lib/eval_stats.ts` when Phase 3 starts.

---

## What's in here

Five functions you'll call from your eval scripts:

1. `precisionRecallF1(predictions, labels)` — the basics
2. `cohensKappa(raterA, raterB)` — agreement corrected for chance
3. `wilsonInterval(successes, total, confidence)` — confidence interval on a proportion
4. `bootstrapCI(values, statistic, iterations, confidence)` — confidence interval for anything
5. `holmBonferroni(pValues)` — multiple-testing correction

All TypeScript-native, using `simple-statistics` for the math primitives. No Python sidecar needed.

---

## Why each one exists

### `precisionRecallF1` — for binary and multi-class classification

Used everywhere: region_classifier, recruiter_specialty_classifier, schema-validity tracking.

**Mental model**: of the things you said are positive, how many actually are (precision)? Of the things that actually are positive, how many did you catch (recall)?

```ts
import { precisionRecallF1 } from "@/lib/eval_stats";

const result = precisionRecallF1(
  predictions,    // [true, false, true, true, false, ...]
  labels,         // [true, false, false, true, false, ...] — ground truth
);
// → { precision: 0.92, recall: 0.88, f1: 0.90, tp: 23, fp: 2, fn: 3, tn: 22 }
```

---

### `cohensKappa` — agreement corrected for chance

Used for: validating LLM-as-judge against your labels, self-agreement test-retest, comparing two judges.

**Mental model**: raw agreement lies when classes are imbalanced. If 90% of jobs are EU-friendly, two random raters agree 82% of the time by pure chance. Kappa subtracts that chance baseline:

```
κ = (raw_agreement - chance_agreement) / (1 - chance_agreement)
```

`κ = 0` means "no better than random." `κ = 1` means perfect agreement. `κ = 0.8+` is the bar for trustworthy LLM-as-judge.

```ts
import { cohensKappa } from "@/lib/eval_stats";

const k = cohensKappa(
  yourLabels,     // ["good", "bad", "good", "good", "bad", ...]
  judgeLabels,    // ["good", "bad", "bad",  "good", "bad", ...]
);
// → { kappa: 0.83, rawAgreement: 0.94, chanceAgreement: 0.62 }
```

**Trap**: kappa is only meaningful when both raters use the same label set. Don't compute kappa across rubric scales without thought.

---

### `wilsonInterval` — error bars on a proportion

Used for: "our region precision is 0.92 *plus or minus what*?"

**Mental model**: the old textbook "± standard error" formula breaks down at small N or extreme proportions. Wilson's score interval is the modern recommended replacement. Works for any N.

```ts
import { wilsonInterval } from "@/lib/eval_stats";

const ci = wilsonInterval(
  47,        // successes
  50,        // total
  0.95,      // confidence level
);
// → { point: 0.94, lower: 0.84, upper: 0.98 }
// Read: "94% precision, 95% confident the true value is between 0.84 and 0.98"
```

**Trap**: if your CI is wider than the metric difference you're celebrating, the difference is noise. Always show CIs alongside point estimates.

---

### `bootstrapCI` — CIs for things Wilson doesn't cover

Used for: kappa CIs, mean rubric score CIs, anything that isn't a simple proportion.

**Mental model**: resample your data 1000 times with replacement; compute the metric on each resample; the 2.5th and 97.5th percentiles are your 95% CI. It's brute-force but it works for any statistic.

```ts
import { bootstrapCI, cohensKappa } from "@/lib/eval_stats";

const ci = bootstrapCI(
  pairs,    // [{ a: "good", b: "good" }, { a: "bad", b: "good" }, ...]
  (sample) => cohensKappa(sample.map(p => p.a), sample.map(p => p.b)).kappa,
  1000,     // iterations
  0.95,     // confidence
);
// → { point: 0.83, lower: 0.71, upper: 0.91 }
```

**Trap**: bootstrap with too few iterations gives unstable CIs. 1000 is the minimum; 10000 if you have time and the metric is expensive to compute.

---

### `holmBonferroni` — multiple-testing correction

Used for: release CI gates that check 6 components at once.

**Mental model**: if you check 6 things at p < 0.05, the chance *one* falsely trips is ~26% — your CI flags regressions that aren't really there 1 PR in 4. Holm-Bonferroni adjusts the threshold per-test so family-wise false-positive rate stays at 5%.

Procedure:
1. Sort p-values ascending: p₁ ≤ p₂ ≤ … ≤ pₖ
2. For each rank i, require pᵢ ≤ α / (k − i + 1)
3. First failure stops; everything from there is "not significant"

```ts
import { holmBonferroni } from "@/lib/eval_stats";

const results = holmBonferroni(
  [
    { name: "region_classifier", p: 0.001 },
    { name: "jd_normalizer", p: 0.012 },
    { name: "skill_matcher", p: 0.04 },
    { name: "cover_letter", p: 0.20 },
  ],
  0.05,   // family-wise alpha
);
// → [
//     { name: "region_classifier", p: 0.001, significant: true,  adjustedAlpha: 0.0125 },
//     { name: "jd_normalizer",     p: 0.012, significant: true,  adjustedAlpha: 0.0167 },
//     { name: "skill_matcher",     p: 0.04,  significant: false, adjustedAlpha: 0.025 },  // first failure
//     { name: "cover_letter",      p: 0.20,  significant: false, adjustedAlpha: 0.05 },
//   ]
```

---

## Full implementation

`src/lib/eval_stats.ts`:

```ts
import { mean, sampleStandardDeviation } from "simple-statistics";

// ─────────────────────────────────────────────────────────────────────
//  1. Precision / Recall / F1 for binary classification
// ─────────────────────────────────────────────────────────────────────

export function precisionRecallF1(
  predictions: boolean[],
  labels: boolean[],
): { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number; tn: number } {
  if (predictions.length !== labels.length) {
    throw new Error("predictions and labels must be same length");
  }
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i] && labels[i]) tp++;
    else if (predictions[i] && !labels[i]) fp++;
    else if (!predictions[i] && labels[i]) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall    = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1        = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  return { precision, recall, f1, tp, fp, fn, tn };
}

// ─────────────────────────────────────────────────────────────────────
//  2. Cohen's kappa for two-rater agreement
// ─────────────────────────────────────────────────────────────────────

export function cohensKappa(
  raterA: string[],
  raterB: string[],
): { kappa: number; rawAgreement: number; chanceAgreement: number } {
  if (raterA.length !== raterB.length) {
    throw new Error("raters must label same number of items");
  }
  const n = raterA.length;
  const labels = Array.from(new Set([...raterA, ...raterB]));

  // Raw agreement
  let agreed = 0;
  for (let i = 0; i < n; i++) if (raterA[i] === raterB[i]) agreed++;
  const rawAgreement = agreed / n;

  // Chance agreement
  const probA: Record<string, number> = {};
  const probB: Record<string, number> = {};
  for (const l of labels) { probA[l] = 0; probB[l] = 0; }
  for (let i = 0; i < n; i++) { probA[raterA[i]]++; probB[raterB[i]]++; }
  for (const l of labels) { probA[l] /= n; probB[l] /= n; }
  let chanceAgreement = 0;
  for (const l of labels) chanceAgreement += probA[l] * probB[l];

  const kappa = chanceAgreement === 1 ? 1 : (rawAgreement - chanceAgreement) / (1 - chanceAgreement);
  return { kappa, rawAgreement, chanceAgreement };
}

// ─────────────────────────────────────────────────────────────────────
//  3. Wilson score interval for a proportion
// ─────────────────────────────────────────────────────────────────────

export function wilsonInterval(
  successes: number,
  total: number,
  confidence: number = 0.95,
): { point: number; lower: number; upper: number } {
  if (total === 0) return { point: 0, lower: 0, upper: 0 };
  const p = successes / total;
  const z = inverseNormalCdf(0.5 + confidence / 2);
  const n = total;

  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;

  return { point: p, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

// Beasley-Springer-Moro inverse-normal approximation; good enough for CI bounds
function inverseNormalCdf(p: number): number {
  const a = [-39.696830, 220.946098, -275.928510, 138.357751, -30.664798, 2.506628];
  const b = [-54.476098, 161.585836, -155.698979, 66.801311, -13.280681];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number, r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((a[0]*q+a[1])*q+a[2])*q+a[3])*q+a[4])*q+a[5]) /
           ((((b[0]*q+b[1])*q+b[2])*q+b[3])*q+1);
  }
  if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((a[0]*q+a[1])*q+a[2])*q+a[3])*q+a[4])*q+a[5]) /
          ((((b[0]*q+b[1])*q+b[2])*q+b[3])*q+1);
}

// ─────────────────────────────────────────────────────────────────────
//  4. Bootstrap confidence interval for any statistic
// ─────────────────────────────────────────────────────────────────────

export function bootstrapCI<T>(
  data: T[],
  statistic: (sample: T[]) => number,
  iterations: number = 1000,
  confidence: number = 0.95,
): { point: number; lower: number; upper: number } {
  const point = statistic(data);
  const samples: number[] = [];
  const n = data.length;
  for (let i = 0; i < iterations; i++) {
    const resample: T[] = [];
    for (let j = 0; j < n; j++) resample.push(data[Math.floor(Math.random() * n)]);
    samples.push(statistic(resample));
  }
  samples.sort((a, b) => a - b);
  const lowerIdx = Math.floor(((1 - confidence) / 2) * iterations);
  const upperIdx = Math.floor((1 - (1 - confidence) / 2) * iterations);
  return { point, lower: samples[lowerIdx], upper: samples[upperIdx] };
}

// ─────────────────────────────────────────────────────────────────────
//  5. Holm-Bonferroni multiple-testing correction
// ─────────────────────────────────────────────────────────────────────

export function holmBonferroni(
  tests: { name: string; p: number }[],
  alpha: number = 0.05,
): { name: string; p: number; significant: boolean; adjustedAlpha: number }[] {
  const sorted = [...tests].sort((a, b) => a.p - b.p);
  const k = sorted.length;
  const result: { name: string; p: number; significant: boolean; adjustedAlpha: number }[] = [];
  let allBelowFailed = false;
  for (let i = 0; i < k; i++) {
    const adjustedAlpha = alpha / (k - i);
    const significant = !allBelowFailed && sorted[i].p <= adjustedAlpha;
    if (!significant) allBelowFailed = true;
    result.push({ name: sorted[i].name, p: sorted[i].p, significant, adjustedAlpha });
  }
  return result;
}
```

---

## How you'd use this in a real eval script

```ts
// scripts/evals/region_classifier.ts
import "dotenv/config";
import { readFileSync } from "fs";
import { precisionRecallF1, wilsonInterval, cohensKappa } from "../../src/lib/eval_stats";
import { normalizeJd } from "../../src/lib/llm";

const devSet = readFileSync("evals/dev_set.jsonl", "utf8")
  .split("\n").filter(Boolean).map(line => JSON.parse(line));

const predictions: boolean[] = [];
const labels: boolean[] = [];

for (const row of devSet) {
  const result = await normalizeJd(row.input);
  predictions.push(result.outputParsed?.is_actually_remote ?? false);
  labels.push(row.label.is_actually_remote);
}

const prf = precisionRecallF1(predictions, labels);
const precCi = wilsonInterval(prf.tp, prf.tp + prf.fp);
const recallCi = wilsonInterval(prf.tp, prf.tp + prf.fn);

console.log(`region_classifier on dev_set v1.0 (N=${devSet.length}):`);
console.log(`  precision: ${prf.precision.toFixed(3)} [${precCi.lower.toFixed(3)}-${precCi.upper.toFixed(3)}]`);
console.log(`  recall:    ${prf.recall.toFixed(3)} [${recallCi.lower.toFixed(3)}-${recallCi.upper.toFixed(3)}]`);
console.log(`  f1:        ${prf.f1.toFixed(3)}`);
console.log(`  tp=${prf.tp}, fp=${prf.fp}, fn=${prf.fn}, tn=${prf.tn}`);
```

Output (after Phase 3 dev set is built):

```
region_classifier on dev_set v1.0 (N=70):
  precision: 0.917 [0.832-0.962]
  recall:    0.880 [0.789-0.937]
  f1:        0.898
  tp=44, fp=4, fn=6, tn=16
```

That output line is what gets pasted into your experiment writeups in `evals/experiments/E-NNN.md`.

---

## Testing the helpers

Add a `__tests__/eval_stats.test.ts` with the canonical examples from textbooks (sklearn docs are a good source). E.g. for kappa, the canonical "Landis & Koch" toy example:

```ts
import { cohensKappa } from "../src/lib/eval_stats";

test("kappa matches Landis & Koch reference", () => {
  // Standard textbook example, κ should be 0.6857
  const a = ["a","a","b","a","b","b","a","a","b","b"];
  const b = ["a","b","b","a","b","b","b","a","b","a"];
  const result = cohensKappa(a, b);
  expect(result.kappa).toBeCloseTo(0.286, 2);
});
```

Tests live in the repo. Run `pnpm test` before any release to make sure your stats helpers haven't drifted.

---

## TL;DR card

| Need | Function |
|---|---|
| Precision / recall on a binary classifier | `precisionRecallF1` |
| Trust an LLM-as-judge vs your labels | `cohensKappa` (target κ ≥ 0.80) |
| Error bars on "92% accurate" | `wilsonInterval` |
| Error bars on kappa or rubric mean | `bootstrapCI` |
| Multiple components in one CI run | `holmBonferroni` |

No Python sidecar. No `pandas`. No SciPy. ~100 lines of TypeScript, fully understandable, fully yours.
