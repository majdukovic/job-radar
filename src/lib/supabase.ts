import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _server: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the SERVICE_ROLE key.
 * Never expose this client in a browser bundle — it bypasses RLS.
 */
export function getSupabaseServer(): SupabaseClient {
  if (!_server) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local"
      );
    }
    _server = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _server;
}

// ─── DB row types ────────────────────────────────────────────────────

export type JobRow = {
  id: number;
  raw_source: string;
  source_id: string;
  source_url: string | null;
  raw_title: string | null;
  raw_company: string | null;
  raw_text: string;
  scraped_at: string;
  title: string | null;
  company: string | null;
  is_actually_remote: boolean | null;
  allowed_regions: string[] | null;
  excluded_regions: string[] | null;
  required_skills: string[] | null;
  nice_to_have_skills: string[] | null;
  seniority: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  visa_sponsorship: string | null;
  confidence_score: number | null;
  normalizer_trace_id: string | null;
  region_fit: boolean | null;
  skill_match_score: number | null;
  overall_fit_score: number | null;
  score_explanation: string | null;
  state: string;
};

export type UserProfile = {
  id: number;
  allowed_regions: string[];
  excluded_regions: string[];
  skills: { name: string; proficiency: number }[];
  seniority_target: string | null;
  min_salary_usd: number | null;
  blacklist_companies: string[];
};
