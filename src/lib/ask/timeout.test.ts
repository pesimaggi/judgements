/**
 * Per-stage time budgets.
 *
 * The failure this prevents is the worst one available: a stage hangs, the
 * reader watches a bucket go down a well until their browser gives up, and
 * nothing is ever logged because nothing ever failed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { withTimeout, withTimeoutOr, AskTimeout } from "@/lib/ask/timeout";

const never = () => new Promise<string>(() => {});
const soon = (value: string) => Promise.resolve(value);

describe("withTimeout", () => {
  test("passes a result straight through", async () => {
    assert.equal(await withTimeout(soon("ok"), 1000, "answer"), "ok");
  });

  test("rejects with a stage name once the budget is spent", async () => {
    await assert.rejects(withTimeout(never(), 20, "answer"), (e: AskTimeout) => {
      assert.equal(e.name, "AskTimeout");
      assert.equal(e.stage, "answer");
      assert.equal(e.ms, 20);
      return true;
    });
  });

  test("passes an error through as itself, not as a timeout", async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error("upstream 500")), 1000, "answer"),
      /upstream 500/
    );
  });

  test("does not hold the process open for the length of a budget it did not need", async () => {
    // If the timer were left running, this test file would take a minute to
    // exit rather than finishing immediately.
    await withTimeout(soon("ok"), 60_000, "answer");
    assert.ok(true);
  });
});

describe("withTimeoutOr", () => {
  test("returns the fallback when the stage times out", async () => {
    assert.equal(await withTimeoutOr(never, 20, "planning", "fallback"), "fallback");
  });

  test("returns the fallback when the stage throws", async () => {
    assert.equal(
      await withTimeoutOr(
        async () => {
          throw new Error("planner is down");
        },
        1000,
        "planning",
        "fallback"
      ),
      "fallback"
    );
  });

  test("reports what went wrong, so the metrics line can record it", async () => {
    let seen: unknown;
    await withTimeoutOr(never, 20, "planning", "fallback", (e) => {
      seen = e;
    });
    assert.ok(seen instanceof AskTimeout);
  });

  test("returns the real result when the stage works", async () => {
    assert.equal(await withTimeoutOr(() => soon("real"), 1000, "planning", "fallback"), "real");
  });
});
