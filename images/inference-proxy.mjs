#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const PROVIDERS = Object.freeze({
  openai: {
    upstream: "https://api.openai.com",
    paths: new Map([
      ["/v1/responses", "/v1/responses"],
      ["/v1/responses/compact", "/v1/responses/compact"],
    ]),
  },
  openrouter: {
    upstream: "https://openrouter.ai",
    paths: new Map([
      ["/v1/responses", "/api/v1/responses"],
      ["/v1/responses/compact", "/api/v1/responses/compact"],
      ["/v1/chat/completions", "/api/v1/chat/completions"],
      ["/api/v1/responses", "/api/v1/responses"],
      ["/api/v1/responses/compact", "/api/v1/responses/compact"],
      ["/api/v1/chat/completions", "/api/v1/chat/completions"],
    ]),
  },
  anthropic: {
    upstream: "https://api.anthropic.com",
    paths: new Map([
      ["/v1/messages", "/v1/messages"],
      ["/v1/messages/count_tokens", "/v1/messages/count_tokens"],
    ]),
  },
});

const OPENAI_OAUTH = Object.freeze({
  upstream: "https://chatgpt.com",
  paths: new Map([
    ["/v1/responses", "/backend-api/codex/responses"],
    ["/v1/responses/compact", "/backend-api/codex/responses/compact"],
  ]),
});

const PROVIDER_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENROUTER_API_KEY"];
const AUTH_MODES = new Set(["api_key", "oauth"]);
const MAX_AUTH_FILE_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 65 * 60 * 1_000;
const OPENROUTER_MODEL_ROUTING_FIELDS = ["fallbacks", "models", "preset", "route"];
const HOP_BY_HOP_HEADERS = new Set([
  "authorization",
  "chatgpt-account-id",
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "openai-organization",
  "openai-project",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-api-key",
  "x-openai-account-id",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("invalid configuration");
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const provider = text(env.ORCHESTRATOR_PROXY_PROVIDER);
  const definition = PROVIDERS[provider];
  const token = text(env.ORCHESTRATOR_PROXY_TOKEN);
  const credential = text(env.ORCHESTRATOR_PROXY_CREDENTIAL);
  const authMode = text(env.ORCHESTRATOR_PROXY_AUTH_MODE);
  const authFile = text(env.ORCHESTRATOR_PROXY_AUTH_FILE);
  const populatedKeys = PROVIDER_KEYS.filter((name) => text(env[name]));
  const openaiOauth = provider === "openai" && authMode === "oauth";

  if (
    !definition ||
    token.length < 32 ||
    !AUTH_MODES.has(authMode) ||
    (authMode === "oauth" && provider !== "anthropic" && provider !== "openai") ||
    (openaiOauth ? Boolean(credential) || !authFile : !credential || Boolean(authFile)) ||
    populatedKeys.length !== 0
  ) {
    throw new Error("invalid configuration");
  }

  const auth = openaiOauth ? readOpenAiAuth(authFile) : { credential, accountId: null };
  if (safeEqual(token, auth.credential)) throw new Error("invalid configuration");

  const model = text(env.ORCHESTRATOR_PROXY_MODEL) || null;
  if (model && model.length > 512) throw new Error("invalid configuration");

  return {
    provider,
    authMode,
    credential: auth.credential,
    accountId: auth.accountId,
    token,
    model,
    port: integer(env.ORCHESTRATOR_PROXY_PORT, 8787, 1, 65_535),
    timeoutMs: integer(env.ORCHESTRATOR_PROXY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 2 * 60 * 60 * 1_000),
    upstream: openaiOauth ? OPENAI_OAUTH.upstream : definition.upstream,
    paths: openaiOauth ? OPENAI_OAUTH.paths : definition.paths,
  };
}

function readOpenAiAuth(path) {
  if (!isAbsolute(path) || path.length > 4_096 || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("invalid configuration");
  }

  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 2 || info.size > MAX_AUTH_FILE_BYTES || (info.mode & 0o077) !== 0) {
      throw new Error("invalid configuration");
    }
    const parsed = JSON.parse(readFileSync(descriptor, "utf8"));
    const accessToken = text(parsed?.tokens?.access_token);
    const accountId = text(parsed?.tokens?.account_id);
    if (
      !parsed ||
      Array.isArray(parsed) ||
      parsed.auth_mode !== "chatgpt" ||
      !accessToken ||
      accessToken.length > 32_768 ||
      !accountId ||
      accountId.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(accessToken) ||
      /[\u0000-\u001f\u007f]/.test(accountId)
    ) {
      throw new Error("invalid configuration");
    }
    return { credential: accessToken, accountId };
  } catch {
    throw new Error("invalid configuration");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function presentedToken(request) {
  const authorization = text(request.headers.authorization);
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "").trim();
  return text(request.headers["x-api-key"]);
}

function authenticated(request, token) {
  const presented = presentedToken(request);
  return presented !== "" && safeEqual(presented, token);
}

async function readJson(request) {
  if (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity") {
    throw Object.assign(new Error("encoded bodies are not supported"), { status: 415 });
  }

  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("request body is too large"), { status: 413 });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body is too large"), { status: 413 });
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return { parsed };
  } catch {
    throw Object.assign(new Error("request body must be a JSON object"), { status: 400 });
  }
}

function requestHeaders(request, config) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(lower) ||
      lower.startsWith("forwarded") ||
      lower.startsWith("x-forwarded-")
    ) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  headers.set("accept-encoding", "identity");
  headers.set("content-type", "application/json");
  if (config.provider === "anthropic" && config.authMode === "api_key") {
    headers.set("x-api-key", config.credential);
  } else {
    headers.set("authorization", `Bearer ${config.credential}`);
  }
  if (config.provider === "openai" && config.authMode === "oauth") {
    headers.set("chatgpt-account-id", config.accountId);
  }
  return headers;
}

function responseHeaders(upstream, response) {
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-encoding") continue;
    response.setHeader(name, value);
  }
}

function json(response, status, code, message) {
  if (response.headersSent) return response.destroy();
  const body = JSON.stringify({ error: { code, message } });
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function models(response) {
  const body = JSON.stringify({ models: [] });
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function createInferenceProxy(config) {
  let pinnedModel = config.model;

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end('{"ok":true}');
    }

    let url;
    try {
      url = new URL(request.url, "http://proxy.local");
    } catch {
      return json(response, 400, "invalid_path", "Invalid request path");
    }

    if (!authenticated(request, config.token)) return json(response, 401, "unauthorized", "Invalid job token");
    if (request.method === "GET" && url.pathname === "/v1/models") {
      const queryKeys = [...url.searchParams.keys()];
      if (queryKeys.some((key) => key !== "client_version")) {
        return json(response, 400, "query_not_allowed", "Query parameters are not allowed");
      }
      return models(response);
    }
    if (request.method !== "POST") return json(response, 405, "method_not_allowed", "Only POST is allowed");

    const upstreamPath = config.paths.get(url.pathname);
    if (!upstreamPath) return json(response, 404, "path_not_allowed", "Provider path is not allowed");
    if (url.search && !(config.provider === "anthropic" && url.search === "?beta=true")) {
      return json(response, 400, "query_not_allowed", "Query parameters are not allowed");
    }

    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      return json(response, error.status ?? 400, "invalid_request", error.message);
    }

    const requestedModel = text(payload.parsed.model);
    if (!requestedModel) return json(response, 400, "model_required", "A model is required");
    if (pinnedModel === null) pinnedModel = requestedModel;
    if (requestedModel !== pinnedModel) {
      return json(response, 409, "model_not_allowed", "The request model does not match this job");
    }
    if (
      config.provider === "openrouter" &&
      OPENROUTER_MODEL_ROUTING_FIELDS.some((field) => Object.hasOwn(payload.parsed, field))
    ) {
      return json(response, 409, "model_not_allowed", "Alternate model routing is not allowed for this job");
    }
    payload.parsed.model = pinnedModel;
    const body = JSON.stringify(payload.parsed);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(new Error("upstream timeout")), config.timeoutMs);
    timeout.unref();
    request.once("aborted", () => abortController.abort(new Error("client disconnected")));
    response.once("close", () => {
      if (!response.writableEnded) abortController.abort(new Error("client disconnected"));
    });

    try {
      const target = new URL(upstreamPath, config.upstream);
      target.search = url.search;
      const upstream = await fetch(target, {
        method: "POST",
        headers: requestHeaders(request, config),
        body,
        redirect: "manual",
        signal: abortController.signal,
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        upstream.body?.cancel();
        return json(response, 502, "upstream_redirect", "Provider returned an unexpected redirect");
      }

      responseHeaders(upstream, response);
      response.writeHead(upstream.status);
      if (!upstream.body) return response.end();
      await pipeline(Readable.fromWeb(upstream.body), response);
    } catch (error) {
      if (response.destroyed) return;
      const timedOut = abortController.signal.aborted && !request.aborted;
      json(response, timedOut ? 504 : 502, timedOut ? "upstream_timeout" : "upstream_unavailable", timedOut ? "Provider request timed out" : "Provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function main() {
  const config = loadConfig();
  const server = createInferenceProxy(config);
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", resolve);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("inference proxy failed to start: invalid configuration\n");
    process.exitCode = 1;
  });
}
