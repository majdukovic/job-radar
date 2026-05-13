import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "job-radar" });

export type Events = {
  "job/inserted": { data: { jobId: number } };
};
