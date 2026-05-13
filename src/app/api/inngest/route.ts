import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { remotivePoll } from "@/inngest/functions/remotive-poll";
import { normalizeJob } from "@/inngest/functions/normalize-job";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [remotivePoll, normalizeJob],
});
