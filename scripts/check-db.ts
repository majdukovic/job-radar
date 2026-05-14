// Quick check: are .env.local keys valid + has db/schema.sql been run?
import { getSupabaseServer } from "../src/lib/supabase";

async function main() {
  const supabase = getSupabaseServer();

  console.log("→ Checking Supabase connection...");
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true });

  if (error) {
    if (error.message.includes("does not exist")) {
      console.error("\n❌ Table 'jobs' does not exist.");
      console.error("   Run db/schema.sql in the Supabase SQL editor:");
      console.error("   https://supabase.com/dashboard/project/<your-id>/sql/new");
      process.exit(1);
    }
    console.error("\n❌ Supabase error:", error.message);
    process.exit(1);
  }

  console.log(`✓ jobs table reachable. ${count ?? 0} rows.`);

  console.log("→ Checking user_profile...");
  const { data: profile, error: profileErr } = await supabase
    .from("user_profile")
    .select("allowed_regions, skills")
    .eq("id", 1)
    .single();

  if (profileErr) {
    console.error("❌ user_profile error:", profileErr.message);
    process.exit(1);
  }

  console.log(`✓ user_profile seeded.`);
  console.log(`  allowed_regions: ${profile.allowed_regions.join(", ")}`);
  console.log(`  skills: ${profile.skills.map((s: { name: string }) => s.name).join(", ")}`);

  console.log("\n✅ Database ready. You can start the dev servers.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
