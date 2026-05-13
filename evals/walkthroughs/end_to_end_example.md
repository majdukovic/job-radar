# End-to-end walkthrough: one job from ingest to eval

> One real-shaped JD goes through every stage of the pipeline. The exact JSON at each step is shown so you see the data shape, not just the architecture diagram.

---

## The starting point: a JD scraped from Remotive

The Remotive free API returns this for one posting:

```json
{
  "id": 1837421,
  "url": "https://remotive.com/remote-jobs/qa/senior-qa-engineer-mobile-1837421",
  "title": "Senior QA Engineer (Mobile)",
  "company_name": "DriftLabs",
  "category": "QA",
  "tags": ["qa", "appium", "mobile", "remote", "europe"],
  "job_type": "full_time",
  "publication_date": "2026-05-12T09:14:00",
  "candidate_required_location": "Europe",
  "salary": "€55,000 - €75,000",
  "description": "<p>DriftLabs is hiring a Senior QA Engineer to join our distributed mobile team.</p><p><strong>Must-have:</strong></p><ul><li>4+ years of mobile automation experience</li><li>Strong Appium skills</li><li>Java or Kotlin proficiency</li><li>Experience with iOS and Android device farms</li></ul><p><strong>Nice-to-have:</strong></p><ul><li>Cypress (for occasional web testing)</li><li>Performance testing experience</li><li>CI/CD pipeline knowledge (GitHub Actions, Jenkins)</li></ul><p><strong>Location:</strong> Fully remote within EMEA timezones. We'll sponsor visas for Schengen-area candidates if needed.</p>"
}
```

---

## Stage 1: Ingest worker writes raw row to `jobs` table

Inngest function `reddit_remotive_poll` runs, fetches the JSON above, strips HTML, persists:

```sql
INSERT INTO jobs (raw_source, source_id, source_url, title, company, raw_text, scraped_at)
VALUES (
  'remotive',
  '1837421',
  'https://remotive.com/remote-jobs/qa/senior-qa-engineer-mobile-1837421',
  'Senior QA Engineer (Mobile)',
  'DriftLabs',
  'DriftLabs is hiring a Senior QA Engineer to join our distributed mobile team.\n\nMust-have:\n- 4+ years of mobile automation experience\n- Strong Appium skills\n- Java or Kotlin proficiency\n- Experience with iOS and Android device farms\n\nNice-to-have:\n- Cypress (for occasional web testing)\n- Performance testing experience\n- CI/CD pipeline knowledge (GitHub Actions, Jenkins)\n\nLocation: Fully remote within EMEA timezones. We''ll sponsor visas for Schengen-area candidates if needed.',
  NOW()
)
ON CONFLICT (raw_source, source_id) DO NOTHING
RETURNING id;
```

Returns: `id = 42`.

A `correlation_id` is generated: `01HXMC2BSPM5QYQ0HCR0X3PZA0`. This will tag every downstream LLM call for this job.

---

## Stage 2: jd_normalizer fires

Inngest triggers `normalize-job` for new jobs.row id=42.

The Anthropic call:

```ts
const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  temperature: 0,
  system: SYSTEM_PROMPT_V3,
  tools: [JD_NORMALIZER_TOOL_SCHEMA],
  tool_choice: { type: "tool", name: "extract_job_fields" },
  messages: [{ role: "user", content: `Extract from this JD:\n\n${rawText}` }],
});
```

The model returns a tool-use block. Parsed output:

```json
{
  "title": "Senior QA Engineer (Mobile)",
  "company": "DriftLabs",
  "is_actually_remote": true,
  "allowed_regions": ["EMEA", "EU", "Europe"],
  "excluded_regions": [],
  "timezone_constraints": "EMEA",
  "visa_sponsorship": "yes",
  "seniority": "senior",
  "salary_min": 55000,
  "salary_max": 75000,
  "salary_currency": "EUR",
  "required_skills": ["Appium", "Java", "Kotlin", "mobile automation", "iOS testing", "Android testing"],
  "nice_to_have_skills": ["Cypress", "performance testing", "GitHub Actions", "Jenkins", "CI/CD"],
  "reasoning": "JD explicitly states remote within EMEA; visa sponsorship available for Schengen; Java OR Kotlin acceptable so both listed.",
  "confidence_score": 0.94,
  "uncertain_fields": []
}
```

---

## Stage 3: `$ai_generation` event fires to PostHog

```json
{
  "event": "$ai_generation",
  "properties": {
    "trace_id": "01HXMC2BSPM5QYQ0HCR0X3PZAE",
    "correlation_id": "01HXMC2BSPM5QYQ0HCR0X3PZA0",
    "component": "jd_normalizer",
    "prompt_template_name": "jd_normalizer_v3",
    "prompt_version": "sha:a3f2b9c",
    "model": "claude-haiku-4-5-20251001",
    "model_provider": "anthropic",
    "temperature": 0,
    "max_tokens": 1024,
    "input_text": "DriftLabs is hiring a Senior QA Engineer ...",
    "output_raw": "[tool_use block ID: toolu_01AbC...]",
    "output_parsed": { ... full object from Stage 2 ... },
    "schema_valid": true,
    "latency_ms": 1247,
    "input_tokens": 412,
    "output_tokens": 198,
    "cost_usd": 0.00035,
    "timestamp_ms": 1747146023000,
    "sampling_bit": 0.31,
    "retry_count": 0,
    "source_platform": "remotive"
  }
}
```

---

## Stage 4: jobs row gets updated with normalized fields

```sql
UPDATE jobs SET
  is_actually_remote = true,
  allowed_regions = ARRAY['EMEA','EU','Europe'],
  excluded_regions = ARRAY[]::text[],
  required_skills = ARRAY['Appium','Java','Kotlin','mobile automation','iOS testing','Android testing'],
  nice_to_have_skills = ARRAY['Cypress','performance testing','GitHub Actions','Jenkins','CI/CD'],
  seniority = 'senior',
  salary_min = 55000,
  salary_max = 75000,
  salary_currency = 'EUR',
  visa_sponsorship = 'yes',
  confidence_score = 0.94
WHERE id = 42;
```

---

## Stage 5: scoring fires

Inngest triggers `score-job`.

### 5a. Region fit (hard filter)

```ts
const user = await getUserProfile();
// user.allowed_regions = ["Worldwide", "EU", "EMEA", "Croatia"]

const regionFit = job.allowed_regions.some(r => user.allowed_regions.includes(r));
// → true (EMEA matches)
```

### 5b. Skill match score (with substitution credit)

```ts
const userSkills = ["Appium", "Cypress", "Java", "mobile QA", "Espresso"];
// Direct overlap on required: Appium ✓, Java ✓
const directRequired = ["Appium", "Java"];          // 2 of 6
const subRequired    = ["Kotlin"];                  // Java ≈ Kotlin = 0.6 credit
const missedRequired = ["mobile automation", "iOS testing", "Android testing"];

// Score: (2 × 1.0 + 1 × 0.6 + 3 × 0) / 6 = 0.43

// Nice-to-have:
const directNice = ["Cypress"];                     // 1 of 5
const niceScore = 0.3 × (1/5) = 0.06;

// Combined: 0.43 × 0.7 + 0.06 × 0.3 = 0.319 → 32 / 100
const skillMatchScore = 32;
```

(That's a sobering score — but consider: the JD is for mobile, requires iOS + Android testing as separate skills the user doesn't list, even though they likely have those skills under "mobile QA". This is a real failure mode: the normalizer is over-decomposing a skill umbrella term. Becomes FM-002 in the dry-run case study.)

### 5c. Overall fit

```ts
// Phase 1 simple combiner
const overallFit = regionFit ? skillMatchScore : 0;
// → 32
```

### 5d. Explanation

A second LLM call (or for Phase 1, a templated string):

```
Senior QA Engineer (Mobile) at DriftLabs — remote within EMEA, salary €55-75k.
You match 2 of 6 required skills directly (Appium, Java) with partial credit for Kotlin.
Missing: explicit mobile automation, iOS, Android testing skills on your profile —
likely covered by your "mobile QA" tag but normalizer split them out. Worth a look.
```

```sql
UPDATE jobs SET
  region_fit = true,
  skill_match_score = 32,
  overall_fit_score = 32,
  score_explanation = '...',
  state = 'new'
WHERE id = 42;
```

---

## Stage 6: appears in /jobs feed

The `/jobs` page reads:

```sql
SELECT * FROM jobs
WHERE region_fit = true
  AND state != 'dismissed'
ORDER BY overall_fit_score DESC, scraped_at DESC
LIMIT 50;
```

Job #42 shows up. You see:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Senior QA Engineer (Mobile) — DriftLabs                  Fit: 32 ★ │
│ EMEA · €55k–€75k · senior · visa sponsorship yes                    │
│                                                                     │
│ You match: Appium ✓, Java ✓, Kotlin (subst)                        │
│ You're missing: mobile automation, iOS testing, Android testing     │
│                                                                     │
│ [thumb up]  [thumb down]   [open on Remotive]                      │
└─────────────────────────────────────────────────────────────────────┘
```

You click **thumb down**, then an edit modal lets you correct: "Required skills should not split mobile/iOS/Android — they're sub-aspects of 'mobile QA'."

---

## Stage 7: user thumb-down → `$ai_evaluation` event

```json
{
  "event": "$ai_evaluation",
  "properties": {
    "$ai_trace_id": "01HXMC2BSPM5QYQ0HCR0X3PZAE",
    "component": "jd_normalizer",
    "rater": "human:mate",
    "label": "bad",
    "corrected_output": {
      "required_skills": ["Appium", "Java", "Kotlin", "mobile QA"]
    },
    "notes": "Over-decomposing 'mobile QA' into separate iOS/Android/automation entries",
    "failure_mode_id": null
  }
}
```

---

## Stage 8: row in `eval_labels` table

```sql
INSERT INTO eval_labels (
  trace_id, component, input, llm_output, your_label, your_correction, your_notes
) VALUES (
  '01HXMC2BSPM5QYQ0HCR0X3PZAE',
  'jd_normalizer',
  'DriftLabs is hiring...',
  '{ "title": "Senior QA Engineer (Mobile)", "required_skills": ["Appium","Java","Kotlin","mobile automation","iOS testing","Android testing"], ... }',
  'bad',
  '{ "required_skills": ["Appium","Java","Kotlin","mobile QA"] }',
  'Over-decomposing mobile QA into separate iOS/Android/automation entries'
);
```

This row will be promoted to `dev` or `test` during the weekly inbox review.

---

## Stage 9: weekly review session promotes the row

Sunday morning, you open `/evals/inbox`. You see 50 unassigned `eval_labels` rows. For each:
- Read it
- Decide: dev, test, adversarial, or discard
- Click to assign

The job #42 row: you assign it to **dev** (random pick — 70/30). Its `set_assignment` becomes `'dev'`.

---

## Stage 10: clustering during error analysis

You notice 6 other rows have the same shape — the normalizer is decomposing skill umbrella terms. You create:

`evals/failure_modes/FM-002.md`:

```markdown
---
id: FM-002
title: Skill umbrella terms over-decomposed
component: jd_normalizer
severity: 2
status: open
first_seen: 2026-05-19
last_seen: 2026-05-26
frequency_in_sample: 7/50
fix_attempts: []
related: []
---

## Definition
The normalizer splits umbrella terms like "mobile QA" into individual sub-aspects
("iOS testing", "Android testing", "mobile automation"). This causes false negatives
in skill_matcher when the user lists the umbrella term but not the decomposed parts.
...
```

---

## Stage 11: prompt fix attempt

You edit `prompts/jd_normalizer/v3.md` → `v4.md`. Added rule + 2 few-shot examples:

> When the JD uses an umbrella term like "mobile testing" or "QA automation," keep the umbrella term. Do not split it into platform-specific sub-aspects unless the JD explicitly names them as separate required skills.

Commit. Git short SHA changes from `a3f2b9c` to `b1d4e72`.

---

## Stage 12: re-run the dev set against v4

```bash
pnpm exec promptfoo eval --prompts file://prompts/jd_normalizer/v4.md
pnpm exec promptfoo view
```

Re-run on the labeled dev set (70 rows). Compare to v3 baseline:

```
Field: required_skills F1
  v3 (sha:a3f2b9c):  0.62 [0.51-0.72]
  v4 (sha:b1d4e72):  0.79 [0.69-0.87]

FM-002 frequency:
  v3:  7/50
  v4:  1/50

Other fields:
  region_classifier precision: 0.96 → 0.95  (within noise, Wilson overlap)
  title exact-match:           0.94 → 0.94
  schema_valid rate:           1.00 → 1.00

Holm-Bonferroni adjusted: all changes p > 0.0125 except required_skills F1 (p = 0.003).
Verdict: required_skills improvement is significant; no significant regressions.
```

---

## Stage 13: ship + update artifacts

```bash
# Move v4 into "current" prompt
git mv prompts/jd_normalizer/v3.md prompts/jd_normalizer/v3.archived.md
git mv prompts/jd_normalizer/v4.md prompts/jd_normalizer/v4.md

# Update changelog
echo "
## v4 (sha:b1d4e72) — 2026-05-27
- Fixed FM-002: umbrella terms preserved instead of decomposed
- required_skills F1: 0.62 → 0.79 (N=70, Holm-Bonferroni p=0.003)
- No regressions elsewhere
" >> prompts/jd_normalizer/CHANGELOG.md

# Update failure mode
# evals/failure_modes/FM-002.md status: open → mitigated
# Add fix_attempt entry

# Write the experiment writeup
echo "[full markdown writeup]" > evals/experiments/E-001-jd_normalizer-v4.md

git add .
git commit -m "feat(jd_normalizer): v4 — preserve skill umbrella terms (closes FM-002)"
```

---

## Stage 14: re-score the affected job

Job #42 gets re-normalized with v4. Now:

```json
"required_skills": ["Appium", "Java", "Kotlin", "mobile QA"]
```

skill_match_score is re-computed:
- Direct: Appium ✓, Java ✓, mobile QA ✓ → 3/4
- Substitution: Kotlin (≈ Java) → 0.6
- Score: (3 × 1.0 + 1 × 0.6) / 4 = 0.90 → 90 / 100

The job now shows fit = 90 instead of 32. It moves to the top of your daily digest.

---

## Stage 15: portfolio artifact

`evals/experiments/E-001-jd_normalizer-v4.md` becomes a polished blog post:

> ### Fixing failure mode FM-002: when the LLM over-decomposed skill umbrella terms
>
> When I started running my job-radar normalizer on real Remotive postings, I noticed
> seven of fifty postings had a strange pattern: jobs that listed "mobile QA" as a required
> skill came out with `required_skills: ["iOS testing", "Android testing", "mobile automation"]`
> — three separate entries instead of the umbrella term. This broke downstream skill matching
> because my user profile listed "mobile QA" but not its decomposed sub-aspects...

That's how a 30-line failure-mode note becomes a 800-word blog post that gets shared in AI-evals circles.

---

## What this walkthrough demonstrates

1. **One job → fourteen distinct steps.** Most of them are not LLM calls — they're database operations, scoring, UI, and the labeling loop.
2. **Trace correlation lets you reconstruct the journey.** Every step shares the `correlation_id`. PostHog and Supabase can both reconstruct the timeline.
3. **The failure mode discovered in stage 10 produces actual measurable improvement in stage 12.** That's the loop. Look → cluster → hypothesize → fix → measure → ship.
4. **Public-repo artifacts emerge naturally**, not as extra work. FM-002.md, E-001.md, the prompt CHANGELOG entry — all written as part of the normal workflow.

This is the rhythm. Once you internalize it, every new component (skill_matcher, cover_letter_drafter, recruiter_specialty_classifier) follows the same 14 stages.
