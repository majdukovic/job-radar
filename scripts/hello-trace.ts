// env vars loaded by `dotenv -e .env.local` (see package.json script)
import { normalizeJd } from "../src/lib/llm";
import { getPostHog } from "../src/lib/posthog";

const SAMPLE_JD = `Senior QA Engineer — Remote (Europe-based)

We're hiring a mid-to-senior QA engineer to join our distributed mobile team.

Must-have:
- 4+ years of mobile automation experience
- Strong Appium skills
- Java or Kotlin proficiency
- Experience with iOS and Android device farms

Nice-to-have:
- Cypress (for occasional web testing)
- Performance testing experience
- CI/CD pipeline knowledge (GitHub Actions, Jenkins)

Location: Fully remote within EMEA timezones. We'll sponsor visas for Schengen-area candidates if needed.
`;

async function main() {
  console.log("Calling normalizeJd on sample JD...");
  const { traceId, outputParsed, schemaValid } = await normalizeJd(SAMPLE_JD, {
    sourcePlatform: "test",
  });

  console.log("\nTrace ID:", traceId);
  console.log("Schema valid:", schemaValid);
  console.log("Parsed output:");
  console.log(JSON.stringify(outputParsed, null, 2));

  console.log("\nFlushing PostHog events...");
  const ph = getPostHog();
  await ph.flush();
  await ph.shutdown();
  console.log("Done. Check PostHog → Activity → Explore (all events) first.");
  console.log("If you see $ai_generation there, also check LLM Observability → Traces.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
