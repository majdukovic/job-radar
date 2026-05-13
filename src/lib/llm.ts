import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import { z } from "zod";
import { getPostHog } from "./posthog";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JD_NORMALIZER_V1_PATH = join(process.cwd(), "prompts/jd_normalizer/v1.md");
const JD_NORMALIZER_V1 = readFileSync(JD_NORMALIZER_V1_PATH, "utf8");

export const JdNormalizerSchemaV1 = z.object({
  title: z.string(),
  is_actually_remote: z.boolean(),
  allowed_regions: z.array(z.string()),
  required_skills: z.array(z.string()),
  confidence_score: z.number().min(0).max(1),
});

export type JdNormalizerOutputV1 = z.infer<typeof JdNormalizerSchemaV1>;

function estimateHaikuCost(usage: { input_tokens: number; output_tokens: number }): number {
  // Claude Haiku 4.5 pricing as of 2026-05; verify on https://www.anthropic.com/pricing
  return (usage.input_tokens * 0.25 + usage.output_tokens * 1.25) / 1_000_000;
}

// Strip ```json ... ``` or ``` ... ``` fences the model sometimes emits despite
// the prompt saying not to. Real fix in Phase 1 is to switch to Anthropic
// tool-use mode (see evals/structured_output_policy.md).
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

export async function normalizeJd(
  jdText: string,
  opts: { correlationId?: string; sourcePlatform?: string } = {},
): Promise<{ traceId: string; outputParsed: JdNormalizerOutputV1 | null; schemaValid: boolean }> {
  const traceId = ulid();
  const correlationId = opts.correlationId ?? traceId;
  const sourcePlatform = opts.sourcePlatform ?? "manual";
  const t0 = Date.now();
  const prompt = JD_NORMALIZER_V1.replace("{{JD_TEXT}}", jdText);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const outputRaw =
    response.content[0].type === "text" ? response.content[0].text : "";

  let outputParsed: JdNormalizerOutputV1 | null = null;
  let schemaValid = false;
  try {
    outputParsed = JdNormalizerSchemaV1.parse(JSON.parse(extractJson(outputRaw)));
    schemaValid = true;
  } catch (e) {
    console.warn(`[normalizeJd ${traceId}] schema validation failed:`, e);
  }

  const latencyMs = Date.now() - t0;
  const costUsd = estimateHaikuCost(response.usage);

  const ph = getPostHog();
  ph.capture({
    distinctId: "single-seat",
    event: "$ai_generation",
    properties: {
      // PostHog LLM Analytics standard fields ($ai_* prefix is required by the dashboard)
      $ai_trace_id: correlationId,
      $ai_span_id: traceId,
      $ai_span_name: "jd_normalizer",
      $ai_model: "claude-haiku-4-5-20251001",
      $ai_provider: "anthropic",
      $ai_input: [{ role: "user", content: prompt }],
      $ai_input_tokens: response.usage.input_tokens,
      $ai_output_choices: [{ role: "assistant", content: outputRaw }],
      $ai_output_tokens: response.usage.output_tokens,
      $ai_total_cost_usd: costUsd,
      $ai_latency: latencyMs / 1000, // PostHog expects seconds
      $ai_http_status: 200,
      $ai_is_error: false,
      $ai_model_parameters: { temperature: 0, max_tokens: 1024 },
      // job-radar custom fields (for our own filters and CI)
      component: "jd_normalizer",
      prompt_template_name: "jd_normalizer_v1",
      prompt_version: "sha:bootstrap",
      output_parsed: outputParsed,
      schema_valid: schemaValid,
      sampling_bit: Math.random(),
      retry_count: 0,
      source_platform: sourcePlatform,
    },
  });

  return { traceId, outputParsed, schemaValid };
}
