# Prompt engineering primer

> Six patterns, one example each, all from job-radar. Read top-to-bottom once. After that, use it as a reference card while writing your first prompts.

---

## The two-minute mental model

LLMs are next-token predictors. Everything in the prompt — instructions, examples, format hints, role framing — biases that next-token prediction. The art is making the bias point at the answer you want **for inputs you haven't yet seen.**

The single biggest beginner mistake: writing a prompt that works on the input you tested, then assuming it generalizes. It usually doesn't. Generalization comes from:

1. **Structure** (system role, clear sections, structured outputs)
2. **Examples** (few-shot — the model copies patterns)
3. **Constraints** (enums, schemas, "if X then Y" rules)
4. **Iteration on diverse data** (this is what evals are for)

---

## Pattern 1 — System prompt vs user prompt

**Anthropic + OpenAI both split prompts into system (sets behavior) and user (carries the task).**

System content sticks across turns. User content is the per-call payload. Putting your role/persona/style guide in the system prompt and the task-specific text in user means your prompt is reusable.

```ts
const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  system: `You are a careful extractor of structured data from job postings.
You always return valid JSON. You never invent fields not present in the input.
You use the closed enum for regions: {Worldwide, EU, EMEA, US, LATAM, APAC, Other}.`,
  messages: [
    { role: "user", content: `Extract structured fields from this JD:\n\n${jdText}` }
  ],
});
```

**Rule of thumb**: instructions that apply to *every* call go in system. Variable inputs go in user.

---

## Pattern 2 — Few-shot examples

**Almost always: 2–5 example input/output pairs beats zero examples by a wide margin.**

The model copies the *shape* of the examples. So pick examples that:
- Cover your edge cases (one ambiguous, one tricky region, one weird title)
- Demonstrate the exact output format you want
- Are correct (a bad example is worse than no example)

```ts
const examples = [
  {
    role: "user" as const,
    content: `Extract:\n"Senior QA Engineer — Remote (Europe only)"`
  },
  {
    role: "assistant" as const,
    content: JSON.stringify({
      title: "Senior QA Engineer",
      is_actually_remote: true,
      allowed_regions: ["EU", "Europe"],
      required_skills: [],
      confidence_score: 0.85,
    })
  },
  {
    role: "user" as const,
    content: `Extract:\n"QA Automation Engineer — Remote, US-based residents only"`
  },
  {
    role: "assistant" as const,
    content: JSON.stringify({
      title: "QA Automation Engineer",
      is_actually_remote: false,    // not for the user
      allowed_regions: ["US"],
      required_skills: [],
      confidence_score: 0.95,
    })
  },
];

// Then the actual task
const messages = [
  ...examples,
  { role: "user", content: `Extract:\n${jdText}` },
];
```

**Trap**: don't pile in 20 examples. Returns diminish past 5; cost rises linearly. If you need 20, you need a fine-tune, not a prompt.

---

## Pattern 3 — Structured output (tool-use / JSON schema mode)

**For any prompt where you want JSON: use the provider's native structured-output mode, not free-text "return JSON."** Schema-failure rate drops by ~50%.

For Anthropic, use tool-use with a single forced tool:

```ts
const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  tools: [{
    name: "extract_job_fields",
    description: "Extract structured fields from a job posting",
    input_schema: {
      type: "object",
      required: ["title", "is_actually_remote", "allowed_regions",
                 "required_skills", "confidence_score"],
      properties: {
        title: { type: "string" },
        is_actually_remote: { type: "boolean" },
        allowed_regions: {
          type: "array",
          items: { enum: ["Worldwide", "EU", "EMEA", "US", "LATAM", "APAC", "Other"] }
        },
        required_skills: { type: "array", items: { type: "string" } },
        confidence_score: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  }],
  tool_choice: { type: "tool", name: "extract_job_fields" },  // force the tool
  messages: [{ role: "user", content: prompt }],
});

// Extract the JSON
const toolUse = response.content.find(c => c.type === "tool_use");
const parsed = toolUse?.input;  // already a typed object
```

For OpenAI, use `response_format: { type: "json_schema", json_schema: { ... } }`.

The enum on `allowed_regions` is doing real work — it physically prevents the model from inventing region names like "Remote-Friendly" or "US-Adjacent."

---

## Pattern 4 — Chain-of-thought (CoT) for harder reasoning

**For classification or extraction that requires multi-step reasoning, ask the model to reason before answering.**

But: the reasoning eats tokens. So make it explicit — "first reason, then answer" — and use a schema field that captures only the final answer:

```ts
const schema = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "Step-by-step analysis: what does the JD say about region, who can apply, why?"
    },
    is_actually_remote: { type: "boolean" },
    allowed_regions: { type: "array", items: { enum: [...] } },
    confidence_score: { type: "number" },
  },
};
```

The `reasoning` field is invisible to the rest of the app but improves the answer downstream. **For region_classifier specifically, CoT adds ~3 percentage points of precision** in published benchmarks.

**Trap**: don't add CoT to every component. For simple extraction (title, salary), it's overkill cost. Use CoT when the task involves "if A then B unless C."

---

## Pattern 5 — Self-check / self-correction

**Cheap-but-clever: ask the model to flag its own potential failures.**

```ts
const schema = {
  // … the normal fields
  uncertain_fields: {
    type: "array",
    items: { type: "string" },
    description: "Field names where you're unsure of the extraction"
  },
  ai_tells_self_check: {
    type: "array",
    items: { type: "string" },
    description: "Any phrases in your output that sound AI-generated; list them so a human can review"
  },
};
```

The mere act of asking "are you sure?" or "is this AI-tell-y?" surfaces problems the model would otherwise hide. The `uncertain_fields` array becomes a routing signal: high-uncertainty rows go to the manual-review queue.

---

## Pattern 6 — Constraint via negative examples

**For edge cases where the model keeps making the same wrong choice, include a counter-example.**

Discovered in error analysis: the model marks "Remote (Europe-based)" as US-only. You can fix this with a positive example (Pattern 2). But you can also pin it down with an explicit *don't*:

```
EXAMPLES OF MISTAKES TO AVOID:

Input: "Remote — must be based in Europe"
WRONG output: { "allowed_regions": ["US"] }
CORRECT output: { "allowed_regions": ["EU", "Europe"] }

Input: "Remote, EST hours required"
WRONG output: { "allowed_regions": ["EST"] }
CORRECT output: { "allowed_regions": ["US"], "timezone_constraints": "EST" }
```

Negative examples are extra-strong for systematic biases. Don't use them as your only examples (they confuse the model on positive cases); use them *in addition* to positive ones.

---

## Putting it together — job-radar's jd_normalizer v3 (target shape)

A complete production-grade prompt for the normalizer combines all 6 patterns:

```ts
const SYSTEM = `You are a careful extractor of structured data from job postings.
You always use the closed enums provided. You never invent skills or fields not present in the input.
You reason briefly before answering, then fill out the fields.
For region: a posting is "actually remote for the user" only if a Croatia/EU-based candidate can legally apply without relocation.`;

const EXAMPLES = [
  // 2 positive, 1 ambiguous, 1 negative — Patterns 2 + 6
  /* … see prompts/jd_normalizer/v3.md when you write it … */
];

const TOOL = {
  name: "extract_job_fields",
  input_schema: {
    /* full schema with enums — Pattern 3 */
    reasoning: { type: "string", description: "Step-by-step analysis" },  // Pattern 4
    // … extracted fields …
    uncertain_fields: { type: "array", items: { type: "string" } },        // Pattern 5
  },
};
```

That's the target. The first version you write will be simpler — and that's correct. **Prompts evolve from simple to right via evals, not from clever to right via intuition.**

---

## What NOT to do (beginner traps)

| Trap | What goes wrong |
|---|---|
| "Just ask GPT" | No structure, no examples, no schema. Schema-validity rate < 70%; downstream code breaks. |
| Cramming all instructions into the system prompt | Becomes unmaintainable; can't A/B compare individual rules. |
| "Polite" prompts ("Please could you...") | Wastes tokens; doesn't help; signals you haven't thought about the prompt as code. |
| Telling the model to be "creative" on extraction tasks | Hallucinations. Set temperature 0 for extraction, full stop. |
| Including the user's *real* CV in the prompt while iterating | Leaks PII into traces. Use a fake-CV fixture for prompt development. |
| Iterating on the example that worked yesterday | Overfits to one input. Always run the eval set after every change. |
| Long preamble before the JD | The model attends most to recent tokens. Put critical instructions near the end, before the JD. |

---

## How to write your first prompt for a new component

1. **Look at 5 inputs by hand.** Write what the correct output looks like for each. This is your few-shot pool.
2. **Identify the shape of the output.** Write the Zod schema first; the prompt comes after.
3. **Write the system prompt** in 5 lines. Role + key rules + output format.
4. **Pick 3 examples** from your hand-written pool. Diversity matters more than quantity.
5. **Wire the tool-use call** with the schema as the forced tool.
6. **Run on the other 2 examples you held out.** Did it work? If yes, run on 20 more from the real dataset. If 18+/20 are good, you have a working v1. If < 15/20, something is wrong with structure or examples — don't reach for more examples yet.
7. **Save as `prompts/<component>/v1.md`** with the prompt text + a date-versioned changelog at the top.
8. **Now and only now**: wire it into the app and start collecting traces for real evals.

---

## How prompts get versioned

Each prompt lives in its own file. Edit → commit → SHA changes → `prompt_version` field in your traces changes automatically (see `trace_schema.md`).

Example folder layout once you start:

```
prompts/
  jd_normalizer/
    v1.md           ← initial bootstrap prompt
    v2.md           ← added 2 European-region examples
    v3.md           ← switched to tool-use mode with enum
    CHANGELOG.md    ← short notes on what changed and why
  region_classifier/
    v1.md
  cover_letter_drafter/
    v1.md
```

You don't delete old versions. They're history, useful for re-running historical traces or rolling back.

---

## Further reading (when you want depth)

- [Anthropic Prompt Engineering Guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) — official, ~30 min
- [OpenAI's GPT best practices](https://platform.openai.com/docs/guides/prompt-engineering) — official, ~30 min
- Hamel Husain: ["The 100x Engineer of AI" blog series](https://hamel.dev/blog/) — eval-focused, ~3 hours total
- Eugene Yan: ["What We've Learned From A Year of Building with LLMs"](https://applied-llms.org/) — opinionated and excellent, ~1 hour

You don't need to read all of this before Phase 1. Skim the Anthropic guide; come back to the rest in Phase 3.
