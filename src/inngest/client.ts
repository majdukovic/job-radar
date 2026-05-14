import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "job-radar",
  isDev: process.env.NODE_ENV !== "production",
});

export type Events = {
  "job/inserted": { data: { jobId: number } };
};
