# docs-companies-agents-ops

**OpenClaw orchestration layer — scripts, schemas, bot, and infrastructure.**

This repository contains the OpenClaw-native orchestration infrastructure: Discord bot, database schemas, deployment scripts, and adapter configurations.

**Knowledge content (agents, companies, skills, disciplines, triggers) lives in [`docs-companies-agents-knowledge`](https://github.com/Construct-AI-primary/docs-companies-agents-knowledge).**

## Repository Structure

```
├── scripts/                   ← Discord bot (bot.js, bot-core.js, bot-channels.js, bot-registry.js)
├── schema/                    ← SQLite database schemas
├── sql/                       ← SQL scripts and data manipulation
├── migration/                 ← Paperclip→OpenClaw migration docs
├── adapters/                  ← OpenClaw adapter configurations
├── agent-companies-core/      ← Submodule (kept for history)
└── agent-companies-paperclip/ ← Submodule (kept for history)
```

## Related Repositories

| Repo | Purpose |
|------|---------|
| **[docs-companies-agents-knowledge](https://github.com/Construct-AI-primary/docs-companies-agents-knowledge)** | **Flat knowledge repo** — agents, companies, skills, disciplines, triggers, orchestration docs |
| `agent-companies-core` | Original source (kept for history) |
| `agent-companies-paperclip` | Paperclip application (server, UI, CLI, packages) |

## Quick Start

```bash
# Clone this repo
git clone https://github.com/Construct-AI-primary/docs-companies-agents-ops.git
cd docs-companies-agents-ops

# Initialize submodules
git submodule update --init --recursive