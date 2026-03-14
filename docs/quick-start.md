# Quick Start

## Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- [Git](https://git-scm.com/)

## Install & Run

```bash
git clone https://github.com/kaizen-labs-ai/kaizen.git
cd kaizen
npm run setup
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000).

> **Development mode**: If you want to run with hot-reloading for development, use `npm run dev` instead of `npm run build && npm start`.

## First Launch

On first launch, you'll be prompted to enter your [OpenRouter](https://openrouter.ai/) API key. This key gives Kaizen access to AI models (Claude, GPT, Gemini, etc.).

1. Go to [openrouter.ai](https://openrouter.ai/) and create an account
2. Generate an API key
3. Paste it into the setup dialog

The key is stored in an encrypted local vault (AES-256-GCM), never in plain text or environment variables.

## Your First Task

1. Click **New Chat**
2. Type a task, for example: "Search the web for the latest AI news and summarize the top 3 stories"
3. Press Enter

Kaizen will route your request through its agent pipeline, use the appropriate tools, and return the result. You can watch each step in real time by toggling **Dev** mode in the chat header.

## What's Next

- [Connect WhatsApp](integrations/whatsapp.md) to message Kaizen from your phone
- [Connect Zapier](integrations/zapier.md) to unlock 8,000+ app integrations
- [Set up Brave Search](integrations/brave-search.md) for web search capabilities
- [Create your first skill](skills.md) to build a reusable automation
- [Configure agents](settings/agents.md) to choose which AI models to use

## Updating

To update Kaizen to the latest version:

```bash
git pull
npm run setup
npm run build
npm start
```

Stop the server before updating. This pulls the latest code, applies any new dependencies or database changes, rebuilds the app, and starts it again. Your data (chats, skills, memory, secrets) is preserved.
