#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(root, "..");
const teacherRunsRoot = join(workspaceRoot, "teacher-runs");
const capturesRoot = join(workspaceRoot, "captures");
const runId =
  process.env.CLAWPATCH_CAPTURE_RUN_ID ??
  new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const captureDir = join(capturesRoot, runId);
const reviewLimitPerRepo = Number(process.env.CLAWPATCH_TEACHER_REVIEW_LIMIT ?? "84");
const reviewJobs = Number(process.env.CLAWPATCH_TEACHER_REVIEW_JOBS ?? "4");
const revalidateLimitPerRepo = Number(process.env.CLAWPATCH_TEACHER_REVALIDATE_LIMIT ?? "20");
const acceptedTarget = Number(process.env.CLAWPATCH_TEACHER_ACCEPTED_TARGET ?? "500");

const candidates = new Map([
  ["click", { repo: "https://github.com/pallets/click.git", name: "click" }],
  ["ripgrep", { repo: "https://github.com/BurntSushi/ripgrep.git", name: "ripgrep" }],
  ["hono", { repo: "https://github.com/honojs/hono.git", name: "hono" }],
  ["fastify", { repo: "https://github.com/fastify/fastify.git", name: "fastify" }],
  ["flask", { repo: "https://github.com/pallets/flask.git", name: "flask" }],
]);

const selectedNames = (process.env.CLAWPATCH_TEACHER_REPOS ?? "click,ripgrep,hono,fastify,flask")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);
const selected = selectedNames.map((name) => {
  const candidate = candidates.get(name);
  if (candidate === undefined) {
    throw new Error(`unknown CLAWPATCH_TEACHER_REPOS entry: ${name}`);
  }
  return candidate;
});
if (selected.length === 0) {
  throw new Error("CLAWPATCH_TEACHER_REPOS must select at least one repository");
}

const captureTargets = {
  review: acceptedTarget,
  revalidate: selected.length * revalidateLimitPerRepo,
  map: selected.length,
};

const followUpTargetMinimums = {
  review: 500,
  revalidate: 100,
  map: 25,
};

const followUpGapsAfterThisRun = {
  review: Math.max(0, followUpTargetMinimums.review - captureTargets.review),
  revalidate: Math.max(0, followUpTargetMinimums.revalidate - captureTargets.revalidate),
  map: Math.max(0, followUpTargetMinimums.map - captureTargets.map),
};

mkdirSync(teacherRunsRoot, { recursive: true });
mkdirSync(captureDir, { recursive: true });

run("pnpm", ["-s", "build"], root);

const qualification = [];
for (const candidate of selected) {
  const dir = join(teacherRunsRoot, candidate.name);
  if (!existsSync(dir)) {
    run("git", ["clone", "--depth", "1", candidate.repo, dir], workspaceRoot);
  } else {
    run("git", ["fetch", "--depth", "1", "origin"], dir);
    run("git", ["reset", "--hard", "origin/HEAD"], dir);
  }
  rmSync(join(dir, ".clawpatch"), { recursive: true, force: true });
  const sourceFiles = countFiles(
    dir,
    /\.(c|cc|cpp|cs|ex|exs|go|java|js|jsx|kt|php|py|rb|rs|swift|ts|tsx)$/,
  );
  const testFiles = countFiles(dir, /(^|\/)(test|tests|spec|__tests__)\/|(\.|_)(test|spec)\./);
  const license = detectLicense(dir);
  qualification.push({
    name: candidate.name,
    repo: candidate.repo,
    workspace: dir,
    publicRepo: true,
    license,
    supportedMapperEcosystem: true,
    sourceFiles,
    testFiles,
    validationCommands: detectableValidationCommands(dir),
    generatedVendorDominance: "limited by git ls-files exclusion of vendor/ and generated/",
    qualifiedForRun: license !== null && sourceFiles >= 12 && testFiles >= 5,
  });
  run("node", [join(root, "dist/cli.js"), "--root", dir, "init", "--force"], root);
  run(
    "node",
    [
      join(root, "dist/cli.js"),
      "--root",
      dir,
      "map",
      "--source",
      "agent",
      "--capture-dir",
      captureDir,
    ],
    root,
  );
  run(
    "node",
    [
      join(root, "dist/cli.js"),
      "--root",
      dir,
      "review",
      "--limit",
      String(reviewLimitPerRepo),
      "--jobs",
      String(reviewJobs),
      "--capture-dir",
      captureDir,
    ],
    root,
  );
  run(
    "node",
    [
      join(root, "dist/cli.js"),
      "--root",
      dir,
      "revalidate",
      "--all",
      "--limit",
      String(revalidateLimitPerRepo),
      "--capture-dir",
      captureDir,
    ],
    root,
    { allowFailure: true },
  );
}

topUpAcceptedCaptures();

writeFileSync(
  join(captureDir, "repository-qualification.json"),
  `${JSON.stringify({ runId, selected: qualification }, null, 2)}\n`,
);

const finalSummary = readSummary();
writeFileSync(
  join(captureDir, "collection-report.md"),
  [
    `# Teacher Collection Report ${runId}`,
    "",
    `Capture directory: ${captureDir}`,
    `Teacher runs directory: ${teacherRunsRoot}`,
    "",
    "## Counts",
    "",
    `Accepted captures: ${finalSummary.accepted ?? 0}`,
    `Rejected captures: ${finalSummary.rejected ?? 0}`,
    `By operation: ${JSON.stringify(finalSummary.byOperation ?? {})}`,
    `Review limit per repo: ${reviewLimitPerRepo}`,
    `Review jobs: ${reviewJobs}`,
    `Revalidate limit per repo: ${revalidateLimitPerRepo}`,
    `Accepted target: ${acceptedTarget}`,
    `Selected repositories: ${selected.map((candidate) => candidate.name).join(", ")}`,
    `Capture targets: ${JSON.stringify(captureTargets)}`,
    `Follow-up target minimums: ${JSON.stringify(followUpTargetMinimums)}`,
    `Follow-up gaps after this run: ${JSON.stringify(followUpGapsAfterThisRun)}`,
    "",
    "## Follow-up Path",
    "",
    "After this run, keep expanding repository roots until the retained corpus reaches the review, revalidate, and map target minimums without counting duplicate or metadata-only captures.",
    "",
  ].join("\n"),
);

console.log(`captureDir=${captureDir}`);

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0 && options.allowFailure !== true) {
    process.exit(result.status ?? 1);
  }
}

function countFiles(dir, pattern) {
  const result = spawnSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) {
    return 0;
  }
  return result.stdout
    .split("\n")
    .filter((file) => file.length > 0)
    .filter((file) => !file.includes("vendor/") && !file.includes("generated/"))
    .filter((file) => pattern.test(file)).length;
}

function topUpAcceptedCaptures() {
  let summary = readSummary();
  if ((summary.accepted ?? 0) >= acceptedTarget) {
    return;
  }
  const features = selected.flatMap((candidate) =>
    readFeatureIds(join(teacherRunsRoot, candidate.name)).map((featureId) => ({
      repo: candidate.name,
      dir: join(teacherRunsRoot, candidate.name),
      featureId,
    })),
  );
  if (features.length === 0) {
    return;
  }
  let cursor = 0;
  while ((summary.accepted ?? 0) < acceptedTarget) {
    const feature = features[cursor % features.length];
    cursor += 1;
    run(
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
      root,
      { allowFailure: true },
    );
    summary = readSummary();
  }
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

function readSummary() {
  const path = join(captureDir, "summary.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

function detectLicense(dir) {
  const names = readdirSync(dir);
  const licenseFile = names.find((name) => /^licen[cs]e($|\.)/i.test(name));
  if (licenseFile === undefined) {
    return null;
  }
  const text = readFileSync(join(dir, licenseFile), "utf8").slice(0, 4000);
  if (/MIT License/i.test(text)) {
    return "MIT";
  }
  if (/Apache License/i.test(text)) {
    return "Apache";
  }
  if (/BSD/i.test(text)) {
    return "BSD";
  }
  if (/ISC License/i.test(text)) {
    return "ISC";
  }
  return licenseFile;
}

function detectableValidationCommands(dir) {
  const commands = [];
  const packageJson = join(dir, "package.json");
  if (existsSync(packageJson)) {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
    for (const name of ["test", "lint", "typecheck", "build"]) {
      if (typeof pkg.scripts?.[name] === "string") {
        commands.push(`npm run ${name}`);
      }
    }
  }
  const pyproject = join(dir, "pyproject.toml");
  if (existsSync(pyproject)) {
    commands.push("python -m pytest");
  }
  const cargo = join(dir, "Cargo.toml");
  if (existsSync(cargo)) {
    commands.push("cargo test");
  }
  return commands;
}
