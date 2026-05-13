import { getSupabaseServer, JobRow } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getJobs(): Promise<JobRow[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("region_fit", true)
    .order("overall_fit_score", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as JobRow[];
}

async function getJobCounts() {
  const supabase = getSupabaseServer();
  const [{ count: total }, { count: normalized }, { count: regionFit }] = await Promise.all([
    supabase.from("jobs").select("*", { count: "exact", head: true }),
    supabase.from("jobs").select("*", { count: "exact", head: true }).eq("state", "normalized"),
    supabase.from("jobs").select("*", { count: "exact", head: true }).eq("region_fit", true),
  ]);
  return { total: total ?? 0, normalized: normalized ?? 0, regionFit: regionFit ?? 0 };
}

export default async function JobsPage() {
  const [jobs, counts] = await Promise.all([getJobs(), getJobCounts()]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">job-radar</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {counts.regionFit} region-fit / {counts.normalized} normalized / {counts.total} total
        </p>
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">
          <p>No region-fit jobs yet.</p>
          <p className="mt-2 text-xs">
            Trigger <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">remotive-poll</code>{" "}
            in the Inngest dev UI to ingest, then refresh.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="rounded-lg border border-neutral-200 p-4 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold">
                    {job.title ?? job.raw_title}
                  </h2>
                  <p className="text-sm text-neutral-500">
                    {job.company ?? job.raw_company ?? "—"}{" "}
                    {job.allowed_regions?.length ? (
                      <>· {job.allowed_regions.join(", ")}</>
                    ) : null}
                    {job.seniority ? <> · {job.seniority}</> : null}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-2xl font-bold tabular-nums">
                    {job.overall_fit_score ?? "—"}
                  </div>
                  <div className="text-xs text-neutral-500">fit / 100</div>
                </div>
              </div>

              {job.required_skills?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {job.required_skills.map((s) => (
                    <span
                      key={s}
                      className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                <span>{job.raw_source}</span>
                <span>·</span>
                <span>{new Date(job.scraped_at).toLocaleString()}</span>
                {job.source_url ? (
                  <>
                    <span>·</span>
                    <a
                      href={job.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      open on {job.raw_source} →
                    </a>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
