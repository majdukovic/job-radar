# job-radar — Full Plan

> Personal AI job-search aggregator for remote mobile QA roles. Multi-source ingest + LLM-extracted "true remote" + fuzzy skill match with substitution credit + parallel recruiter discovery + everything driveable from Claude Code via MCP. Sibling to [intent-radar](./intent-radar-plan.md). Doubles as the practice substrate for becoming a hireable AI Evals Engineer.

**Status:** Research + eval scaffolding complete (2026-05-13). Build not started.
**Target repo:** `~/GithubProjects/job-radar` (does not exist yet)
**Eval scaffolding:** `~/Desktop/job-radar-evals/` — moves into `job-radar/evals/` at Phase 1 start.

---

## 1. The problem

Existing tools (LinkedIn, Wellfound, Remotive, RemoteOK, Teal, Sonara, LazyApply, Simplify) all share three flaws that make them useless for a Croatia-based mobile QA engineer:

1. **Fake "Remote"** — the checkbox lies; the JD body says "US only" / "EU only" / "LATAM only"
2. **Binary skill match** — required = Playwright? You have Cypress? Filtered out. Even though hiring managers consider Cypress equivalent.
3. **No outbound channel** — you can find postings, but not the specialist recruiters who repeatedly hire your niche.

job-radar fixes all three.

---

## 2. What it does

```
Sources poll          LLM normalizer        Scoring             Output
─────────────         ────────────────      ───────             ──────
Remotive    ──┐                                                  ┌── Daily 22:00
RemoteOK    ──┤      Haiku 4.5             Region hard          │   digest email
Himalayas   ──┤  →   structured  →  →      filter (Croatia/  →  ├── /jobs feed
WeWorkRem   ──┤      extraction:           EU/EMEA)              │   sorted by
HN Hiring   ──┤      title, regions,                             │   overall_fit
Wellfound   ──┤      skills, salary,       Skill match +         │
LI Jobs     ──┤      visa, seniority       substitution credit   ├── Slack hot
LI Posts    ──┤                            (Cypress↔Playwright)  │   leads
X #hiring   ──┤                                                  │
Reddit      ──┘      Recruiter posts  →    Specialty classifier  └── /recruiters
                                                                     parallel pipe
```

---

## 3. Hard constraints

- **Single seat.** Never sold / shared (LinkedIn ToS, Reddit API policy).
- **Region is a hard filter**, not a soft score. Out-of-region postings never reach the LLM.
- **No auto-apply.** Drafts only. Sonara/LazyApply auto-apply at volume — recruiters notice and trash you.
- **No cold DM spam** to recruiters. Drafts only.
- **Schema-validity threshold ≥ 99.5%.** Production crashes don't care if model is smart.
- **Cross-family judges.** When generator = Claude, judge = GPT (or vice versa). Mitigates self-preference bias.

---

## 4. Architecture

### Data model (Supabase Postgres + pgvector)

```
UserProfile (you, 1 row)
  ├─ allowed_regions: ["Worldwide", "EU", "EMEA", "Croatia"]
  ├─ excluded_regions: ["US-only"]
  ├─ skills: [{name: Appium, proficiency: 5},
  │           {name: Cypress, proficiency: 4},
  │           {name: Java, proficiency: 4}, ...]
  ├─ skill_substitutions_overrides
  ├─ seniority_target: "mid-senior"
  ├─ min_salary_usd
  ├─ blacklist_companies: []
  └─ cover_letter_template, voice_style

Jobs
  ├─ raw_source, source_id, source_url
  ├─ title, company, posted_at, scraped_at
  ├─ is_actually_remote, allowed_regions[], excluded_regions[]
  ├─ required_skills[], nice_to_have_skills[]
  ├─ seniority, salary_min/max, currency, visa_sponsorship
  ├─ confidence_score
  ├─ embedding (pgvector)
  ├─ region_fit_bool, skill_match_score, overall_fit_score
  ├─ score_explanation
  └─ state (new | starred | drafted | applied | rejected | interview | offer)

Recruiters
  ├─ name, linkedin_url, current_title, company
  ├─ recent_posts[], specialty_score
  ├─ contact_state (new | drafted | reached_out | replied | scheduled | dead)
  └─ outreach_draft

EvalLabels (the dataset feeding the eval system)
  ├─ trace_id, component, input, llm_output
  ├─ your_label, your_correction, your_notes
  ├─ set_assignment (dev | test | adversarial)
  └─ created_at
```

### Workers (Inngest)

| Worker | Schedule | Purpose |
|---|---|---|
| `free-api-poll` | every 4h | Remotive / RemoteOK / Himalayas / WWR |
| `apify-jobs-poll` | daily 06:00 | LinkedIn Jobs + Wellfound |
| `hn-hiring-poll` | 1st of month + daily | HN Who's Hiring regex actor |
| `social-jobs-poll` | every 6h | LinkedIn Posts + X #hiring + Reddit r/forhire |
| `recruiter-discovery` | daily | LinkedIn Posts → profile scrape → rank |
| `normalize-job` | on new row | Haiku structured extraction |
| `score-job` | after normalize | region + skill + seniority |
| `daily-digest` | 22:00 Europe/Zagreb | Resend email + Slack |
| `nightly-eval` | 03:00 Europe/Zagreb | Re-run eval set against current prompts, post deltas |

### Stack

| Layer | Choice |
|---|---|
| Frontend + API | Next.js 15 on Vercel |
| DB + auth | Supabase Postgres + pgvector + magic-link |
| Background jobs | Inngest |
| LLM | Claude Haiku 4.5 default, Sonnet 4.6 fallback, GPT-4o-mini as cross-family judge |
| Embeddings | OpenAI `text-embedding-3-small` |
| Scrapers (paid) | Apify (LI Jobs, LI Posts, Wellfound) |
| Job board APIs (free) | Remotive, RemoteOK, Himalayas, WWR |
| Notifications | Resend + Slack webhook |
| Tracing | PostHog LLM Analytics |
| CI evals | promptfoo |
| MCP | Thin wrapper over Supabase queries |

---

## 5. Phased build plan

| Phase | Build scope | Eval discipline introduced | Time |
|---|---|---|---|
| **1** | Scaffold (Next/Supabase/Inngest). UserProfile seeded. Free-API pollers. Haiku normalizer. Region hard filter. Basic skill match. **PostHog `$ai_generation` from line 1.** | Instrumentation; no evals yet — collecting traces | 1d practitioner / ~3 evenings beginner |
| **2** | HN + Wellfound + LI Jobs (Apify). Dedup. | **First manual error analysis (50 outputs).** Build failure taxonomy (≥5 entries documented). | ½d / ~1 evening |
| **3** | Social-job sources (LI Posts + X + Reddit). Skill-substitution graph + embeddings. Thumbs UI + `eval_labels` table. | **First 100 labels. Train/dev/test split. First promptfoo deterministic checks.** | ½d build + ½d evals / weekend |
| **4** | Recruiter discovery pipeline. | **First LLM-as-judge calibrated to κ ≥ 0.80. Cross-family judge. Bias mitigations validated.** | 1d + ½d evals / weekend |
| **5** | Application drafter + state machine + 22:00 digest. | **Rubric-based judge for cover-letter quality. First 10 hand-written gold cover letters.** | ½d / 1 evening |
| **6** | MCP server. | **Nightly eval worker + PostHog dashboard + GitHub Actions CI gate.** | ½d + ½d evals / weekend |
| **7 stretch** | Langfuse self-host on a VPS | Full MLOps observability stack — resume gold | ½d / 1 evening |

**Practitioner total: ~4 days. Beginner-honest total: 5–8 weekends.** That's not slower-because-you're-dumb; it's slower-because-you're-also-learning-AI-engineering. Both are progress.

---

## 6. Eval scaffolding (already authored at `~/Desktop/job-radar-evals/`)

All 6 Blockers from the pre-build audit are already closed. The docs that exist:

- `README.md` — index + methodology + reading order
- `trace_schema.md` — `$ai_generation` payload spec with prompt-version SHA
- `baselines.md` — zero + smart baseline per component
- `dataset_methodology.md` — 70/30 dev/test, frozen test rule, kappa, Wilson CIs
- `success_criteria.md` — pre-registered metrics + CI gates per component
- `structured_output_policy.md` — Zod schemas, retries, fallback, manual review queue
- `failure_taxonomy_template.md` — FM-NNN schema with worked example

Beginner-onboarding companions (next batch — being authored now):
- `index.html` — visual entry point
- `glossary.md`, `quickstart.md`, `prompt_engineering_primer.md`
- `qa_to_ai_evals_dictionary.md`, `interpreting_first_50_traces.md`
- `promptfoo_starter.md`, `posthog_llm_analytics_starter.md`, `lib_eval_stats_explained.md`
- `judges/example_region_judge.md`, `walkthroughs/end_to_end_example.md`
- `dry_run_case_study.md` — Hamel/Shreya methodology applied to Mate-in-Croatia

---

## 7. Cost estimate

| Item | $/mo |
|---|---|
| Vercel / Supabase / Inngest | $0 (free tiers) |
| Apify (LI Jobs + Posts + Wellfound) | $5–15 |
| X API pay-per-use | $2–5 |
| Reddit | $0 |
| Claude Haiku + GPT-4o-mini (eval judge) | $5–12 |
| OpenAI embeddings | $1 |
| Resend | $0 (free) |
| **Total** | **~$13–33/mo** |

Compare: Teal $39/mo, Sonara $26/mo. None solve your three actual problems.

---

## 8. The hireable outcome

After Phase 6 you have:
- A daily-use tool that solves your real problem
- A public GitHub repo with `evals/` directory: failure taxonomy, labeled dataset (PII-redacted), calibrated judge prompts with κ numbers, experiment writeups with before/after metrics
- 3–5 blog posts (error-analysis writeup, judge-calibration writeup, "verbosity bias killed my cover-letter eval" writeup)
- One eval-score-over-time chart annotated with each shipped release
- The QA-engineer-to-AI-Evals-Engineer translation in your bio

That portfolio + your QA background = recruiter contact from AI labs. Concretely hireable for "Research Engineer, Frontier Evals" / "LLM Evaluation Engineer" / "AI QA Engineer" titles at $14–107/hr (ZipRecruiter, May 2026).

---

## 9. Open issues to resolve before Phase 1

- [ ] Confirm Anthropic API key budget cap (~$20/mo soft limit)
- [ ] Confirm OpenAI account exists for embeddings + GPT-4o-mini judge
- [ ] Apify account creation (free tier credits cover Phase 1–2 testing)
- [ ] Reddit OAuth app registration
- [ ] User-profile JSON authored (skills with proficiency, allowed_regions, blacklist)
- [ ] First adversarial JD examples crafted (~5; grows over time)

That checklist plus the quickstart doc = Day 1 setup.

---

## 10. Reading order when you sit down to start

1. This file
2. `~/Desktop/job-radar-evals/index.html` (open in browser)
3. `~/Desktop/job-radar-evals/quickstart.md`
4. `~/Desktop/job-radar-evals/glossary.md` (skim, then keep open in a tab as a reference)
5. `~/Desktop/job-radar-evals/dry_run_case_study.md` — to see how the loop looks in practice
6. Start Phase 1.
