# OpenRouter

[OpenRouter](https://openrouter.ai/) is the AI gateway that gives Kaizen access to models from multiple providers through a single API.

## Setup

1. Go to [openrouter.ai](https://openrouter.ai/) and create an account
2. Generate an API key from your dashboard
3. On first launch, Kaizen prompts you to enter the key
4. The key is stored in your local encrypted vault

You can also add or update the key in **Vault** (`/secrets`).

## Supported Models

OpenRouter gives access to 100+ models from various providers. Some commonly used ones:

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Sonnet, Claude Opus |
| **OpenAI** | GPT-4o, GPT-4 Turbo |
| **Google** | Gemini 2.5 Flash, Gemini 3 Flash |
| **DeepSeek** | DeepSeek V3, DeepSeek R1 |
| **Meta** | Llama 3.x |

## Multi-Model Architecture

Kaizen uses different models for different agents. Each agent can be configured with its own model in **Settings > Agents**:

| Agent | Default Model | Why |
|-------|--------------|-----|
| Router | Claude Sonnet | Fast classification |
| Executor | Claude Sonnet | Reliable tool use |
| Developer | Claude Sonnet (with thinking) | Complex code reasoning |
| Planner | Gemini Flash | Lightweight research |
| Reviewer | Varies by modality | Image/audio/video analysis |

You can override any agent's model in the settings. OpenRouter handles routing to the correct provider.

## Multimodal Support

Through OpenRouter, Kaizen supports:

- **Text** input and output
- **Image** input (base64 or URL) and generation
- **Audio** input for voice transcription
- **Video** input for analysis
- **File** input for document processing

## Cost Tracking

Kaizen tracks token usage and costs per model and per agent. View your usage breakdown in **Usage** (`/usage`):

- Total cost and token usage
- Daily cost trend chart
- Cost breakdown by model
- Cost breakdown by agent

## Extended Thinking

Some agents (like the Developer) use extended thinking mode, which gives the model more reasoning time for complex problems. This can be toggled per agent in the settings.
