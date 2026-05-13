# Interpreting your first 50 traces

> Your first error-analysis session is the highest-leverage 90 minutes of the entire project. This doc tells you what to look for, how to take notes, and how to stop early if you've already found enough.

---

## Why this is hard the first time

A beginner stares at 50 outputs and one of three things happens:

1. **"They all look fine"** — selection bias. You're seeing the cases where the model and JD agreed on something obvious; the actual failures are in subtler places.
2. **"They're all wrong"** — you're judging against an impossible bar (your full domain knowledge) when the LLM had only the JD text.
3. **"I don't know what I'm looking for"** — paralyzed by lack of categories.

This doc tries to prevent all three by giving you a structured worksheet to apply.

---

## Before you start

- Block 90 uninterrupted minutes. Phone in another room. Real focus.
- Open the `/evals/inbox` page (Phase 3) — sort by `created_at DESC`.
- Have a blank `notes.md` file open. Or paper. Whatever you'll actually use.
- Coffee. This is genuinely tiring.

If you don't have the `/evals/inbox` page yet (e.g. you're at end of Phase 2), use a direct Supabase query:

```sql
SELECT trace_id, input, llm_output, your_label, your_notes
FROM eval_labels
WHERE component = 'jd_normalizer'
ORDER BY created_at DESC
LIMIT 50;
```

---

## The 20 things to actively look for (Hamel-style checklist)

Print this. Keep it next to your screen. For each trace, scan against the list:

### Region classification (highest severity for job-radar)

1. **Did "Europe" / "EU" / "EMEA" get correctly identified as not-US-only?** (Most common failure pattern in normalizers trained on US-centric data.)
2. **Did "Remote, must overlap with PST" get correctly identified as US-only?** (Timezone-as-region-proxy is subtle.)
3. **Did "Remote within X countries" parse those countries into `allowed_regions`?**
4. **Did visa-sponsorship language change the meaning of "Remote"?** ("Remote, will sponsor" vs "Remote, US citizens only")

### Skill extraction

5. **Were skills in "Nice to have" / "Bonus" sections extracted into `nice_to_have_skills` or missed entirely?**
6. **Were specific versions (Python 3.10+, React 18+) preserved or stripped?**
7. **Did the model invent skills not in the JD?** (Hallucination check — rare but catastrophic.)
8. **Did the model normalize variant names?** ("JavaScript" vs "JS" vs "ECMAScript") — pick a canonical and check consistency.
9. **Were related skills lumped together?** ("Mobile testing" instead of separate "Appium", "Espresso", "XCUITest" entries.)

### Title / company / seniority

10. **Title canonicalized correctly?** "Senior QA Engineer / Mobile" → just "Senior QA Engineer Mobile"?
11. **Multi-role titles handled?** "QA Engineer / SDET" → both captured?
12. **Seniority inferred from title alone when not stated?** "Lead Engineer" → senior or staff?

### Salary

13. **Currency correctly identified?** "$50k" vs "€50k" vs "£50k" — all `salary_currency`-distinct?
14. **Salary ranges parsed as min/max?** "$80k-$120k" → 80000 and 120000.
15. **Equity-only or "competitive" returned as null, not 0?**

### Confidence / self-report

16. **High confidence on correct extractions?** (Good calibration.)
17. **Low confidence on wrong extractions?** (Also good — model knows it's unsure.)
18. **High confidence on wrong extractions?** (Bad — calibration broken, biggest danger signal.)

### Schema / format

19. **Any traces where `schema_valid = false`?** Skim those separately; they're the structured-output reliability data.
20. **Any traces with empty arrays or null values where data was clearly present in the JD?**

---

## The note-taking protocol

For each of the 50 traces, write **one line of free-form notes** in your scratch file. Don't categorize yet — just observe.

Examples of well-formed notes from the dry-run case study:

```
01HXM…AB  Said US-only but JD clearly says "Remote, Europe-based candidates preferred"
01HXM…CD  Missed Appium even though it's the FIRST required skill listed
01HXM…EF  Confidence 0.92, output totally wrong, region was "global" → returned "US"
01HXM…GH  Skills extracted: ["JavaScript"]. JD said "TypeScript preferred" — JS got auto-substituted?
01HXM…IJ  Looks correct, no notes
01HXM…KL  Listed "EMEA" as region, but excluded_regions: ["EU"]. Self-contradiction!
01HXM…MN  Salary "$50k-$70k" parsed as min=50000 max=50000. Range collapse.
01HXM…OP  Title "Senior QA Engineer (mobile) — Remote Europe" parsed title as "Senior QA Engineer". Mobile lost.
01HXM…QR  Looks correct
01HXM…ST  Cover letter for FrontRow has "I have 7 years..." but my CV says 5. HALLUCINATION.
```

That's 10 notes from ~50 traces (rough rule: expect to note ~30–50% of traces; the rest are correct or unremarkable).

**Don't categorize yet.** That's tomorrow's job. Today is observation only.

---

## Stop-early signals (don't always do all 50)

If you find yourself writing the same observation for the 5th time, **stop early on that pattern** and move on. The goal isn't comprehensive coverage of these 50; it's discovery of repeated patterns.

You can also stop early if:
- You've found ≥ 3 distinct failure-mode candidates with ≥ 3 examples each (you have enough to start clustering)
- You're past 60 minutes and still energized — keep going. Past 90 minutes — stop. Fatigue produces noise.

A typical first session produces 4–7 failure-mode candidates from 30–50 traces.

---

## The clustering step (next day)

Don't do this in the same session. Sleep on the notes; come back fresh.

1. **Read all notes once, end to end.** Resist the urge to categorize while reading.
2. **Second pass: highlight repeats.** Same phrasing twice = a category. Same shape three times = a confirmed category.
3. **Third pass: name each cluster.** Use the FM-NNN template from `failure_taxonomy_template.md`.
4. **Count frequency.** "How many of my 50 notes match this pattern?"
5. **Assign severity.** 1 = cosmetic, 2 = annoying, 3 = catastrophic.

Output: 4–7 `evals/failure_modes/FM-001.md` through `FM-007.md` files.

---

## What "good" looks like for a first session

You did this right if you can answer these afterward:

- "What are the 3 most frequent failure modes?" → you can name them
- "Which mode is highest priority?" → severity × frequency tells you
- "What's the next thing I'll try?" → a hypothesis for at least the top mode
- "What surprised me?" → at least one observation you didn't predict

If you can't answer those, you weren't looking — you were just clicking. That's normal the first time. Try again on the next batch of 50 traces.

---

## Sampling strategy for repeat sessions

You don't always look at 50 random traces. The 50/25/25 rule:

| Slice | % | Why |
|---|---|---|
| **Random** | 50% | Avoid selection bias; see the actual distribution |
| **Lowest judge score** | 25% | Find emerging failures the judge spotted but you haven't categorized yet |
| **Thumbs-down by you** | 25% | Focus on cases you flagged but maybe haven't followed up on |

Rotate component focus weekly. **Don't only look at the normalizer; cover-letter drafter rots silently while you're not watching.**

---

## When to schedule sessions

Realistic cadence (Hamel: "30–60 min/day"):

- **Phase 1–2 (weeks 1–3):** one 90-minute session at end of Phase 2
- **Phase 3 (week 4):** two 60-minute sessions during the week
- **Phase 4+ (week 5 onward):** 30 minutes daily ideally; 60 minutes 3×/week minimum

If you can't sustain 30 min/day, do 60 min Mon/Wed/Fri. **The cadence beats the volume.**

---

## How this becomes a portfolio artifact

Each session produces a scratch-notes file. Pick the best one — the session where you discovered the highest-leverage failure mode — and turn it into a blog post:

> **"Error analysis on my first 50 LLM traces: 6 failure modes I didn't predict"**
>
> Posted by [Mate] · 8 min read
>
> [Open with one juicy example: "I expected the model to confuse 'EMEA' with 'EU' — it didn't. What I didn't expect was that 8 out of 50 postings used 'Europe-based' to mean 'EU-residents-only', and the model treated this phrase as if it meant 'we are based in Europe (US team)' — flipping the meaning entirely..."]

That blog post is the artifact AI Evals hiring managers cite to each other. It's the single piece of writing that demonstrates you can do the work.

---

## TL;DR card

**Before:** print the 20-item checklist. Block 90 min. Open inbox.
**During:** write one-line free-form notes per trace. Don't categorize.
**After (next day):** cluster, name, count, severity, write FM-NNN files.
**Cadence:** weekly minimum, daily ideal.
**Goal:** discover 4–7 failure modes per first session.
**Anti-goal:** clicking 50 thumbs without writing notes.
