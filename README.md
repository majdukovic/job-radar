# job-radar

Personal AI-powered job-search aggregator that filters remote QA roles by **actual** geographic eligibility and fuzzy skill fit.

Also: a working portfolio piece for an **AI Evals Engineer** career pivot — every LLM component in this repo has pre-registered success criteria, will have calibrated judges with documented bias mitigations, and the failure-mode taxonomy is checked in alongside the code.

---

## TL;DR

| | |
|---|---|
| **What it does** | Polls remote-job sources (Remotive today; HN / Wellfound / LinkedIn next) → LLM normalizes each posting → hard region filter for EU/EMEA/Worldwide → skill match → ranked daily feed |
| **Why** | Teal/Sonara/LazyApply all fail on the same three problems: fake "Remote" labels, binary skill match, no specialist-recruiter discovery. This fixes all three. |
| **Stack** | Next.js 16 + Supabase Postgres (pgvector) + Inngest workers + Anthropic Claude Haiku 4.5 + PostHog LLM Analytics + promptfoo for CI evals |
| **Cost** | ~$13–33/month at single-user volume |
| **Status** | Phase 1 shipped — full pipeline ingest→normalize→score→UI working with real data. Phases 2–7 ahead. |
| **Discipline** | Hamel Husain + Shreya Shankar methodology: error analysis first, calibrate judges to κ ≥ 0.80, frozen test set, Holm-Bonferroni multiple-testing correction |

---

## What this repo demonstrates (the recruiter signal)

If you're reviewing this for a hiring decision, here are the disciplines shown in the code + docs, with file pointers:

| Discipline | Where it lives |
|---|---|
| **Production LLM extraction** with prompt-version SHA tracking + structured output policy | [`src/lib/llm.ts`](./src/lib/llm.ts), [`evals/trace_schema.md`](./evals/trace_schema.md), [`evals/structured_output_policy.md`](./evals/structured_output_policy.md) |
| **AI Evals Engineering methodology** (Hamel/Shreya) — error analysis, failure taxonomy, dataset stratification | [`evals/dataset_methodology.md`](./evals/dataset_methodology.md), [`evals/failure_taxonomy_template.md`](./evals/failure_taxonomy_template.md), [`evals/interpreting_first_50_traces.md`](./evals/interpreting_first_50_traces.md) |
| **LLM-as-judge calibration** with cross-family bias mitigation + Cohen's kappa target | [`evals/judges/example_region_judge.md`](./evals/judges/example_region_judge.md) |
| **Pre-registered success criteria** + Holm-Bonferroni correction for multi-component releases | [`evals/success_criteria.md`](./evals/success_criteria.md) |
| **Statistical rigor** — Wilson intervals, bootstrap CIs, kappa — implemented in TypeScript without a Python sidecar | [`evals/lib_eval_stats_explained.md`](./evals/lib_eval_stats_explained.md) |
| **Full-stack TypeScript at production shape** — Next.js 16 App Router, Inngest workers, Supabase RLS-aware schema | [`src/`](./src/), [`db/schema.sql`](./db/schema.sql) |
| **Documentation craft** — 1700+ lines of self-contained planning docs covering the methodology end-to-end | [`evals/`](./evals/) directory + [`evals/index.html`](./evals/index.html) visual overview |
| **QA-engineer pivot to AI evals** — the vocabulary mapping and learning trajectory written down | [`evals/qa_to_ai_evals_dictionary.md`](./evals/qa_to_ai_evals_dictionary.md) |

The repo is built around the explicit thesis: **"a daily-use AI tool with documented evals discipline is a stronger AI Evals Engineer portfolio than any course certificate."**

---

## The problem

Existing job-search tools (LinkedIn, Wellfound, Remotive, Teal, Sonara, LazyApply, Simplify) all share three flaws that make them useless for an EU-based QA engineer applying to truly-remote roles:

1. **Fake "Remote"** — the checkbox is the recruiter's choice; the JD body says "US only" / "EU only" / "LATAM only" / "must overlap PST." Boards ingest the checkbox; nothing reads the body.
2. **Binary skill match** — listed skill is *Playwright*? You have *Cypress*? Filtered out. Even though every hiring manager treats them as effectively interchangeable for a senior candidate.
3. **No specialist-recruiter discovery** — the best opportunities come from recruiters who repeatedly hire your exact niche; they're discoverable from their LinkedIn post history but no off-the-shelf tool does this.

job-radar fixes all three. Hard region filter via LLM extraction of the JD body. Skill match with substitution credit graph. Recruiter discovery as a separate pipeline (Phase 4).

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SOURCE POLLERS  (Inngest cron functions, scheduled per source)         │
│                                                                         │
│  Remotive       free JSON API         every 4h    ✓ Phase 1            │
│  RemoteOK       free JSON API         every 4h    → Phase 2            │
│  Himalayas      free JSON API         every 4h    → Phase 2            │
│  WWR            RSS feed              every 4h    → Phase 2            │
│  HN Who's Hiring  Apify regex actor   monthly     → Phase 2            │
│  Wellfound      Apify actor           daily       → Phase 2            │
│  LinkedIn Jobs  Apify actor           daily       → Phase 2            │
│  LinkedIn Posts Apify actor (hidden jobs + recruiter discovery)  → P3+ │
│  X #hiring      X pay-per-use         every 6h    → Phase 3            │
│  Reddit /r/forhire  PRAW              every 6h    → Phase 3            │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM NORMALIZER  (Anthropic Claude Haiku 4.5, schema-validated)         │
│                                                                         │
│  Reads raw JD → extracts structured fields:                             │
│    • title, company                                                     │
│    • is_actually_remote  (the differentiator — body, not checkbox)      │
│    • allowed_regions[], excluded_regions[]                              │
│    • required_skills[], nice_to_have_skills[]                           │
│    • seniority, salary_min/max, currency                                │
│    • visa_sponsorship, timezone_constraints                             │
│    • confidence_score (self-reported)                                   │
│                                                                         │
│  → emits $ai_generation event to PostHog with prompt_version SHA        │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SCORING                                                                │
│  • region_fit  (hard filter against user.allowed_regions)               │
│  • skill_match_score  (Phase 1: exact intersection;                     │
│                        Phase 3: + substitution graph                    │
│                        Cypress↔Playwright, Appium↔Espresso etc.)        │
│  • overall_fit_score                                                    │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  OUTPUT SURFACES                                                        │
│  • /jobs page (Next.js App Router, sorted by fit DESC)                  │
│  • Daily 22:00 Europe/Zagreb digest email (Resend) — Phase 5            │
│  • Slack webhook for hot leads (intent ≥ 90) — Phase 5                  │
│  • MCP server (Claude Code can query leads + draft cover letters) — P6  │
└─────────────────────────────────────────────────────────────────────────┘
```

Parallel pipeline (Phase 4):

```
LinkedIn Posts ──► Recruiter discovery worker ──► recruiters table
                   (filters posts where author title contains
                    "Recruiter/Talent/Sourcer" AND post mentions
                    QA/mobile/remote niche keywords)
```

---

## AI Evals discipline

This is the part that distinguishes the project from "ship AI feature + hope." Every LLM component is treated like a measurable system, not a black box.

**Pre-registered success criteria** (written *before* any code, in [`evals/success_criteria.md`](./evals/success_criteria.md)):

| Component | Primary metric | Target | CI gate |
|---|---|---|---|
| `region_classifier` | Precision | ≥ 0.95 | Block if < 0.92 |
| `jd_normalizer` (required_skills) | F1 | ≥ 0.80 | Block if < 0.75 |
| `skill_matcher` | Pairwise agreement | ≥ 0.75 | Block if < 0.70 |
| `cover_letter_drafter` | Mean rubric score | ≥ 3.5/5 | Block if < 3.2 |
| `cover_letter_drafter` | Hallucination rate | ≤ 2% | Block if > 5% |
| All components | Schema validity | ≥ 99.5% | Block if < 99% |

**LLM-as-judge protocol** (in [`evals/judges/example_region_judge.md`](./evals/judges/example_region_judge.md)):
- Cross-family judge (GPT judging Claude or vice versa) → mitigates self-preference bias
- Length-aware rubric → mitigates verbosity bias
- Position-randomized for pairwise → mitigates position bias
- Calibration to Cohen's κ ≥ 0.80 against human labels on N=30 *before* trusting the judge in CI

**Dataset hygiene** (in [`evals/dataset_methodology.md`](./evals/dataset_methodology.md)):
- 70 dev / 30 test / 20 adversarial split, stratified across 8 source platforms
- Test set frozen — never read while iterating prompts
- Self-agreement (test-retest) protocol: relabel 30 examples 14 days apart to establish your own ceiling
- Holm-Bonferroni correction for multi-component release gating
- Cohen's κ, not raw agreement (base-rate skew protection)

**Failure mode tracking** (template in [`evals/failure_taxonomy_template.md`](./evals/failure_taxonomy_template.md)):
- Each failure mode gets `FM-NNN.md` with severity, frequency, fix-attempt history
- Status machine: `open → investigating → mitigated → (regressed)`
- Mitigated modes get regression tests in the adversarial set — never "closed"

**Tooling stack** (intentionally lean, all OSS or free-tier):
- [PostHog LLM Analytics](https://posthog.com) — online tracing with `$ai_*` events
- [promptfoo](https://promptfoo.dev) — offline / CI YAML evals (OpenAI-owned since March 2026)
- Future: [Langfuse](https://langfuse.com) self-hosted on a VPS as a Phase 7 stretch

---

## Daily workflow

What I actually do day-to-day with this:

**Daily (~2 min):**
1. Open `/jobs` in the morning. Skim what came in overnight.
2. Glance at the PostHog LLM-health dashboard — schema validity rate, average latency, cost trend.
3. Thumb-down any obviously-wrong results. The thumb-down writes to the `eval_labels` table — passive dataset collection.

**Weekly (~90 min):**
1. Inbox review session. Walk through ~30 traces. Apply the [20-item checklist](./evals/interpreting_first_50_traces.md). Take open-coded notes; don't categorize yet.
2. Next day: cluster the notes into failure modes. File top 3 as `evals/failure_modes/FM-NNN.md`.
3. Pick the highest severity × frequency mode. Form a hypothesis. Try a prompt fix. Run promptfoo against the dev set. Ship if Δ is significant (Holm-Bonferroni-adjusted p < 0.05 on N ≥ 70).
4. Write the experiment up in `evals/experiments/E-NNN.md` with before/after metrics.

**Monthly:**
- Re-measure baselines. Drift check on judges (κ should stay ≥ 0.80 within 5% of calibration).
- Refresh the adversarial set with newly-discovered edge cases.

The full case study of how this rhythm plays out across 15 days is written up in [`evals/dry_run_case_study.md`](./evals/dry_run_case_study.md) — narrative form, real failure modes, real prompt-engineering decisions, real metric movements.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js 16 (App Router, Turbopack) on Vercel | Server components, free hobby tier |
| Database + auth | Supabase Postgres + pgvector + magic-link | One service for DB, vector search, auth |
| Background jobs | Inngest | Durable retries, cron, no infra to manage; free tier for personal use |
| LLM (extraction) | Anthropic Claude Haiku 4.5 | Cheapest accurate-enough model for structured extraction |
| LLM (judge) | GPT-4o-mini (cross-family) | Cross-family mitigates self-preference bias |
| Embeddings (Phase 3+) | OpenAI `text-embedding-3-small` | $0.02 / 1M tokens; 1536-dim matches `VECTOR(1536)` column |
| Scrapers (paid sources) | Apify actors | Pay-per-run, no scraping infra to maintain |
| Free job APIs | Remotive, RemoteOK, Himalayas, WWR | Free public JSONs / RSS |
| Notifications | Resend (email) + Slack webhook | Free tiers |
| Tracing | PostHog LLM Analytics | Free under 1M events; native `$ai_generation` UI |
| CI evals | promptfoo | OSS, MIT, OpenAI-owned; runs in GitHub Actions |
| MCP server | Custom thin wrapper over Supabase queries | Lets Claude Code query leads + draft cover letters |

---

## Repo structure

```
job-radar/
├── PLAN.md                       # consolidated project plan (Phase 1 → 7)
├── README.md                     # you're here
├── db/
│   └── schema.sql                # Supabase schema (jobs, eval_labels, user_profile)
├── prompts/
│   └── jd_normalizer/v1.md       # versioned prompt templates (SHA-tracked)
├── scripts/
│   ├── hello-trace.ts            # sanity check: one LLM call → PostHog
│   └── check-db.ts               # verifies env + schema in place
├── src/
│   ├── app/
│   │   ├── api/inngest/route.ts  # Inngest serve handler
│   │   └── jobs/page.tsx         # the /jobs feed (server component)
│   ├── inngest/
│   │   ├── client.ts
│   │   └── functions/
│   │       ├── remotive-poll.ts  # cron 4h: fetch + upsert + queue normalize
│   │       └── normalize-job.ts  # per-job worker: LLM → score → write back
│   └── lib/
│       ├── llm.ts                # Anthropic + PostHog trace emitter
│       ├── posthog.ts            # PostHog Node SDK client
│       └── supabase.ts           # service-role server client
└── evals/                        # ★ the AI Evals Engineer portfolio
    ├── README.md                 # reading order + methodology overview
    ├── index.html                # visual entry point (open in browser)
    ├── glossary.md               # 60+ term glossary (stats, eval, AI, tooling)
    ├── quickstart.md             # zero-to-first-trace setup
    ├── prompt_engineering_primer.md
    ├── trace_schema.md           # $ai_generation payload contract
    ├── baselines.md              # zero + smart baselines per component
    ├── dataset_methodology.md    # 70/30 dev/test, kappa, Wilson intervals
    ├── success_criteria.md       # pre-registered metrics + CI gates
    ├── structured_output_policy.md
    ├── failure_taxonomy_template.md
    ├── lib_eval_stats_explained.md  # TS implementations of kappa/Wilson/Holm
    ├── posthog_llm_analytics_starter.md
    ├── promptfoo_starter.md
    ├── qa_to_ai_evals_dictionary.md  # QA vocab → AI evals dialect
    ├── interpreting_first_50_traces.md
    ├── dry_run_case_study.md     # ★ 15-day narrative — read this first
    ├── judges/
    │   └── example_region_judge.md
    └── walkthroughs/
        └── end_to_end_example.md
```

---

## Status & roadmap

| Phase | Scope | Status |
|---|---|---|
| **1** | Scaffold + Remotive + Haiku normalizer + region filter + skill match + /jobs UI | ✅ Shipped |
| **2** | Add HN Who's Hiring + Wellfound + LinkedIn Jobs; manual error-analysis session #1 | 🟡 Next |
| **3** | Social-job sources + skill substitution graph + thumbs UI + first 100 labels + first promptfoo CI | ⏳ |
| **4** | Recruiter discovery pipeline + first calibrated LLM judge (κ ≥ 0.80) | ⏳ |
| **5** | Application drafter + state machine + daily digest | ⏳ |
| **6** | MCP server + nightly eval worker + GitHub Actions CI gate | ⏳ |
| **7** | (stretch) Langfuse self-host on a VPS for full MLOps observability | ⏳ |

Realistic beginner-honest pace: **5–8 weekends** to portfolio-grade v0.6, not the 4 days a practitioner would take.

---

## Getting started (if you want to clone and try)

```bash
git clone https://github.com/majdukovic/job-radar.git
cd job-radar
pnpm install
cp .env.local.example .env.local
# fill in your Anthropic / PostHog / Supabase keys
# then paste db/schema.sql into Supabase SQL editor and run
pnpm hello-trace                          # sanity check
# in two terminals:
pnpm dev
npx inngest-cli@latest dev
# trigger remotive-poll from http://localhost:8288
# then open http://localhost:3000/jobs
```

Full step-by-step in [`evals/quickstart.md`](./evals/quickstart.md). Plan ~2–3 hours the first time if you're new to the stack.

---

## Why this is the way

This project pushes against a few defaults common in indie AI projects:

- **No auto-apply.** Sonara/LazyApply at volume gets you flagged. Drafts only. Human in the loop.
- **No single trace celebrated.** A 5% delta at N=20 is noise. Confidence intervals on every reported metric.
- **Failure modes are first-class.** Each gets its own file with severity, frequency, fix-attempt history. The taxonomy directory is the real portfolio artifact.
- **Cross-family judges or no judges.** A Claude-judging-Claude eval inflates scores 5–7%. Either you mitigate or you don't have a judge.
- **Test set discipline enforced by tooling.** The eval CLI hides row-level test output by default; viewing requires `--explicit-overfit-risk` flag.

These choices come from the [Hamel Husain + Shreya Shankar AI Evals methodology](https://hamel.dev/blog/posts/evals-faq/), which is currently the de facto industry standard.

---

## About the author

**Mate Ajdukovic** — mobile QA engineer (Appium, Cypress, Java, JUnit, TestNG) pivoting toward AI Evals Engineering. Based in Zagreb, Croatia. Building this as both a daily-use tool and a public portfolio of the discipline.

The [`evals/qa_to_ai_evals_dictionary.md`](./evals/qa_to_ai_evals_dictionary.md) doc maps my existing QA vocabulary onto the AI-evals dialect — it's the bridge between what I've been doing for years and the role I'm now targeting.

If you're hiring for AI Evals / LLM Evaluation / AI QA Engineer roles, the contents of `evals/` are designed to answer the "can this person do the work?" question without an interview.

---

## Acknowledgments

- Methodology: [Hamel Husain](https://hamel.dev/) + [Shreya Shankar](https://www.sh-reya.com/)
- LLM observability convention: [PostHog LLM Analytics](https://posthog.com/docs/ai-engineering/observability)
- Eval framework: [promptfoo](https://promptfoo.dev) (OSS, MIT, OpenAI-owned since 2026-03)
- Code drafted in pair with Claude Code (Opus 4.7); architectural decisions, methodology choices, and daily eval discipline are mine.

---

## License

MIT. Use it, fork it, learn from it. Not a SaaS — single-seat by design.
