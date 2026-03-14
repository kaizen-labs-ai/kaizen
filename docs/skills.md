# Skills

Skills are reusable automations that the agent creates, executes, and refines over time. They are the core building block for repeatable tasks.

## What is a Skill?

A skill is a set of natural language instructions that tell Kaizen how to perform a specific task. For example:

> "Check the top 10 posts on r/MachineLearning, summarize each one, and send the digest to WhatsApp."

That's a complete skill. No code required.

## Creating a Skill

### From the UI

1. Go to **Skills** (`/skills`)
2. Click **Create Skill**
3. Fill in the name, description, and instructions
4. Optionally link tools, add guardrails, or attach reference files
5. The skill auto-saves as you edit

### From Chat

Ask the agent directly:

> "Create a skill that checks Hacker News daily for AI articles and sends me a summary on WhatsApp."

The agent will create the skill, configure its tools, and set up guardrails automatically.

## Skill Fields

| Field | Description |
|-------|-------------|
| **Name** | Short identifier for the skill |
| **Description** | One-line summary of what the skill does |
| **Instructions** | Full natural language instructions for the agent to follow |
| **Model Preference** | Optional model override (otherwise uses the executor's default) |
| **Enabled** | Toggle to activate or deactivate the skill |

## Sub-Skills

Skills can reference other skills as sub-skills, building complex multi-step workflows from simple building blocks.

For example, a "Weekly Report" skill might use:
1. A "Data Collection" sub-skill to gather information
2. An "Analysis" sub-skill to process the data
3. A "Formatting" sub-skill to generate the report

Sub-skills have a **position** (execution order) and a **role** (semantic description of their purpose). Manage them in the skill detail page under the **Sub-skills** section.

## Guardrails

Guardrails are rules that control a skill's behavior and boundaries. Each guardrail has a type:

| Type | Purpose | Example |
|------|---------|---------|
| **must** | Behavior the skill must follow | "Must include source URLs in summaries" |
| **must_not** | Forbidden behaviors | "Must not share personal data externally" |
| **limit** | Constraints on scope | "Limit results to the top 5 items" |

Guardrails can be set as editable by:
- **Both** (default): You and the agent can modify them
- **User only**: Only you can change them
- **Agent only**: The agent can refine them based on experience

The agent can update guardrails during reflection when it learns what works better.

## Attachments

Attach reference files to a skill (PDFs, documents, images, etc.). These files are included as context when the skill runs, giving the agent additional information to work with.

- Maximum file size: 20MB
- Files are stored in the skill's workspace directory
- Re-uploading a file with the same name replaces the previous version

## Linked Tools

Skills can be linked to specific tools (system tools, plugins, or Zapier actions). This helps the agent know which tools are relevant for the skill. You can manage linked tools in the skill detail page.

## Vault Entries

If a skill needs access to specific secrets (API keys, credentials), you can link vault entries to it. Only linked secrets are available during execution.

## Skill Database

Each skill can have its own SQLite database for persistent data storage. The agent can create tables, insert records, and query data across runs. This is useful for skills that need to track state over time (e.g., a price monitoring skill that records historical prices).

Access the skill database from the **Database** tab in the skill detail page.

## Self-Improvement

When a skill runs and something goes wrong, the reflection agent analyzes the failure. If the repair agent fixes the approach, those learnings are persisted. The next time the skill runs, it benefits from the previous experience. Over time, skills get more reliable and effective.
