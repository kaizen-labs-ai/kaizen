# Architecture Overview

Kaizen uses a **handoff orchestration** pattern where specialized agents pass work through a pipeline, each handling what they're best at.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| State | React Query |
| AI Gateway | OpenRouter (multi-model) |
| Database | SQLite + Prisma |
| Messaging | WhatsApp via Baileys |
| Automation | Zapier (8,000+ apps) |
| Search | Brave Search API |
| MCP | Context7 (library docs) |
| Streaming | Server-Sent Events |

## High-Level Flow

```
User Message
    |
    v
  Router  -->  Classifies intent (simple / complex / image_generation)
    |
    v
  Planner  -->  Researches and outlines approach (complex tasks only)
    |
    v
  Executor  -->  Does the work using tools, skills, integrations
    |
    |--- Code Pipeline (when code is needed)
    |      Developer --> Test --> Review
    |
    v
  Output  -->  Routes final response to user
```

## Key Concepts

### Phases

Every objective moves through a state machine:

1. **Triage** - Router classifies the request
2. **Discovery** - Research and information gathering (complex tasks)
3. **Planning** - Build a step-by-step approach (auto-skipped when discovery already plans)
4. **Executing** - Do the actual work
5. **Reviewing** - Quality check the results
6. **Complete** - Done

### Agents

Each agent is a specialized prompt + model configuration. Agents don't call each other directly. Instead, the orchestrator manages handoffs between phases, with each phase dispatching the appropriate agent.

### Tools

Agents interact with the world through tools. The tool system includes:
- Built-in tools (file operations, web access, browser control, etc.)
- Plugins (custom code scripts)
- Zapier actions (imported from your Zapier account)
- MCP tools (Context7 library docs)

### Skills

Skills are reusable instruction sets that get injected into the executor's context. They tell the agent what to do and which tools to use for a specific task.

## Data Model

### Core Entities

- **Chat** - A conversation thread
- **Message** - User or assistant message within a chat
- **Objective** - A task to accomplish (linked to messages)
- **Run** - A single execution attempt of an objective
- **Step** - An individual action within a run (tool calls, reasoning, errors)
- **Artifact** - Files and outputs produced by runs

### Configuration Entities

- **AgentConfig** - Per-agent model and prompt settings
- **Tool** - Tool definitions (system, plugin, MCP, Zapier)
- **Skill** - Reusable automation definitions
- **Soul** - Personality profiles
- **Setting** - Global key-value configuration
- **Schedule** - Cron-triggered skill execution

## Module Structure

The orchestrator has been decomposed into focused modules:

| Module | Responsibility |
|--------|---------------|
| `orchestrator.ts` | Main `executeRun` loop |
| `agent-loop.ts` | Single agent call cycle with tool execution |
| `code-pipeline.ts` | Developer, test, review pipeline |
| `pipeline-utils.ts` | Shared pipeline helpers |
| `phase-machine.ts` | Phase transition logic |
| `message-builder.ts` | Prompt and context assembly |
| `output-router.ts` | User-facing output emission |
| `agent-gates.ts` | Claim verification, grounding, search-pivot |
| `schemas.ts` | JSON schemas for structured output |
| `prompt-builder.ts` | Skill/tool/memory injection into prompts |
