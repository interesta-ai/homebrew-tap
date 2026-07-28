FROM node:24-bookworm-slim AS inference-runtime

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/orchestrator

RUN npm install --omit=dev --no-audit --no-fund --save-exact \
        @anthropic-ai/claude-agent-sdk@0.3.212 \
        @anthropic-ai/sdk@0.112.1 \
        @modelcontextprotocol/sdk@1.29.0 \
        zod@4.4.3

COPY claude-runner.mjs inference-proxy.mjs /opt/orchestrator/

RUN node --check /opt/orchestrator/claude-runner.mjs \
    && node --check /opt/orchestrator/inference-proxy.mjs \
    && node /opt/orchestrator/claude-runner.mjs --sdk-smoke

FROM inference-runtime AS inference-proxy

LABEL org.opencontainers.image.source="https://github.com/interesta-ai/homebrew-tap" \
      org.opencontainers.image.title="orchestrator-inference-proxy" \
      org.opencontainers.image.description="Trusted inference proxy for Interesta Orchestrator"

CMD ["node", "/opt/orchestrator/inference-proxy.mjs"]

FROM debian:bookworm-slim AS agent-common

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV CODEX_HOME=/root/.codex \
    DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    MISE_YES=1 \
    PATH=/root/.local/share/mise/shims:/root/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        gh \
        git \
        jq \
        libatomic1 \
        openssh-client \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        tar \
        unzip \
        xz-utils \
        zip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh \
    && mise install node@24 pnpm@11.9.0 \
    && mise use -g node@24 pnpm@11.9.0 \
    && node --version \
    && pnpm --version

COPY --from=inference-runtime /opt/orchestrator/node_modules /opt/orchestrator/node_modules
COPY --from=inference-runtime /opt/orchestrator/claude-runner.mjs /opt/orchestrator/claude-runner.mjs

RUN node --check /opt/orchestrator/claude-runner.mjs \
    && node /opt/orchestrator/claude-runner.mjs --sdk-smoke \
    && mkdir -p "${CODEX_HOME}" \
    && curl -fsSL https://chatgpt.com/codex/install.sh \
        | CODEX_NON_INTERACTIVE=1 CODEX_INSTALL_DIR=/usr/local/bin sh \
    && codex --version

WORKDIR /workspace

CMD ["sh", "-c", "trap : TERM INT; sleep infinity & wait"]

FROM agent-common AS issue-planner-agent

LABEL org.opencontainers.image.source="https://github.com/interesta-ai/homebrew-tap" \
      org.opencontainers.image.title="orchestrator-issue-planner-agent" \
      org.opencontainers.image.description="Issue planning agent for Interesta Orchestrator"

FROM agent-common AS compiler-agent

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

FROM compiler-agent AS repository-review-agent

LABEL org.opencontainers.image.source="https://github.com/interesta-ai/homebrew-tap" \
      org.opencontainers.image.title="orchestrator-repository-review-agent" \
      org.opencontainers.image.description="Repository review agent for Interesta Orchestrator"

FROM compiler-agent AS pr-review-agent

LABEL org.opencontainers.image.source="https://github.com/interesta-ai/homebrew-tap" \
      org.opencontainers.image.title="orchestrator-pr-review-agent" \
      org.opencontainers.image.description="Pull request review agent for Interesta Orchestrator"

FROM compiler-agent AS code-agent

RUN npm install --global --no-audit --no-fund playwright@1.55.0 \
    && mise reshim \
    && playwright install --with-deps chromium \
    && playwright --version \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.source="https://github.com/interesta-ai/homebrew-tap" \
      org.opencontainers.image.title="orchestrator-code-agent" \
      org.opencontainers.image.description="Code agent with Chromium and Playwright for Interesta Orchestrator"
