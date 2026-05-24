#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(root, "..");
const teacherRunsRoot = join(workspaceRoot, "teacher-runs");
const runId = process.env.CLAWPATCH_CAPTURE_RUN_ID;
if (runId === undefined || runId.length === 0) {
  throw new Error("CLAWPATCH_CAPTURE_RUN_ID is required");
}
const captureDir = join(workspaceRoot, "captures", runId);
const target = Number(process.env.CLAWPATCH_TEACHER_ACCEPTED_TARGET ?? "250");
const concurrency = Number(process.env.CLAWPATCH_TEACHER_TOPUP_JOBS ?? "4");
const repos = (process.env.CLAWPATCH_TEACHER_REPOS ?? "click,ripgrep,hono")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

mkdirSync(captureDir, { recursive: true });

const features = repos.flatMap((repo) =>
  readFeatureIds(join(teacherRunsRoot, repo)).map((featureId) => ({
    repo,
    dir: join(teacherRunsRoot, repo),
    featureId,
  })),
);
if (features.length === 0) {
  throw new Error("no feature ids found for teacher top-up");
}

let cursor = 0;
while (acceptedCaptures() < target) {
  const remaining = target - acceptedCaptures();
  const batch = Array.from({ length: Math.min(concurrency, remaining) }, () => {
    const feature = features[cursor % features.length];
    cursor += 1;
    return feature;
  });
  await Promise.all(batch.map((feature) => reviewFeature(feature)));
  rewriteSummary();
}

rewriteSummary();
console.log(`accepted=${acceptedCaptures()}`);
console.log(`captureDir=${captureDir}`);

function reviewFeature(feature) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "node",
      [
        join(root, "dist/cli.js"),
        "--root",
        feature.dir,
        "review",
        "--feature",
        feature.featureId,
        "--capture-dir",
        captureDir,
      ],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    child.on("exit", () => resolvePromise());
  });
}

function readFeatureIds(dir) {
  const featuresDir = join(dir, ".clawpatch", "features");
  if (!existsSync(featuresDir)) {
    return [];
  }
  return readdirSync(featuresDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .toSorted();
}

function records() {
  const path = join(captureDir, "captures.jsonl");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function acceptedCaptures() {
  return records().filter((record) => record.status === "accepted").length;
}

function rewriteSummary() {
  const all = records();
  const summary = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    captures: all.length,
    accepted: all.filter((record) => record.status === "accepted").length,
    rejected: all.filter((record) => record.status === "rejected").length,
    metadataOnly: all.filter((record) => record.redactionState?.metadataOnly === true).length,
    redacted: all.filter((record) => record.redactionState?.redacted === true).length,
    byOperation: {},
  };
  for (const record of all) {
    summary.byOperation[record.operation] = (summary.byOperation[record.operation] ?? 0) + 1;
  }
  writeFileSync(join(captureDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}
