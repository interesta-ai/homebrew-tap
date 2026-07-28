#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];
const MCP_TOOLS = ["mcp__orchestrator__github_graphql", "mcp__orchestrator__orchestrator_report_outcome"];
const PLANNER_BUILTIN_TOOLS = ["Read", "Glob", "Grep"];
const PLANNER_MCP_TOOL = "mcp__orchestrator__orchestrator_report_issue_plan_turn";
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_GRAPHQL_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERED_MODELS = 100;
const AUTH_MODES = new Set(["api_key", "oauth"]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function parseRequest(line) {
  if (Buffer.byteLength(line) > MAX_INPUT_BYTES) throw coded("invalid_request", "Request is too large");

  let input;
  try {
    input = JSON.parse(line);
  } catch {
    throw coded("invalid_request", "Request must be valid JSON");
  }

  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw coded("invalid_request", "Request must be a JSON object");
  }

  const prompt = cleanString(input.prompt);
  const model = cleanString(input.model);
  const cwd = cleanString(input.cwd);
  const effort = input.effort == null || input.effort === "" ? null : cleanString(input.effort);
  const timeoutMs = Number(input.timeoutMs);
  const mode = input.mode == null ? "standard" : cleanString(input.mode);
  const sessionId = input.sessionId == null || input.sessionId === "" ? null : cleanString(input.sessionId);
  const sessionDir = input.sessionDir == null ? "" : cleanString(input.sessionDir);

  if (!prompt || prompt.length > 900_000) throw coded("invalid_request", "Prompt is required");
  if (!model || model.length > 256) throw coded("invalid_request", "Model is required");
  if (!isAbsolute(cwd) || cwd.length > 4096) throw coded("invalid_request", "Working directory must be absolute");
  if (effort !== null && (!effort || effort.length > 64)) {
    throw coded("invalid_request", "Thinking level is invalid");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 2 * 60 * 60 * 1_000) {
    throw coded("invalid_request", "Timeout is invalid");
  }
  if (mode !== "standard" && mode !== "issue_planning") throw coded("invalid_request", "Execution mode is invalid");
  if (sessionId !== null && (!sessionId || sessionId.length > 256)) throw coded("invalid_request", "Session is invalid");
  if (mode === "issue_planning" && (!isAbsolute(sessionDir) || sessionDir.length > 4096)) {
    throw coded("invalid_request", "Session directory must be absolute");
  }

  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw coded("invalid_request", "Working directory does not exist");
  if (mode === "issue_planning") {
    const sessionInfo = await stat(sessionDir).catch(() => null);
    if (!sessionInfo?.isDirectory()) throw coded("invalid_request", "Session directory does not exist");
    return { prompt, model, effort, cwd, timeoutMs, mode, sessionId, sessionDir };
  }
  return { prompt, model, effort, cwd, timeoutMs };
}

function coded(code, message, status = null) {
  return Object.assign(new Error(message), { code, status });
}

function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

export function createOutcomeRecorder() {
  let outcome = null;
  let duplicate = false;

  return {
    record(args) {
      const status = args?.status;
      const reason = cleanString(args?.reason);
      const summary = cleanString(args?.summary).slice(0, 4_000);
      const contractOutcome = args?.outcome == null ? "completed" : cleanString(args.outcome);
      if (status !== "succeeded" && status !== "blocked") return toolText("Invalid outcome status", true);
      if (status === "blocked" && !reason) return toolText("A blocked outcome requires a reason", true);
      if (status === "succeeded" && !["completed", "no_findings"].includes(contractOutcome)) {
        return toolText("Invalid artifact outcome", true);
      }
      if (outcome !== null) {
        duplicate = true;
        return toolText("An outcome has already been recorded", true);
      }
      outcome = status === "blocked"
        ? { status, reason }
        : { status, outcome: contractOutcome, ...(summary ? { summary } : {}) };
      return toolText("Outcome recorded");
    },
    finish() {
      if (duplicate) throw coded("duplicate_outcome", "The agent reported more than one outcome");
      if (outcome === null) throw coded("missing_outcome", "The agent did not report an outcome");
      return outcome;
    },
  };
}

export function createIssuePlanTurnRecorder() {
  let turn = null;
  let duplicate = false;

  return {
    record(args) {
      if (!args || typeof args !== "object" || !["questions", "proposal"].includes(args.kind)) {
        return toolText("Invalid issue plan turn", true);
      }
      if (turn !== null) {
        duplicate = true;
        return toolText("An issue plan turn has already been recorded", true);
      }
      turn = args;
      return toolText("Issue plan turn recorded");
    },
    finish() {
      if (duplicate) throw coded("duplicate_issue_plan_turn", "The agent reported more than one issue plan turn");
      if (turn === null) throw coded("missing_issue_plan_turn", "The agent did not report an issue plan turn");
      return turn;
    },
  };
}

function proxyCredentials(env) {
  const token = cleanString(env.ORCHESTRATOR_INFERENCE_PROXY_TOKEN);
  const rawUrl = cleanString(env.ORCHESTRATOR_INFERENCE_PROXY_URL);
  const authMode = cleanString(env.ORCHESTRATOR_INFERENCE_AUTH_MODE);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw coded("invalid_environment", "Inference proxy configuration is invalid");
  }

  if (
    !AUTH_MODES.has(authMode) ||
    token.length < 32 ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw coded("invalid_environment", "Inference proxy configuration is invalid");
  }
  return { authMode, token, url: url.origin };
}

export function sdkEnvironment(env, request = {}) {
  const { authMode, token, url } = proxyCredentials(env);
  const planning = request.mode === "issue_planning";
  const inherited = [
    "PATH",
    "HOME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    ...(planning ? [] : ["GH_TOKEN"]),
  ];
  const result = Object.fromEntries(inherited.flatMap((name) => (env[name] ? [[name, env[name]]] : [])));
  const credentials = authMode === "oauth"
    ? { CLAUDE_CODE_OAUTH_TOKEN: token }
    : { ANTHROPIC_API_KEY: token };
  return {
    ...result,
    ...credentials,
    ANTHROPIC_BASE_URL: url,
    CLAUDE_AGENT_SDK_CLIENT_APP: "orchestrator-cli/1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CONFIG_DIR: planning ? request.sessionDir : `/tmp/orchestrator-claude-${process.pid}`,
    CI: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_TELEMETRY: "1",
    NO_COLOR: "1",
  };
}

export function toolPolicy(mode) {
  const commonDenied = ["Agent", "Task", "AskUserQuestion", "WebFetch", "WebSearch", "NotebookEdit", "Skill"];
  if (mode === "issue_planning") {
    return {
      allowedTools: [...PLANNER_BUILTIN_TOOLS, PLANNER_MCP_TOOL],
      disallowedTools: [...commonDenied, "Write", "Edit", "Bash", "mcp__orchestrator__github_graphql", "mcp__orchestrator__orchestrator_report_outcome"],
      tools: PLANNER_BUILTIN_TOOLS,
    };
  }
  return {
    allowedTools: [...BUILTIN_TOOLS, ...MCP_TOOLS],
    disallowedTools: commonDenied,
    tools: BUILTIN_TOOLS,
  };
}

function safeCatalogString(value, maximum) {
  const result = cleanString(value);
  return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result) ? result : "";
}

function defaultAlias(value) {
  return /^(auto|automatic|default)(?:[-_. ]|$)/i.test(value);
}

export function normalizeSupportedModels(models) {
  if (!Array.isArray(models)) return [];
  const normalized = new Map();

  for (const model of models) {
    if (!model || Array.isArray(model) || typeof model !== "object") continue;
    const value = safeCatalogString(model.value, 256);
    const resolved = safeCatalogString(model.resolvedModel, 256);
    const id = resolved || (value.startsWith("claude-") ? value : "");
    if (!id.startsWith("claude-")) continue;

    const displayName = safeCatalogString(model.displayName, 256) || id;
    const description = safeCatalogString(model.description, 4_000) || null;
    const supportedEffortLevels = [...new Set(
      (Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels : [])
        .map((effort) => safeCatalogString(effort, 64))
        .filter(Boolean),
    )].slice(0, 16);
    const candidate = { id, displayName, description, supportedEffortLevels, source: value };
    const current = normalized.get(id);
    if (!current || (defaultAlias(current.source) && !defaultAlias(candidate.source))) normalized.set(id, candidate);
    if (normalized.size >= MAX_DISCOVERED_MODELS) break;
  }

  return [...normalized.values()].map(({ source: _source, ...model }) => model);
}

function discoveryCredential(env) {
  const available = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].filter((name) => cleanString(env[name]));
  if (available.length !== 1) throw coded("invalid_environment", "Claude model discovery configuration is invalid");
  const name = available[0];
  return { name, value: env[name] };
}

function discoveryEnvironment(env, credential) {
  const inherited = [
    "PATH",
    "HOME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ];
  return {
    ...Object.fromEntries(inherited.flatMap((name) => (env[name] ? [[name, env[name]]] : []))),
    [credential.name]: credential.value,
    CLAUDE_AGENT_SDK_CLIENT_APP: "orchestrator-cli/1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CONFIG_DIR: `/tmp/orchestrator-claude-models-${process.pid}`,
    CI: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_TELEMETRY: "1",
    NO_COLOR: "1",
  };
}

async function* idlePrompt(signal) {
  if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
}

export async function discoverModels(env = process.env) {
  const credential = discoveryCredential(env);
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  const session = query({
    prompt: idlePrompt(abortController.signal),
    options: {
      abortController,
      allowedTools: [],
      disallowedTools: [...BUILTIN_TOOLS, "Agent", "Task", "AskUserQuestion", "WebFetch", "WebSearch", "NotebookEdit", "Skill"],
      env: discoveryEnvironment(env, credential),
      includeHookEvents: false,
      includePartialMessages: false,
      mcpServers: {},
      permissionMode: "dontAsk",
      persistSession: false,
      plugins: [],
      settingSources: [],
      skills: [],
      stderr: () => {},
      strictMcpConfig: true,
      tools: [],
    },
  });
  const timeout = AbortSignal.timeout(30_000);

  try {
    const [models, account] = await Promise.race([
      Promise.all([session.supportedModels(), session.accountInfo()]),
      new Promise((_, reject) => timeout.addEventListener("abort", () => reject(coded("timeout", "Claude model discovery timed out")), { once: true })),
    ]);
    const credentialConsumed = credential.name === "CLAUDE_CODE_OAUTH_TOKEN"
      ? account?.tokenSource === credential.name
      : account?.apiKeySource === credential.name;
    if (!credentialConsumed) throw coded("invalid_environment", "Claude model discovery configuration is invalid");
    return normalizeSupportedModels(models);
  } finally {
    abortController.abort();
    session.close();
  }
}

async function githubGraphql(args, signal) {
  const token = cleanString(process.env.GH_TOKEN);
  const query = cleanString(args?.query);
  const variables = args?.variables ?? {};
  if (!token) return toolText("GitHub authentication is unavailable", true);
  if (!query) return toolText("github_graphql requires a query", true);
  if (!variables || Array.isArray(variables) || typeof variables !== "object") {
    return toolText("github_graphql variables must be an object", true);
  }

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "orchestrator-cli",
        "x-github-api-version": "2026-03-10",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    const body = await response.text();
    if (body.length > MAX_GRAPHQL_BYTES) return toolText("GitHub response was too large", true);
    if (!response.ok) return toolText(`GitHub request failed with HTTP ${response.status}`, true);
    return toolText(body);
  } catch {
    return toolText("GitHub request failed", true);
  }
}

function eventFor(message) {
  if (message.type === "system" && message.subtype === "init") {
    return { type: "event", event: "session", sessionId: message.session_id, model: message.model };
  }
  if (message.type === "system" && message.subtype === "api_retry") {
    return {
      type: "event",
      event: "retry",
      attempt: message.attempt,
      maxRetries: message.max_retries,
      delayMs: message.retry_delay_ms,
      status: message.error_status,
      error: message.error,
    };
  }
  if (message.type === "system" && message.subtype === "permission_denied") {
    return { type: "event", event: "permission_denied", tool: message.tool_name };
  }
  if (message.type === "assistant") {
    const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
    const tools = [...new Set(blocks.filter((block) => block?.type === "tool_use").map((block) => block.name))];
    return {
      type: "event",
      event: "assistant",
      model: message.message?.model ?? null,
      hasText: blocks.some((block) => block?.type === "text"),
      tools,
      ...(message.error ? { error: message.error } : {}),
    };
  }
  return null;
}

function normalizedUsage(modelUsage, model) {
  const usage = modelUsage?.[model];
  if (!usage) return null;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
}

export function validateReportedModel(requestedModel, initializedModels, assistantModels, result) {
  const usageModels = Object.keys(result.modelUsage ?? {});
  const allModels = new Set([...initializedModels, ...assistantModels, ...usageModels]);
  if (usageModels.length !== 1 || allModels.size !== 1 || !allModels.has(requestedModel)) {
    throw coded("model_mismatch", "Claude did not use the requested model");
  }
}

export function providerFailure(messageErrors, result) {
  const named = messageErrors.find(Boolean);
  if (named) {
    const status = {
      authentication_failed: 401,
      oauth_org_not_allowed: 403,
      billing_error: 402,
      rate_limit: 429,
      overloaded: 529,
      model_not_found: 404,
      server_error: 500,
    }[named] ?? null;
    return coded(named, `Claude provider error: ${named.replaceAll("_", " ")}`, status);
  }
  if (result?.subtype === "error_max_turns") return coded("max_turns", "Claude reached its turn limit");
  if (result?.subtype === "error_max_budget_usd") return coded("max_budget", "Claude reached its budget limit", 402);
  return coded("execution_failed", "Claude execution failed");
}

function issuePlanTurnShape(z) {
  const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
  const nonblank = z.string().trim().min(1);
  const issue = z.object({
    id,
    title: nonblank,
    bodyMarkdown: nonblank,
    labels: z.array(nonblank),
  }).strict();
  const workIssue = issue.extend({
    parked: z.boolean(),
    parkedConfirmed: z.boolean(),
    validationRequirements: z.array(nonblank).min(1),
    testRequirements: z.array(nonblank).min(1),
    validationEvidence: z.enum(["CLI", "Visual", "Both", "Neither"]),
    validationEvidenceRationale: nonblank.nullable(),
    routingAgentId: z.string().uuid().nullable(),
    routingAgentConfirmed: z.literal(false),
  }).strict();

  return {
    kind: z.enum(["questions", "proposal"]),
    questions: z.array(z.object({
      id,
      prompt: nonblank,
      answerType: z.enum(["text", "single_select", "boolean"]),
      options: z.array(z.object({ value: nonblank, label: nonblank }).strict()).min(2).max(10).optional(),
    }).strict()).min(1).max(5).optional(),
    proposal: z.object({
      parent: issue.nullable(),
      workIssues: z.array(workIssue).min(1).max(10),
      blockerEdges: z.array(z.object({ blockedId: id, blockingId: id }).strict()),
    }).strict().optional(),
  };
}

async function runClaude(request, write) {
  const [{ createSdkMcpServer, query, tool }, { z }] = await Promise.all([
    import("@anthropic-ai/claude-agent-sdk"),
    import("zod/v4"),
  ]);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(coded("timeout", "Claude execution timed out")), request.timeoutMs);
  timeout.unref();
  const planning = request.mode === "issue_planning";
  const recorder = planning ? createIssuePlanTurnRecorder() : createOutcomeRecorder();
  const policy = toolPolicy(request.mode);
  const initializedModels = new Set();
  const assistantModels = new Set();
  const messageErrors = [];

  const tools = planning
    ? [
      tool(
        "orchestrator_report_issue_plan_turn",
        "Required final result for an Issue Planner turn. Report either clarification questions or one complete structured proposal.",
        issuePlanTurnShape(z),
        async (args) => recorder.record(args),
        { alwaysLoad: true },
      ),
    ]
    : [
      tool(
        "github_graphql",
        "Run an authenticated GitHub GraphQL query for the current repository workflow.",
        { query: z.string().min(1), variables: z.record(z.string(), z.unknown()).optional() },
        (args) => githubGraphql(args, abortController.signal),
        { alwaysLoad: true },
      ),
      tool(
        "orchestrator_report_outcome",
        "Required final status. Report succeeded only after all required work and GitHub side effects are verified. Report blocked with a concise reason when completion is impossible.",
        {
          status: z.enum(["succeeded", "blocked"]),
          reason: z.string().max(4000).optional(),
          summary: z.string().max(4000).optional(),
          outcome: z.enum(["completed", "no_findings"]).optional(),
        },
        async (args) => recorder.record(args),
        { alwaysLoad: true },
      ),
    ];

  const mcpServer = createSdkMcpServer({
    name: "orchestrator",
    version: "1",
    alwaysLoad: true,
    tools,
  });

  const options = {
    abortController,
    allowedTools: policy.allowedTools,
    cwd: request.cwd,
    disallowedTools: policy.disallowedTools,
    env: sdkEnvironment(process.env, request),
    includeHookEvents: false,
    includePartialMessages: false,
    mcpServers: { orchestrator: mcpServer },
    model: request.model,
    permissionMode: "dontAsk",
    persistSession: planning,
    plugins: [],
    settingSources: [],
    skills: [],
    stderr: () => {},
    strictMcpConfig: true,
    tools: policy.tools,
    ...(request.effort ? { effort: request.effort } : {}),
    ...(planning && request.sessionId ? { resume: request.sessionId } : {}),
  };

  const session = query({ prompt: request.prompt, options });
  let result = null;
  try {
    for await (const message of session) {
      if (message.type === "system" && message.subtype === "init" && message.model) initializedModels.add(message.model);
      if (message.type === "assistant") {
        if (message.message?.model) assistantModels.add(message.message.model);
        if (message.error) messageErrors.push(message.error);
      }
      const event = eventFor(message);
      if (event) write(event);
      if (message.type === "assistant" && message.message?.model && message.message.model !== request.model) {
        throw message.error
          ? providerFailure([message.error], null)
          : coded("model_mismatch", "Claude did not use the requested model");
      }
      if (message.type === "result") result = message;
    }

    if (!result || result.subtype !== "success" || result.is_error) throw providerFailure(messageErrors, result);
    validateReportedModel(request.model, initializedModels, assistantModels, result);
    const report = recorder.finish();
    const response = {
      type: "result",
      status: planning ? "succeeded" : report.status,
      model: request.model,
      usage: normalizedUsage(result.modelUsage, request.model),
      costUsd: result.total_cost_usd,
      durationMs: result.duration_ms,
      numTurns: result.num_turns,
      sessionId: result.session_id,
    };
    write(planning ? { ...response, issuePlanTurn: report } : { ...response, outcome: report });
  } catch (error) {
    if (abortController.signal.aborted) throw coded("timeout", "Claude execution timed out");
    if (messageErrors.some(Boolean)) throw providerFailure(messageErrors, result);
    throw error;
  } finally {
    clearTimeout(timeout);
    session.close();
  }
}

export function safeError(error) {
  const allowed = new Set([
    "authentication_failed",
    "billing_error",
    "duplicate_issue_plan_turn",
    "duplicate_outcome",
    "execution_failed",
    "invalid_environment",
    "invalid_request",
    "max_budget",
    "max_turns",
    "missing_issue_plan_turn",
    "missing_outcome",
    "model_mismatch",
    "model_not_found",
    "oauth_org_not_allowed",
    "overloaded",
    "rate_limit",
    "server_error",
    "timeout",
  ]);
  const code = allowed.has(error?.code) ? error.code : "execution_failed";
  const messages = {
    authentication_failed: "Claude authentication failed",
    billing_error: "Claude billing or credits are unavailable",
    duplicate_issue_plan_turn: "The agent reported more than one issue plan turn",
    duplicate_outcome: "The agent reported more than one outcome",
    execution_failed: "Claude execution failed",
    invalid_environment: "Claude runtime configuration is invalid",
    invalid_request: "Claude request is invalid",
    max_budget: "Claude reached its budget limit",
    max_turns: "Claude reached its turn limit",
    missing_issue_plan_turn: "The agent did not report an issue plan turn",
    missing_outcome: "The agent did not report an outcome",
    model_mismatch: "Claude did not use the requested model",
    model_not_found: "The selected Claude model was not found",
    oauth_org_not_allowed: "Claude authentication is not permitted for this organization",
    overloaded: "Claude is overloaded",
    rate_limit: "Claude is rate limited",
    server_error: "Claude upstream service failed",
    timeout: "Claude execution timed out",
  };
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : null;
  return { type: "error", code, message: messages[code], status };
}

async function sdkSmokeTest() {
  const [{ createSdkMcpServer, query, tool }, { z }] = await Promise.all([
    import("@anthropic-ai/claude-agent-sdk"),
    import("zod/v4"),
  ]);
  const definition = tool(
    "smoke",
    "smoke",
    { value: z.string() },
    async () => toolText("ok"),
    { alwaysLoad: true },
  );
  const plannerDefinition = tool(
    "orchestrator_report_issue_plan_turn",
    "planner smoke",
    issuePlanTurnShape(z),
    async (args) => createIssuePlanTurnRecorder().record(args),
    { alwaysLoad: true },
  );
  const server = createSdkMcpServer({
    name: "orchestrator",
    version: "1",
    alwaysLoad: true,
    tools: [definition, plannerDefinition],
  });
  const session = query({
    prompt: "smoke",
    options: {
      allowedTools: ["Read", "mcp__orchestrator__smoke"],
      mcpServers: { orchestrator: server },
      permissionMode: "dontAsk",
      persistSession: false,
      plugins: [],
      settingSources: [],
      skills: [],
      stderr: () => {},
      strictMcpConfig: true,
      tools: ["Read"],
    },
  });
  session.close();
  if (server.type !== "sdk") throw new Error("invalid SDK MCP server");
}

async function modelsMain() {
  try {
    const models = await discoverModels();
    process.stdout.write(`${JSON.stringify({ type: "models", credentialValidated: false, models })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeError(error))}\n`);
    process.exitCode = 1;
  }
}

async function main() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let handled = false;
  const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  for await (const line of input) {
    if (!line.trim()) continue;
    if (handled) {
      write({ type: "error", code: "invalid_request", message: "Only one request is allowed", status: null });
      process.exitCode = 1;
      continue;
    }
    handled = true;
    try {
      await runClaude(await parseRequest(line), write);
    } catch (error) {
      write(safeError(error));
      process.exitCode = 1;
    }
    break;
  }
  input.close();
  if (!handled) {
    write({ type: "error", code: "invalid_request", message: "Claude request is required", status: null });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] === "--sdk-smoke"
    ? sdkSmokeTest
    : process.argv[2] === "--models"
      ? modelsMain
      : main;
  command().catch(() => {
    process.stdout.write('{"type":"error","code":"execution_failed","message":"Claude execution failed","status":null}\n');
    process.exitCode = 1;
  });
}
