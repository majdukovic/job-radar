import { inngest } from "@/inngest/client";
import { getSupabaseServer, JobRow, UserProfile } from "@/lib/supabase";
import { normalizeJd } from "@/lib/llm";
import { getPostHog } from "@/lib/posthog";

export const normalizeJob = inngest.createFunction(
  {
    id: "normalize-job",
    name: "Normalize a job with LLM + score",
    retries: 1,
    concurrency: { limit: 3 }, // be gentle on Anthropic rate limits
    triggers: [{ event: "job/inserted" }],
  },
  async ({ event, step, logger }) => {
    const { jobId } = event.data;
    const supabase = getSupabaseServer();

    const job = await step.run("load-job", async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, raw_text, raw_source")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data as Pick<JobRow, "id" | "raw_text" | "raw_source">;
    });

    const userProfile = await step.run("load-user-profile", async () => {
      const { data, error } = await supabase
        .from("user_profile")
        .select("*")
        .eq("id", 1)
        .single();
      if (error) throw error;
      return data as UserProfile;
    });

    const normalized = await step.run("call-normalizer", async () => {
      return await normalizeJd(job.raw_text, {
        sourcePlatform: job.raw_source,
      });
    });

    // Region fit (Phase 1 hard filter)
    const regionFit = (() => {
      const allowed = normalized.outputParsed?.allowed_regions ?? [];
      const userAllowed = new Set(userProfile.allowed_regions.map(s => s.toLowerCase()));
      return allowed.some(r => userAllowed.has(r.toLowerCase()));
    })();

    // Skill match (Phase 1 basic, no substitution credit yet)
    const skillMatchScore = (() => {
      const required = normalized.outputParsed?.required_skills ?? [];
      if (required.length === 0) return null;
      const userSkills = new Set(
        userProfile.skills.map(s => s.name.toLowerCase())
      );
      const matches = required.filter(r => userSkills.has(r.toLowerCase())).length;
      return Math.round((matches / required.length) * 100);
    })();

    const overallFitScore = regionFit ? (skillMatchScore ?? 0) : 0;

    await step.run("write-normalized", async () => {
      const { error } = await supabase
        .from("jobs")
        .update({
          title: normalized.outputParsed?.title ?? null,
          is_actually_remote: normalized.outputParsed?.is_actually_remote ?? null,
          allowed_regions: normalized.outputParsed?.allowed_regions ?? null,
          required_skills: normalized.outputParsed?.required_skills ?? null,
          confidence_score: normalized.outputParsed?.confidence_score ?? null,
          normalizer_trace_id: normalized.traceId,
          region_fit: regionFit,
          skill_match_score: skillMatchScore,
          overall_fit_score: overallFitScore,
          state: normalized.schemaValid ? "normalized" : "normalize_failed",
        })
        .eq("id", job.id);
      if (error) throw error;
    });

    // Flush PostHog to ensure trace lands
    await getPostHog().flush();

    logger.info(
      `Normalized job ${job.id}: region_fit=${regionFit}, skill_match=${skillMatchScore}, schema_valid=${normalized.schemaValid}`,
    );

    return {
      jobId: job.id,
      regionFit,
      skillMatchScore,
      overallFitScore,
      traceId: normalized.traceId,
      schemaValid: normalized.schemaValid,
    };
  },
);
