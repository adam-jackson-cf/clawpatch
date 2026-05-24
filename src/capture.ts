import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ensureDir, nowIso, writeJson } from "./fs.js";
import { runId, stableId } from "./id.js";

export type CaptureOperation = "map" | "review" | "revalidate";
export type CaptureStatus = "accepted" | "rejected";
export type CaptureValidationStatus =
  | "schema-valid-operation-valid"
  | "schema-valid-operation-rejected"
  | "schema-invalid"
  | "provider-error"
  | "metadata-only";

export type CaptureOptions = {
  dir: string;
  runId: string;
};

export type CaptureProviderMetadata = {
  name: string;
  model: string | null;
  reasoningEffort: string | null;
};

export type CaptureRepoMetadata = {
  rootPath: string;
  projectName: string;
  headSha: string | null;
  remoteUrl: string | null;
  currentBranch: string | null;
};

export type CaptureInput = {
  operation: CaptureOperation;
  prompt: string;
  schema: object;
  rawOutput: unknown;
  acceptedOutput: unknown;
  rejectedOutput?: unknown;
  validationStatus: CaptureValidationStatus;
  status: CaptureStatus;
  provider: CaptureProviderMetadata;
  repo: CaptureRepoMetadata;
  error?: { message: string; code: string | null } | null;
  tags?: string[];
};

export type RedactionState = {
  scanned: true;
  redacted: boolean;
  matches: string[];
  metadataOnly: boolean;
  reason: string | null;
};

const secretPatterns: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: "openai-api-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
    replacement: "sk-***REDACTED***",
  },
  {
    label: "anthropic-api-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/gu,
    replacement: "sk-ant-***REDACTED***",
  },
  {
    label: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu,
    replacement: "gh*_***REDACTED***",
  },
  {
    label: "hf-token",
    pattern: /\bhf_[A-Za-z0-9]{20,}\b/gu,
    replacement: "hf_***REDACTED***",
  },
  {
    label: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/gu,
    replacement: "AKIA***REDACTED***",
  },
  {
    label: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/gu,
    replacement: "Bearer ***REDACTED***",
  },
  {
    label: "env-secret-assignment",
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*["']?[^"'\s]{8,}["']?/gu,
    replacement: "$1=***REDACTED***",
  },
];

const unsafePatterns: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/u,
  },
];

export function captureOptionsFromFlags(
  flags: Record<string, string | boolean>,
): CaptureOptions | null {
  const flagDir = typeof flags["captureDir"] === "string" ? flags["captureDir"] : undefined;
  const envDir = process.env["CLAWPATCH_CAPTURE_DIR"];
  const dir = flagDir ?? (envDir === undefined || envDir.length === 0 ? undefined : envDir);
  if (dir === undefined) {
    return null;
  }
  return {
    dir: resolve(dir),
    runId: process.env["CLAWPATCH_CAPTURE_RUN_ID"] ?? runId(),
  };
}

export async function writeProviderCapture(
  options: CaptureOptions | null,
  input: CaptureInput,
): Promise<string | null> {
  if (options === null) {
    return null;
  }
  await ensureDir(options.dir);
  const createdAt = nowIso();
  const initial = {
    schemaVersion: 1,
    captureId: stableId("cap", [
      options.runId,
      input.operation,
      input.provider.name,
      input.repo.rootPath,
      input.prompt,
      createdAt,
    ]),
    captureRunId: options.runId,
    createdAt,
    operation: input.operation,
    status: input.status,
    validationStatus: input.validationStatus,
    provider: input.provider,
    repo: input.repo,
    prompt: input.prompt,
    schema: input.schema,
    rawOutput: input.rawOutput,
    acceptedOutput: input.acceptedOutput,
    rejectedOutput: input.rejectedOutput ?? null,
    error: input.error ?? null,
    tags: input.tags ?? [],
  };
  const { value, state } = redactCaptureRecord(initial);
  const record =
    state.metadataOnly || input.status === "rejected"
      ? metadataOnlyRecord(
          value as Record<string, unknown>,
          state,
          input.status,
          input.validationStatus,
        )
      : { ...value, redactionState: state };
  await appendFile(join(options.dir, "captures.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  await updateCaptureSummary(options.dir, record);
  return join(options.dir, "captures.jsonl");
}

export function redactCaptureRecord<T>(record: T): { value: T; state: RedactionState } {
  const rendered = JSON.stringify(record);
  const unsafe = unsafePatterns.find(({ pattern }) => pattern.test(rendered));
  if (unsafe !== undefined) {
    return {
      value: record,
      state: {
        scanned: true,
        redacted: false,
        matches: [unsafe.label],
        metadataOnly: true,
        reason: `unsafe ${unsafe.label} requires metadata-only persistence`,
      },
    };
  }
  const matches = new Set<string>();
  const value = redactValue(record, matches) as T;
  return {
    value,
    state: {
      scanned: true,
      redacted: matches.size > 0,
      matches: [...matches].toSorted(),
      metadataOnly: false,
      reason: null,
    },
  };
}

function redactValue(value: unknown, matches: Set<string>): unknown {
  if (typeof value === "string") {
    let output = value;
    for (const { label, pattern, replacement } of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(output)) {
        matches.add(label);
        pattern.lastIndex = 0;
        output = output.replace(pattern, replacement);
      }
    }
    return output;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, matches));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, matches)]),
    );
  }
  return value;
}

function metadataOnlyRecord(
  record: Record<string, unknown>,
  state: RedactionState,
  status: CaptureStatus,
  validationStatus: CaptureValidationStatus,
): Record<string, unknown> {
  return {
    schemaVersion: record["schemaVersion"],
    captureId: record["captureId"],
    captureRunId: record["captureRunId"],
    createdAt: record["createdAt"],
    operation: record["operation"],
    status,
    validationStatus: state.metadataOnly ? "metadata-only" : validationStatus,
    provider: record["provider"],
    repo: record["repo"],
    error: record["error"],
    tags: record["tags"],
    redactionState: state.metadataOnly
      ? state
      : {
          ...state,
          metadataOnly: true,
          reason: state.reason ?? "rejected capture persisted as metadata-only eval material",
        },
  };
}

async function updateCaptureSummary(dir: string, record: Record<string, unknown>): Promise<void> {
  const path = join(dir, "summary.json");
  const previous = await readSummary(path);
  const operation = typeof record["operation"] === "string" ? record["operation"] : "unknown";
  const status = typeof record["status"] === "string" ? record["status"] : "unknown";
  const redaction = record["redactionState"] as RedactionState | undefined;
  const summary = {
    schemaVersion: 1,
    updatedAt: nowIso(),
    captures: previous.captures + 1,
    accepted: previous.accepted + (status === "accepted" ? 1 : 0),
    rejected: previous.rejected + (status === "rejected" ? 1 : 0),
    metadataOnly: previous.metadataOnly + (redaction?.metadataOnly === true ? 1 : 0),
    redacted: previous.redacted + (redaction?.redacted === true ? 1 : 0),
    byOperation: {
      ...previous.byOperation,
      [operation]: (previous.byOperation[operation] ?? 0) + 1,
    },
  };
  await writeJson(path, summary);
}

async function readSummary(path: string): Promise<{
  captures: number;
  accepted: number;
  rejected: number;
  metadataOnly: number;
  redacted: number;
  byOperation: Record<string, number>;
}> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      captures?: unknown;
      accepted?: unknown;
      rejected?: unknown;
      metadataOnly?: unknown;
      redacted?: unknown;
      byOperation?: unknown;
    };
    return {
      captures: typeof parsed.captures === "number" ? parsed.captures : 0,
      accepted: typeof parsed.accepted === "number" ? parsed.accepted : 0,
      rejected: typeof parsed.rejected === "number" ? parsed.rejected : 0,
      metadataOnly: typeof parsed.metadataOnly === "number" ? parsed.metadataOnly : 0,
      redacted: typeof parsed.redacted === "number" ? parsed.redacted : 0,
      byOperation:
        typeof parsed.byOperation === "object" && parsed.byOperation !== null
          ? (parsed.byOperation as Record<string, number>)
          : {},
    };
  } catch {
    return {
      captures: 0,
      accepted: 0,
      rejected: 0,
      metadataOnly: 0,
      redacted: 0,
      byOperation: {},
    };
  }
}
