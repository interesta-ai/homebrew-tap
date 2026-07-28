# Interesta Homebrew Tap

Official package metadata, release binaries, and public container image sources
for Interesta Orchestrator. This repository does not contain the private CLI
source code.

## Install

On macOS or Linux:

```sh
brew install interesta-ai/tap/orchestrator
```

## Container images

The Orchestrator CLI pulls the image selected for each enabled agent when it is
not already available locally. The official images are:

| Runtime | Image |
| --- | --- |
| Code | `ghcr.io/interesta-ai/orchestrator-code-agent:latest` |
| Repository Review | `ghcr.io/interesta-ai/orchestrator-repository-review-agent:latest` |
| PR Review | `ghcr.io/interesta-ai/orchestrator-pr-review-agent:latest` |
| Issue Planner | `ghcr.io/interesta-ai/orchestrator-issue-planner-agent:latest` |
| Trusted inference proxy | `ghcr.io/interesta-ai/orchestrator-inference-proxy:latest` |

Agent images include GitHub CLI, Git, Node.js 24, pnpm, Python, Codex, and mise.
Code and review images also include compiler basics; only the Code image
includes Chromium and Playwright. Repository-specific language toolchains
should be installed with mise.

All five targets are defined in [`images/Dockerfile`](images/Dockerfile).
Pull requests test the runtime scripts, build both supported architectures, and
smoke-test every target. Changes merged to `main` publish `linux/amd64` and
`linux/arm64` manifests to GitHub Container Registry.

New GHCR packages are private by default. After their first publication, an
organization owner must make each package public once in GitHub package
settings. The publish workflow then verifies each manifest and an anonymous
pull.

To run the source tests locally:

```sh
node --test images/claude-runner.test.mjs images/inference-proxy.test.mjs
```

To build a target locally:

```sh
docker build --file images/Dockerfile --target code-agent --tag orchestrator-code-agent:local images
```

## License

The Orchestrator CLI is proprietary software from Interesta Inc. This repository
distributes package metadata, release binaries, and runtime container sources.
