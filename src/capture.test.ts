import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { captureOptionsFromFlags, redactCaptureRecord, writeProviderCapture } from "./capture.js";
import { fixtureRoot } from "./test-helpers.js";

const repo = {
  rootPath: "/tmp/repo",
  projectName: "repo",
  headSha: "abc123",
  remoteUrl: "https://example.test/repo.git",
  currentBranch: "main",
};

const provider = {
  name: "mock",
  model: null,
  reasoningEffort: null,
};

describe("capture", () => {
  it("stays disabled without an explicit capture directory", () => {
    expect(captureOptionsFromFlags({})).toBeNull();
  });

  it("writes accepted provider captures with redacted prompt and output fields", async () => {
    const dir = await fixtureRoot("capture-");
    await writeProviderCapture(
      { dir, runId: "run-1" },
      {
        operation: "review",
        prompt: "Review this token sk-123456789012345678901234567890",
        schema: { type: "object" },
        rawOutput: { text: "Bearer abcdefghijklmnopqrstuvwxyz123456" },
        acceptedOutput: { findings: [] },
        validationStatus: "schema-valid-operation-valid",
        status: "accepted",
        provider,
        repo,
      },
    );

    const line = (await readFile(join(dir, "captures.jsonl"), "utf8")).trim();
    const record = JSON.parse(line) as {
      prompt: string;
      rawOutput: { text: string };
      redactionState: { redacted: boolean; matches: string[]; metadataOnly: boolean };
    };
    expect(record.prompt).not.toContain("sk-123456789012345678901234567890");
    expect(record.rawOutput.text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(record.redactionState.redacted).toBe(true);
    expect(record.redactionState.metadataOnly).toBe(false);
    expect(record.redactionState.matches).toContain("openai-api-key");
    expect(record.redactionState.matches).toContain("bearer-token");
  });

  it("downgrades unsafe private-key material to metadata-only rejected material", () => {
    const { state } = redactCaptureRecord({
      prompt: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    });

    expect(state.metadataOnly).toBe(true);
    expect(state.matches).toContain("private-key-block");
  });

  it("persists rejected captures as metadata-only eval material", async () => {
    const dir = await fixtureRoot("capture-rejected-");
    await writeProviderCapture(
      { dir, runId: "run-2" },
      {
        operation: "map",
        prompt: "Map project",
        schema: { type: "object" },
        rawOutput: null,
        acceptedOutput: null,
        validationStatus: "provider-error",
        status: "rejected",
        provider,
        repo,
        error: { message: "provider failed", code: "provider-failure" },
      },
    );

    const record = JSON.parse((await readFile(join(dir, "captures.jsonl"), "utf8")).trim()) as {
      prompt?: string;
      status: string;
      redactionState: { metadataOnly: boolean };
    };
    expect(record.status).toBe("rejected");
    expect(record.prompt).toBeUndefined();
    expect(record.redactionState.metadataOnly).toBe(true);
  });
});
