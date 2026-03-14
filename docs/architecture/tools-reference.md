# Tools Reference

A complete reference of all built-in tools available in Kaizen.

## File Operations

| Tool | Description |
|------|-------------|
| `file-read` | Read file contents (blocks access to vault/env files) |
| `file-write` | Write a file to the run's artifacts directory |
| `download-image` | Download and store an image from a URL |

## Web Access

| Tool | Description |
|------|-------------|
| `web-fetch` | HTTP GET/POST with automatic HTML text extraction |
| `brave-search` | Web search via Brave API (requires Brave Search integration) |
| `brave-instant` | Real-time data: crypto, stocks, weather, currency |
| `brave-image-search` | Image search with thumbnails and dimensions |
| `brave-news-search` | News search with freshness filtering |
| `brave-video-search` | Video search with metadata |

## Browser Control

| Tool | Description |
|------|-------------|
| `chrome-navigate` | Navigate to a URL |
| `chrome-snapshot` | Take a screenshot of the current page |
| `chrome-click` | Click on a page element |
| `chrome-fill` | Fill in form fields |
| `chrome-evaluate` | Execute JavaScript on the page |
| `chrome-wait` | Wait for a condition or element |
| `chrome-new-tab` | Open a new browser tab |
| `chrome-list-tabs` | List all open browser tabs |
| `chrome-select-tab` | Switch to a specific tab |

## Code Execution

| Tool | Description |
|------|-------------|
| `run-snippet` | Execute Python or Node.js code in a sandboxed environment |

## Skill Management

| Tool | Description |
|------|-------------|
| `create-skill` | Create a new skill with tools, sub-skills, and guardrails |
| `edit-skill` | Update an existing skill's instructions, tools, or guardrails |
| `list-skills` | List all available skills |

## Plugin Management

| Tool | Description |
|------|-------------|
| `create-plugin` | Create a new code plugin (triggers the code pipeline) |
| `edit-plugin` | Modify an existing plugin's code |
| `list-plugins` | List all plugins |
| `install-plugin-deps` | Install package dependencies for a plugin |

## Scheduling

| Tool | Description |
|------|-------------|
| `create-schedule` | Create a cron schedule for a skill |
| `list-schedules` | List all schedules |
| `update-schedule` | Modify a schedule's cron, destination, or enabled status |
| `delete-schedule` | Remove a schedule |

## Memory

| Tool | Description |
|------|-------------|
| `read-user-memory` | Read the persistent user memory |
| `write-user-memory` | Append to user memory (triggers LLM-based merge) |
| `write-tool-memory` | Store learned patterns for a specific tool |

## Skill Database

| Tool | Description |
|------|-------------|
| `skill-db-schema` | Inspect tables in a skill's database |
| `skill-db-query` | Execute SELECT queries (read-only, max 500 rows) |
| `skill-db-execute` | Execute DDL/DML (CREATE, INSERT, UPDATE, DELETE) |

## Secrets

| Tool | Description |
|------|-------------|
| `use-secret` | Inject a vault secret into a tool call (value is scrubbed from results) |

## Library Documentation

| Tool | Description |
|------|-------------|
| `context7-resolve` | Resolve a library name to its Context7 ID |
| `context7-docs` | Fetch version-specific documentation for a library |

## UI Components

| Tool | Description |
|------|-------------|
| `shadcn-list` | List available shadcn/ui components |
| `shadcn-docs` | Get documentation for a shadcn/ui component |

## Orchestration (Internal)

These tools are used internally by the agent pipeline:

| Tool | Description |
|------|-------------|
| `advance-phase` | Move the objective to the next phase |
| `save-result` | Save a structured result to artifacts |
| `read-run-history` | Get previous run history for context |
| `list-tools` | List tools available to the current skill |
| `repair-complete` | Signal that repair work is done |

## Zapier Tools

Zapier tools are dynamically imported from your Zapier account. They appear with a `zapier_` prefix (e.g., `zapier_gmail_send_email`). See [Zapier Integration](../integrations/zapier.md) for setup.

## Permission Groups

Tools are grouped by permission level. Each permission can be enabled/disabled per WhatsApp contact:

| Permission | Tools |
|------------|-------|
| **Memory** | read/write-user-memory |
| **Web** | web-fetch, context7-resolve, context7-docs |
| **Extensions** | brave-*, zapier_* |
| **Plugins** | create/edit/list-plugin, install-plugin-deps |
| **Code** | run-snippet |
| **Files** | file-read, file-write, download-image |
| **Browser** | chrome-* |
| **Skills** | create/edit/list-skill |
