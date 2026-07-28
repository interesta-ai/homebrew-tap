import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createInferenceProxy, loadConfig } from "./inference-proxy.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("proxy authenticates, replaces credentials, streams, and pins the first model", async (context) => {
  const seen = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: one\n\n");
    response.end("data: two\n\n");
  });
  const upstreamPort = await listen(upstream);
  context.after(() => upstream.close());

  const proxy = createInferenceProxy({
    provider: "openai",
    authMode: "api_key",
    credential: "real-provider-key",
    token: "j".repeat(48),
    model: null,
    port: 0,
    timeoutMs: 5_000,
    upstream: `http://127.0.0.1:${upstreamPort}`,
    paths: new Map([["/v1/responses", "/v1/responses"]]),
  });
  const proxyPort = await listen(proxy);
  context.after(() => proxy.close());

  const unauthorized = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "model-a" }),
  });
  assert.equal(unauthorized.status, 401);

  const modelsBeforePin = await fetch(
    `http://127.0.0.1:${proxyPort}/v1/models?client_version=0.144.6`,
    { headers: { authorization: `Bearer ${"j".repeat(48)}` } },
  );
  assert.deepEqual(await modelsBeforePin.json(), { models: [] });

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${"j".repeat(48)}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "model-a", stream: true }),
  });
  assert.equal(await response.text(), "data: one\n\ndata: two\n\n");
  assert.deepEqual(seen, [{ authorization: "Bearer real-provider-key", body: { model: "model-a", stream: true } }]);

  const modelsAfterPin = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`, {
    headers: { authorization: `Bearer ${"j".repeat(48)}` },
  });
  assert.deepEqual(await modelsAfterPin.json(), { models: [] });

  const mismatch = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
    method: "POST",
    headers: { "x-api-key": "j".repeat(48), "content-type": "application/json" },
    body: JSON.stringify({ model: "model-b" }),
  });
  assert.equal(mismatch.status, 409);
  assert.equal(seen.length, 1);

  const query = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses?provider=other`, {
    method: "POST",
    headers: { authorization: `Bearer ${"j".repeat(48)}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "model-a" }),
  });
  assert.equal(query.status, 400);
  assert.equal(seen.length, 1);
});

test("proxy survives an upstream stream disconnect", async (context) => {
  const upstream = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: partial\n\n");
    setImmediate(() => response.socket.destroy());
  });
  const upstreamPort = await listen(upstream);
  context.after(() => upstream.close());

  const proxy = createInferenceProxy({
    provider: "openai",
    authMode: "api_key",
    credential: "real-provider-key",
    token: "j".repeat(48),
    model: "model-a",
    port: 0,
    timeoutMs: 5_000,
    upstream: `http://127.0.0.1:${upstreamPort}`,
    paths: new Map([["/v1/responses", "/v1/responses"]]),
  });
  const proxyPort = await listen(proxy);
  context.after(() => proxy.close());

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${"j".repeat(48)}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "model-a", stream: true }),
  });
  await assert.rejects(response.text());

  const health = await fetch(`http://127.0.0.1:${proxyPort}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
});

test("OpenRouter rejects alternate model routing and forwards one canonical pinned model", async (context) => {
  const seen = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream);
  context.after(() => upstream.close());

  const proxy = createInferenceProxy({
    provider: "openrouter",
    authMode: "api_key",
    credential: "real-provider-key",
    token: "j".repeat(48),
    model: "model-a",
    port: 0,
    timeoutMs: 5_000,
    upstream: `http://127.0.0.1:${upstreamPort}`,
    paths: new Map([["/v1/chat/completions", "/api/v1/chat/completions"]]),
  });
  const proxyPort = await listen(proxy);
  context.after(() => proxy.close());
  const request = (body) => fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${"j".repeat(48)}`, "content-type": "application/json" },
    body,
  });

  for (const alternate of [
    { models: ["model-b"] },
    { fallbacks: [{ model: "model-b" }] },
    { route: "fallback" },
    { preset: "change-model" },
  ]) {
    const response = await request(JSON.stringify({ model: "model-a", ...alternate }));
    assert.equal(response.status, 409);
  }
  assert.equal(seen.length, 0);

  const response = await request('{ "model": "model-b", "model": " model-a ", "messages": [] }');
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ['{"model":"model-a","messages":[]}']);
});

test("proxy configuration requires only its selected credential", () => {
  const token = "j".repeat(48);
  const config = loadConfig({
    ORCHESTRATOR_PROXY_PROVIDER: "anthropic",
    ORCHESTRATOR_PROXY_AUTH_MODE: "oauth",
    ORCHESTRATOR_PROXY_CREDENTIAL: "real-oauth-token",
    ORCHESTRATOR_PROXY_TOKEN: token,
  });
  assert.equal(config.upstream, "https://api.anthropic.com");
  assert.equal(config.paths.get("/v1/messages/count_tokens"), "/v1/messages/count_tokens");
  assert.throws(() => loadConfig({
    ORCHESTRATOR_PROXY_PROVIDER: "anthropic",
    ORCHESTRATOR_PROXY_AUTH_MODE: "oauth",
    ORCHESTRATOR_PROXY_CREDENTIAL: "real-oauth-token",
    ORCHESTRATOR_PROXY_TOKEN: token,
    OPENAI_API_KEY: "another-real-key",
  }), /invalid configuration/);
});

test("OpenAI OAuth reads a private auth file and replaces client auth and account headers", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "orchestrator-proxy-auth-"));
  const authFile = join(directory, "auth.json");
  await writeFile(authFile, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { access_token: "real-access-token", account_id: "real-account-id" },
  }), { mode: 0o600 });
  context.after(() => rm(directory, { recursive: true, force: true }));

  const config = loadConfig({
    ORCHESTRATOR_PROXY_PROVIDER: "openai",
    ORCHESTRATOR_PROXY_AUTH_MODE: "oauth",
    ORCHESTRATOR_PROXY_AUTH_FILE: authFile,
    ORCHESTRATOR_PROXY_TOKEN: "j".repeat(48),
    ORCHESTRATOR_PROXY_MODEL: "gpt-test",
  });
  assert.equal(config.upstream, "https://chatgpt.com");
  assert.equal(config.paths.get("/v1/responses"), "/backend-api/codex/responses");
  assert.equal(config.paths.get("/v1/responses/compact"), "/backend-api/codex/responses/compact");

  const seen = [];
  const upstream = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    seen.push({
      path: request.url,
      authorization: request.headers.authorization,
      accountId: request.headers["chatgpt-account-id"],
      apiKey: request.headers["x-api-key"],
      organization: request.headers["openai-organization"],
      project: request.headers["openai-project"],
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream);
  context.after(() => upstream.close());
  config.upstream = `http://127.0.0.1:${upstreamPort}`;
  const proxy = createInferenceProxy(config);
  const proxyPort = await listen(proxy);
  context.after(() => proxy.close());

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"j".repeat(48)}`,
      "chatgpt-account-id": "client-account-id",
      "content-type": "application/json",
      "openai-organization": "client-organization",
      "openai-project": "client-project",
      "x-api-key": "client-api-key",
      "x-openai-account-id": "client-openai-account-id",
    },
    body: JSON.stringify({ model: "gpt-test" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{
    path: "/backend-api/codex/responses",
    authorization: "Bearer real-access-token",
    accountId: "real-account-id",
    apiKey: undefined,
    organization: undefined,
    project: undefined,
  }]);
  assert.doesNotMatch(JSON.stringify(seen), /client-(?:account|api|openai|organization|project)/);
});

test("OpenAI OAuth rejects missing, malformed, linked, or broadly-readable auth files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "orchestrator-proxy-auth-invalid-"));
  const authFile = join(directory, "auth.json");
  const linkedFile = join(directory, "linked-auth.json");
  const oversizedFile = join(directory, "oversized-auth.json");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const environment = (path) => ({
    ORCHESTRATOR_PROXY_PROVIDER: "openai",
    ORCHESTRATOR_PROXY_AUTH_MODE: "oauth",
    ORCHESTRATOR_PROXY_AUTH_FILE: path,
    ORCHESTRATOR_PROXY_TOKEN: "j".repeat(48),
  });

  assert.throws(() => loadConfig(environment(join(directory, "missing.json"))), /invalid configuration/);
  assert.throws(() => loadConfig(environment("relative-auth.json")), /invalid configuration/);

  await writeFile(authFile, "{}", { mode: 0o600 });
  assert.throws(() => loadConfig(environment(authFile)), /invalid configuration/);
  await writeFile(authFile, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { access_token: "real-access-token", account_id: "real-account-id" },
  }));
  await chmod(authFile, 0o644);
  assert.throws(() => loadConfig(environment(authFile)), /invalid configuration/);
  await chmod(authFile, 0o600);
  await symlink(authFile, linkedFile);
  assert.throws(() => loadConfig(environment(linkedFile)), /invalid configuration/);
  await writeFile(oversizedFile, " ".repeat(64 * 1024 + 1), { mode: 0o600 });
  assert.throws(() => loadConfig(environment(oversizedFile)), /invalid configuration/);
});

test("Anthropic auth modes replace synthetic credentials and preserve SDK beta headers", async (context) => {
  const seen = [];
  const upstream = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    seen.push({
      path: request.url,
      authorization: request.headers.authorization,
      apiKey: request.headers["x-api-key"],
      beta: request.headers["anthropic-beta"],
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream);
  context.after(() => upstream.close());

  for (const { authMode, credential, inboundHeader } of [
    { authMode: "api_key", credential: "real-api-key", inboundHeader: { "x-api-key": "s".repeat(48) } },
    {
      authMode: "oauth",
      credential: "real-oauth-token",
      inboundHeader: { authorization: `Bearer ${"s".repeat(48)}`, "anthropic-beta": "sdk-oauth-beta" },
    },
  ]) {
    const proxy = createInferenceProxy({
      provider: "anthropic",
      authMode,
      credential,
      token: "s".repeat(48),
      model: "claude-model",
      port: 0,
      timeoutMs: 5_000,
      upstream: `http://127.0.0.1:${upstreamPort}`,
      paths: new Map([["/v1/messages", "/v1/messages"]]),
    });
    const proxyPort = await listen(proxy);
    const path = authMode === "oauth" ? "/v1/messages?beta=true" : "/v1/messages";
    const response = await fetch(`http://127.0.0.1:${proxyPort}${path}`, {
      method: "POST",
      headers: { ...inboundHeader, "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-model" }),
    });
    assert.equal(response.status, 200);
    if (authMode === "oauth") {
      const rejected = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages?beta=false`, {
        method: "POST",
        headers: { ...inboundHeader, "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-model" }),
      });
      assert.equal(rejected.status, 400);
    }
    proxy.close();
  }

  assert.deepEqual(seen, [
    { path: "/v1/messages", authorization: undefined, apiKey: "real-api-key", beta: undefined },
    {
      path: "/v1/messages?beta=true",
      authorization: "Bearer real-oauth-token",
      apiKey: undefined,
      beta: "sdk-oauth-beta",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(seen), /s{32}/);
});
