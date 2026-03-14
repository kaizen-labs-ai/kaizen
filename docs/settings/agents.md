# Agents

Each agent in Kaizen's pipeline can be individually configured with its own model, settings, and custom prompt.

## Viewing Agents

Go to **Settings > Agents** (`/settings/agents`) to see all agents. Each entry shows:

- Agent name and role
- Current model
- Whether extended thinking is enabled
- Extra model badges (image, file, audio, video models)

## Agent Settings

Click on any agent to configure:

### Model

Choose which AI model the agent uses. Any model available on [OpenRouter](https://openrouter.ai/) can be selected. Different agents benefit from different models:

- **Fast, cheap models** (Gemini Flash) work well for routing and planning
- **Capable models** (Claude Sonnet, GPT-4o) work well for execution
- **Thinking models** (Claude with thinking) work well for complex code

### Specialized Models

Some agents support specialized models for different content types:

| Model Type | Purpose |
|------------|---------|
| **Image Model** | Processing and generating images |
| **File Model** | Analyzing documents |
| **Audio Model** | Transcribing audio |
| **Video Model** | Analyzing video content |

### Extended Thinking

Toggle extended thinking to give the model more reasoning time for complex problems. This is especially useful for the Developer agent when writing complex code.

### Timeout

Set the maximum time (10-600 seconds) for a single model call. Increase this for complex tasks that need more processing time.

### System Prompt

Each agent has a system prompt that defines its behavior and capabilities. You can view and customize the prompt for each agent. Changes are auto-saved.

### Interactive Planning

The Planner agent has a special **Interactive Planning** toggle. When enabled, the planner proposes its plan to you for approval before execution proceeds. When disabled, planning happens automatically.

## Default Agents

| Agent | Role | Default Model |
|-------|------|---------------|
| **Router** | Classifies user intent and picks the right path | Claude Sonnet |
| **Planner** | Researches the task and builds a step-by-step approach | Gemini Flash |
| **Executor** | Does the work using tools, skills, and integrations | Claude Sonnet |
| **Developer** | Writes and tests code in the code pipeline | Claude Sonnet (thinking) |
| **Reviewer** | Inspects code pipeline output and describes what it sees | Varies by modality |
| **Titler** | Generates chat titles | Gemini Flash |
| **Compactor** | Compresses long conversation histories | Gemini Flash |
| **Reflection** | Analyzes runs for quality gaps | Configurable |
| **Repair** | Fixes issues found by reflection | Configurable |
