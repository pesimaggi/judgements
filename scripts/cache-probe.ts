/**
 * Does the research loop actually read its transcript from cache?
 *
 * The loop resends the whole conversation every round, so what it costs is
 * decided by whether those resent tokens are billed at full price or at a
 * tenth of it. That is not visible in the code — `cache_control` is a request
 * you make, not a guarantee you get — and it is not visible in an answer
 * either. It is visible in exactly four numbers the API returns, which is what
 * this prints.
 *
 * **This spends real money.** It makes three small model calls against
 * whichever provider `ASK_PROVIDER` selects. A few thousand tokens, so cents
 * rather than pounds, but it is a real bill and it needs a real key.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... ASK_PROVIDER=anthropic \
 *     node --import tsx scripts/cache-probe.ts
 *
 * It deliberately does not go through the real research tools: those read the
 * database and would make the result depend on the corpus. The tool here
 * returns a fixed block of filler, sized like a real `read_provision` result,
 * so the only thing under test is whether the transcript caches.
 *
 * Exits non-zero when the second round reads nothing from cache, which is the
 * failure this exists to catch.
 */
import { getAskModel, type AskUsage } from "../src/lib/ask/llm";

/** About the size of a real read_provision result (config.deep.provisionChars). */
const FILLER = "Lagatexti til prófunar. ".repeat(640);

async function main() {
  const model = getAskModel();
  if (!model.runTools) {
    console.error("This provider has no tool loop; nothing to probe.");
    process.exitCode = 1;
    return;
  }

  const rounds: AskUsage[] = [];

  await model.runTools({
    system:
      "Þú ert prófunarlota. Kallaðu á read_fixture þrisvar, einu sinni í hverri umferð, " +
      "með id 'a', svo 'b', svo 'c'. Skrifaðu ekkert annað.",
    messages: [{ role: "user", content: "Byrjaðu." }],
    tools: [
      {
        name: "read_fixture",
        description: "Returns a fixed block of text. For probing cache behaviour only.",
        schema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
      },
    ],
    maxTokens: 2000,
    effort: "low",
    maxRounds: 4,
    execute: async () => FILLER,
    onUsage: (usage: AskUsage) => rounds.push(usage),
  });

  const row = (i: number, u: AskUsage) =>
    `  round ${i + 1}:  input ${String(u.inputTokens ?? 0).padStart(7)}` +
    `   cache read ${String(u.cachedInputTokens ?? 0).padStart(7)}` +
    `   output ${String(u.outputTokens ?? 0).padStart(6)}`;

  console.log("\nPer-round usage:");
  rounds.forEach((u, i) => console.log(row(i, u)));

  const later = rounds.slice(1);
  const read = later.reduce((n, u) => n + (u.cachedInputTokens ?? 0), 0);
  const fresh = later.reduce((n, u) => n + (u.inputTokens ?? 0), 0);

  console.log(
    `\nAfter the first round: ${read} tokens read from cache, ${fresh} billed fresh.`
  );

  if (rounds.length < 2) {
    console.error("\nThe model finished in one round, so nothing was resent. Re-run.");
    process.exitCode = 1;
    return;
  }
  if (read === 0) {
    console.error(
      "\nFAIL — nothing was read from cache. The transcript is being re-billed in full\n" +
        "every round. Look for a cache-breaker: `effort` or `thinking` changing between\n" +
        "rounds, or something rewriting the messages array behind the newest turn."
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Cache is working: the resent transcript is billed at a tenth of ${read} tokens\n` +
      "instead of full price. Run this before and after the change to see the difference."
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
