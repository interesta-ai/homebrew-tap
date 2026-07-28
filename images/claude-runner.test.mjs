import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createOutcomeRecorder,
  createIssuePlanTurnRecorder,
  discoverModels,
  normalizeSupportedModels,
  parseRequest,
  providerFailure,
  safeError,
  sdkEnvironment,
  toolPolicy,
  validateReportedModel,
} from "./claude-runner.mjs";

test("SDK shell receives GitHub access but no provider credentials", () => {
  const environment = sdkEnvironment({
    PATH: "/usr/bin",
    GH_TOKEN: "github-job-token",
    OPENAI_API_KEY: "openai-real-key",
    ANTHROPIC_API_KEY: "anthropic-real-key",
    CLAUDE_CODE_OAUTH_TOKEN: "anthropic-real-oauth-token",
    OPENROUTER_API_KEY: "openrouter-real-key",
    ORCHESTRATOR_INFERENCE_AUTH_MODE: "api_key",
    ORCHESTRATOR_INFERENCE_PROXY_TOKEN: "j".repeat(32),
    ORCHESTRATOR_INFERENCE_PROXY_URL: "http://127.0.0.1:8787",
  });

  assert.equal(environment.GH_TOKEN, "github-job-token");
  assert.equal(environment.ANTHROPIC_API_KEY, "j".repeat(32));
  assert.equal(environment.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787");
  assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.OPENROUTER_API_KEY, undefined);
});

test("SDK OAuth shell receives only the synthetic bearer token", () => {
  const environment = sdkEnvironment({
    GH_TOKEN: "github-job-token",
    ANTHROPIC_API_KEY: "anthropic-real-key",
    CLAUDE_CODE_OAUTH_TOKEN: "anthropic-real-oauth-token",
    ORCHESTRATOR_INFERENCE_AUTH_MODE: "oauth",
    ORCHESTRATOR_INFERENCE_PROXY_TOKEN: "o".repeat(32),
    ORCHESTRATOR_INFERENCE_PROXY_URL: "http://127.0.0.1:8787",
  });

  assert.equal(environment.GH_TOKEN, "github-job-token");
  assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, "o".repeat(32));
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(JSON.stringify(environment).includes("anthropic-real"), false);
});

test("Issue Planner SDK sessions persist without GitHub or mutation tools", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "claude-planner-test-"));
  const cwd = join(root, "repository");
  const sessionDir = join(root, ".planner", "claude");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  context.after(() => rm(root, { recursive: true, force: true }));

  const request = await parseRequest(JSON.stringify({
    prompt: "plan",
    model: "claude-test",
    cwd,
    timeoutMs: 1_000,
    mode: "issue_planning",
    sessionId: "session-1",
    sessionDir,
  }));
  assert.equal(request.sessionId, "session-1");
  assert.equal(request.sessionDir, sessionDir);

  const environment = sdkEnvironment({
    PATH: "/usr/bin",
    GH_TOKEN: "github-job-token",
    ORCHESTRATOR_INFERENCE_AUTH_MODE: "api_key",
    ORCHESTRATOR_INFERENCE_PROXY_TOKEN: "p".repeat(32),
    ORCHESTRATOR_INFERENCE_PROXY_URL: "http://127.0.0.1:8787",
  }, request);
  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.CLAUDE_CONFIG_DIR, sessionDir);

  const policy = toolPolicy("issue_planning");
  assert.deepEqual(policy.tools, ["Read", "Glob", "Grep"]);
  assert(policy.allowedTools.includes("mcp__orchestrator__orchestrator_report_issue_plan_turn"));
  for (const forbidden of ["Write", "Edit", "Bash", "mcp__orchestrator__github_graphql"]) {
    assert(!policy.allowedTools.includes(forbidden));
    assert(policy.disallowedTools.includes(forbidden));
  }

  const recorder = createIssuePlanTurnRecorder();
  const turn = { kind: "questions", questions: [{ id: "scope", prompt: "Which scope?", answerType: "text" }] };
  assert.equal(recorder.record(turn).isError, undefined);
  assert.deepEqual(recorder.finish(), turn);
});

test("supported model metadata resolves aliases without inventing models or efforts", () => {
  assert.deepEqual(normalizeSupportedModels([
    {
      value: "default",
      resolvedModel: "claude-sonnet-5",
      displayName: "Default",
      description: "Default model",
      supportedEffortLevels: ["low"],
    },
    {
      value: "sonnet",
      resolvedModel: "claude-sonnet-5",
      displayName: "Sonnet 5",
      description: "Balanced",
      supportedEffortLevels: ["low", "future.effort/v2", "low"],
    },
    {
      value: "claude-opus-4-8",
      displayName: "Opus 4.8",
      supportedEffortLevels: [],
    },
    { value: "opus", displayName: "Unresolved alias", supportedEffortLevels: ["max"] },
  ]), [
    {
      id: "claude-sonnet-5",
      displayName: "Sonnet 5",
      description: "Balanced",
      supportedEffortLevels: ["low", "future.effort/v2"],
    },
    {
      id: "claude-opus-4-8",
      displayName: "Opus 4.8",
      description: null,
      supportedEffortLevels: [],
    },
  ]);
});

test("model discovery requires exactly one supported Anthropic credential", async () => {
  await assert.rejects(() => discoverModels({}), /configuration is invalid/);
  await assert.rejects(() => discoverModels({
    ANTHROPIC_API_KEY: "api-key",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
  }), /configuration is invalid/);
});

test("model discovery errors preserve only actionable provider status", () => {
  assert.deepEqual(safeError({ code: "authentication_failed", status: 401, message: "secret details" }), {
    type: "error",
    code: "authentication_failed",
    message: "Claude authentication failed",
    status: 401,
  });
  assert.deepEqual(safeError({ code: "unknown_error", status: 503, message: "upstream secret details" }), {
    type: "error",
    code: "execution_failed",
    message: "Claude execution failed",
    status: 503,
  });
  assert.deepEqual(safeError(providerFailure(["authentication_failed"], null)), {
    type: "error",
    code: "authentication_failed",
    message: "Claude authentication failed",
    status: 401,
  });
});

test("request preserves exact model and effort while outcome validation fails closed", async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-runner-test-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  assert.deepEqual(await parseRequest(JSON.stringify({ prompt: "work", model: "claude-test", effort: "high", cwd, timeoutMs: 1_000 })), {
    prompt: "work",
    model: "claude-test",
    effort: "high",
    cwd,
    timeoutMs: 1_000,
  });
  assert.equal((await parseRequest(JSON.stringify({ prompt: "work", model: "claude-test", effort: "future.effort/v2", cwd, timeoutMs: 1_000 }))).effort, "future.effort/v2");
  await assert.rejects(() => parseRequest(JSON.stringify({ prompt: "work", model: "claude-test", effort: "x".repeat(65), cwd, timeoutMs: 1_000 })), /Thinking level/);

  const recorder = createOutcomeRecorder();
  assert.equal(recorder.record({ status: "blocked", reason: " " }).isError, true);
  assert.equal(recorder.record({ status: "succeeded" }).isError, undefined);
  assert.equal(recorder.record({ status: "succeeded" }).isError, true);
  assert.throws(() => recorder.finish(), /more than one outcome/);

  const summaryRecorder = createOutcomeRecorder();
  assert.equal(summaryRecorder.record({
    status: "succeeded",
    outcome: "no_findings",
    summary: " README marker ",
  }).isError, undefined);
  assert.deepEqual(summaryRecorder.finish(), {
    status: "succeeded",
    outcome: "no_findings",
    summary: "README marker",
  });

  const invalidOutcome = createOutcomeRecorder();
  assert.equal(invalidOutcome.record({ status: "succeeded", outcome: "unknown" }).isError, true);

  assert.doesNotThrow(() => validateReportedModel("claude-test", new Set(["claude-test"]), new Set(["claude-test"]), { modelUsage: { "claude-test": {} } }));
  assert.throws(() => validateReportedModel("claude-test", new Set(["claude-other"]), new Set(), { modelUsage: { "claude-test": {} } }), /requested model/);
});

test("runner exits after its single request without waiting for stdin EOF", async (context) => {
  const executable = join(dirname(fileURLToPath(import.meta.url)), "claude-runner.mjs");
  const child = spawn(process.execPath, [executable], {
    env: { HOME: process.env.HOME, PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "ignore"],
  });
  context.after(() => child.kill());
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write("not-json\n");

  const [status] = await once(child, "exit", { signal: AbortSignal.timeout(5_000) });
  assert.equal(status, 1);
  assert.deepEqual(JSON.parse(output.trim()), {
    type: "error",
    code: "invalid_request",
    message: "Claude request is invalid",
    status: null,
  });
});
