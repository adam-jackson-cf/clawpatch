import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { initCommand, makeContext, mapCommand, reviewCommand, revalidateCommand } from "./app.js";
import { readFeatures, statePaths } from "./state.js";
import { fixtureRoot, testOptions, writeFixture } from "./test-helpers.js";

describe("capture workflow", () => {
  it("captures map, review, and revalidate only when capture is enabled", async () => {
    const root = await fixtureRoot("capture-workflow-");
    await writeFixture(root, "package.json", JSON.stringify({ name: "capture-workflow" }));
    await writeFixture(root, "agent/worker.custom", "export const value = 'TODO_BUG';\n");
    await writeFixture(root, "agent/scheduler.custom", "export const other = 1;\n");
    await writeFixture(root, "agent/worker.test.custom", "expect(value).toBeDefined();\n");
    const context = await makeContext(testOptions(root));
    await initCommand(context, {});

    await mapCommand(context, { source: "agent", provider: "mock", skipGitRepoCheck: true });
    const disabledCapture = await readFile(join(root, "captures.jsonl"), "utf8").catch(() => "");
    expect(disabledCapture).toBe("");

    const captureDir = join(root, "..", `captures-${basename(root)}`, "run-1");
    await mapCommand(context, {
      source: "agent",
      provider: "mock",
      skipGitRepoCheck: true,
      captureDir,
    });
    const feature = (await readFeatures(statePaths(join(root, ".clawpatch")))).find((candidate) =>
      candidate.ownedFiles.some((file) => file.path === "agent/worker.custom"),
    );
    expect(feature).toBeDefined();
    await reviewCommand(context, {
      feature: feature!.featureId,
      provider: "mock",
      skipGitRepoCheck: true,
      captureDir,
    });
    await revalidateCommand(context, {
      all: true,
      provider: "mock",
      skipGitRepoCheck: true,
      captureDir,
    });

    const records = (await readFile(join(captureDir, "captures.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { operation: string; status: string });
    expect(records.map((record) => record.operation)).toEqual(["map", "review", "revalidate"]);
    expect(records.every((record) => record.status === "accepted")).toBe(true);
  });
});
