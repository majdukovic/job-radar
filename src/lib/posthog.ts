import { PostHog } from "posthog-node";

let client: PostHog | null = null;

export function getPostHog(): PostHog {
  if (!client) {
    if (!process.env.POSTHOG_API_KEY) {
      throw new Error("POSTHOG_API_KEY missing from environment");
    }
    client = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
    });
  }
  return client;
}
