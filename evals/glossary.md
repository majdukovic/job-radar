# Glossary

> Keep this tab open while reading other docs. The shortest possible accurate definition for every term used elsewhere.

---

## Statistics & evaluation metrics

**Accuracy** — proportion of predictions that were correct. Misleading when classes are imbalanced (a "always say no" predictor on a 90/10 dataset gets 90% accuracy).

**Precision** — of the things the model said are positive, what fraction actually are? Optimize this when **false positives are expensive** (e.g. recommending fake-remote jobs wastes user time).

**Recall** — of the things that are actually positive, what fraction did the model catch? Optimize this when **false negatives are expensive** (e.g. missing a real EU-friendly job means lost opportunity).

**F1** — harmonic mean of precision and recall. Use when you care about both equally. Formula: `2 × (P × R) / (P + R)`.

**Confusion matrix** — 2×2 table of true positives / false positives / true negatives / false negatives. The base for computing precision/recall/F1.

**Cohen's kappa (κ)** — agreement between two raters (human-vs-human, human-vs-judge) corrected for chance. Raw agreement is misleading when classes are skewed. κ ranges roughly: < 0.2 poor, 0.2–0.4 fair, 0.4–0.6 moderate, 0.6–0.8 substantial, 0.8–1.0 near-perfect.

**Wilson confidence interval** — the modern recommended way to put error bars on a proportion. "Our region precision is 0.92 [0.88–0.95]" — the 88–95 is the 95% Wilson interval. Beats the old "± standard error" method especially at small N.

**Bootstrap** — resampling your data with replacement 1000 times to compute a confidence interval for any metric (works for kappa, F1, anything). When in doubt, bootstrap.

**Statistical significance** — your delta isn't noise. Conventional bar: p < 0.05 (5% chance the observed difference happened by luck).

**Holm-Bonferroni correction** — when you check 6 things at once at p < 0.05, the chance one *falsely* trips is ~26%. Holm-Bonferroni adjusts the threshold so the *family-wise* error stays at 5%. Use it when checking many components per release.

**Spearman ρ (rho)** — correlation between two rankings (not raw values, just order). Use for skill_matcher: "does the LLM rank the same jobs higher as I do?"

**Jaccard similarity** — overlap between two sets, `|A ∩ B| / |A ∪ B|`. Used for "top-3 overlap" or "skill bag overlap."

---

## Eval taxonomy

**Offline eval** — runs on a fixed dataset, in dev or CI, before shipping. Catches regressions.

**Online eval** — runs on real production traffic, samples some % of calls, monitors drift.

**Reference-based** — you have ground truth labels (correct answers). Compute F1, precision, recall.

**Reference-free** — no ground truth, just a rubric. Use LLM-as-judge against the rubric.

**Pointwise eval** — score each output absolutely (1–5 rubric, or 0–100 fit score).

**Pairwise eval** — compare two outputs head-to-head, pick the better one. Often more reliable than pointwise because humans rank more consistently than they score.

**Calibration** — has your judge been validated against human labels? A judge with κ < 0.7 vs you is worse than useless.

**Drift** — the data distribution (or the model behind the API) changes over time. Your eval set looks the same but production behavior shifts.

**Regression (eval sense)** — a code/prompt change made a previously-passing eval fail. Different from web-app regression testing in that the metric is continuous, not binary.

---

## LLM-as-judge biases

**Position bias** — judge prefers the first option in a pairwise comparison ~40% of the time more than the second, regardless of content. Mitigation: randomize order, run both orderings.

**Verbosity bias** — judge prefers longer outputs even when shorter is more correct. ~15% inflation. Mitigation: length-aware rubric, or normalize for length.

**Self-preference bias** — a judge from the same model family as the generator scores it 5–7% higher than it should. Mitigation: **cross-family judge** (Claude judges GPT, GPT judges Claude).

**Sycophancy** — judge agrees with whatever the prompt seems to want. Mitigation: neutral prompt phrasing, no "is this good?" framing.

---

## Prompt-engineering terms

**Zero-shot** — prompt with instructions only, no examples. Cheapest, weakest.

**Few-shot** — prompt with 2–8 input/output example pairs. Usually beats zero-shot dramatically.

**Chain-of-thought (CoT)** — prompt asks the model to reason step-by-step before final answer. Improves accuracy on complex tasks. Slight latency/cost cost.

**System prompt vs user prompt** — Anthropic / OpenAI split. System sets behavior ("You are a careful extractor of structured data..."). User contains the actual task. System prompts are sticky across turns.

**Temperature** — randomness knob, 0.0–1.0. Set 0.0 for extraction/classification (deterministic). Set 0.5–0.8 for creative generation (cover letters).

**Structured outputs / tool-use mode** — provider-native modes that constrain output to a JSON schema. Anthropic = tool-use with a single forced tool. OpenAI = `response_format: { type: "json_schema" }`. Much more reliable than free-text JSON parsing.

**Hallucination** — model invents facts not in the input. Critical to detect in cover letters (fake experience).

**Token** — the unit the model bills for. Roughly 0.75 of an English word. 1000 tokens ≈ 750 words.

---

## Architecture / tooling

**Embedding** — a fixed-length vector (e.g. 1536 numbers) representing the meaning of a text. Similar texts → similar vectors. Used for semantic search and similarity scoring.

**pgvector** — Postgres extension that stores embeddings + supports cosine-similarity queries. Free; comes with Supabase.

**Cosine similarity** — angle-based distance between two embeddings, range -1 to 1 (1 = identical meaning, 0 = unrelated). The standard similarity metric for embeddings.

**RAG (Retrieval-Augmented Generation)** — fetch relevant chunks from a database, stuff them into the prompt. Not used in job-radar's main flow but might appear in cover-letter drafter.

**OAuth** — standard auth flow where one app gets permission to access your account on another (Reddit OAuth lets job-radar read posts as you).

**ULID** — Universally Unique Lexicographically-sortable Identifier. Like UUID but sorts by time. Better for trace IDs than UUID v4.

**MCP (Model Context Protocol)** — Anthropic's standard for letting Claude Code (and others) call your tools / read your data. Each MCP server exposes resources + tools.

**OTEL (OpenTelemetry)** — vendor-neutral standard for tracing distributed systems. Langfuse uses it. PostHog supports it.

**Inngest** — durable background-job platform. Like cron + retry + dashboard, no infra to manage.

**Apify** — marketplace for hosted web scrapers ("actors"). Pay-per-run pricing. You don't host or maintain scrapers.

**Supabase** — Postgres + auth + storage + edge functions, hosted. Free tier generous.

**Zod** — TypeScript schema validation library. Define a schema once, get runtime validation + a TypeScript type for free.

**Resend** — transactional email API. Free tier covers personal use.

---

## Methodology terms (Hamel / Shreya)

**Error analysis** — manually reviewing 20–50 LLM outputs and taking journal-style notes. The #1 highest-leverage habit in eval engineering.

**Failure taxonomy** — categorized list of distinct failure modes discovered from error analysis. Each mode gets an ID, severity, frequency, status.

**Benevolent dictator** — the one person whose judgment defines quality. In a startup, the PM. For job-radar, you.

**Open-coding** — qualitative-research term for free-form note-taking before you have categories. You open-code first, cluster later.

**Mixed-initiative** — Shreya Shankar's framing: human and LLM co-construct the rubric, neither does it alone.

---

## Software engineering terms (probably you know these but listing for completeness)

**SHA** — Git's short hash, e.g. `a3f2b9c`. We use it for prompt versioning: which exact prompt text produced this output.

**CI / CI gate** — automated checks on every commit that must pass before merge. job-radar's CI runs promptfoo against the dev set.

**Cron** — scheduled background task. Inngest's `function.cron("0 22 * * *")` runs daily at 22:00.

**Env var** — environment variable. Where API keys live. Never commit to git.

**RLS (Row-Level Security)** — Supabase's per-row permission model. Single-seat app — turn it OFF for simplicity, on for multi-tenant.

---

## You probably know these but they're used a lot

| Term | Meaning |
|---|---|
| JD | Job Description |
| ICP | Ideal Customer Profile (we steal the term: "Ideal Candidate Profile" — your skills + region + level) |
| ATS | Applicant Tracking System (the recruiter software that ingests CVs) |
| InMail | LinkedIn's paid DM feature |
| SDET | Software Development Engineer in Test (you-but-with-better-pay) |

---

## When you hear a term not on this list

Add it here. The glossary grows with the project. Open a PR ("docs: add term X to glossary") as part of your weekly rhythm.
