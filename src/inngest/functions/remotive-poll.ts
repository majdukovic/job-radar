import { inngest } from "@/inngest/client";
import { getSupabaseServer } from "@/lib/supabase";

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  tags: string[];
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
};

const REMOTIVE_QA_URL =
  "https://remotive.com/api/remote-jobs?category=qa&limit=100";

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|li|h\d|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const remotivePoll = inngest.createFunction(
  {
    id: "remotive-poll",
    name: "Poll Remotive QA jobs",
    retries: 2,
    // For dev: trigger manually from Inngest dashboard.
    // For prod: cron fires every 4 hours.
    triggers: [{ event: "manual/remotive-poll" }, { cron: "0 */4 * * *" }],
  },
  async ({ step, logger }) => {
    const data = await step.run("fetch-remotive", async () => {
      const res = await fetch(REMOTIVE_QA_URL, {
        headers: { "User-Agent": "job-radar/0.1 (personal use)" },
      });
      if (!res.ok) {
        throw new Error(`Remotive returned ${res.status}`);
      }
      const json = (await res.json()) as { jobs: RemotiveJob[] };
      return json.jobs;
    });

    logger.info(`Remotive returned ${data.length} jobs`);

    const result = await step.run("upsert-jobs", async () => {
      const supabase = getSupabaseServer();
      const rows = data.map((j) => ({
        raw_source: "remotive" as const,
        source_id: String(j.id),
        source_url: j.url,
        raw_title: j.title,
        raw_company: j.company_name,
        raw_text: [
          j.title,
          j.company_name ? `Company: ${j.company_name}` : null,
          j.candidate_required_location
            ? `Location: ${j.candidate_required_location}`
            : null,
          j.salary ? `Salary: ${j.salary}` : null,
          j.tags?.length ? `Tags: ${j.tags.join(", ")}` : null,
          "",
          stripHtml(j.description),
        ]
          .filter(Boolean)
          .join("\n"),
        scraped_at: new Date().toISOString(),
        state: "new",
      }));

      // Upsert — Postgres ON CONFLICT DO NOTHING via unique (raw_source, source_id)
      const { data: inserted, error } = await supabase
        .from("jobs")
        .upsert(rows, {
          onConflict: "raw_source,source_id",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) throw error;
      return { fetched: data.length, inserted: inserted?.length ?? 0, insertedIds: inserted?.map(r => r.id) ?? [] };
    });

    // Fire normalize-job for each NEW row only
    if (result.insertedIds.length > 0) {
      await step.sendEvent("queue-normalize", result.insertedIds.map((jobId: number) => ({
        name: "job/inserted",
        data: { jobId },
      })));
    }

    return { ...result, message: `Fetched ${result.fetched}, inserted ${result.inserted} new jobs` };
  },
);
