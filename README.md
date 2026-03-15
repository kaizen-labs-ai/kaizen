<p align="center">
  <h1 align="center">Kaizen</h1>
  <p align="center"><strong>The AI agent that gets the job done.</strong></p>
</p>

<p align="center">
  <a href="https://github.com/kaizen-labs-ai/kaizen/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Alpha">
  <a href="https://github.com/kaizen-labs-ai/kaizen/stargazers"><img src="https://img.shields.io/github/stars/kaizen-labs-ai/kaizen?style=social" alt="Stars"></a>
  <a href="https://github.com/kaizen-labs-ai/kaizen/issues"><img src="https://img.shields.io/github/issues/kaizen-labs-ai/kaizen" alt="Issues"></a>
</p>

<!-- Screenshot or demo GIF goes here -->
<!-- ![Kaizen](docs/screenshot.png) -->

---

Kaizen is an open-source AI automation agent that runs locally on your machine. Give it a task, and a team of specialized agents collaborates to get it done: researching, browsing, automating workflows, and learning from every run. Connect it to 8,000+ apps through Zapier, message it on WhatsApp, and let it handle everything from grocery shopping to business intelligence.

## Why Kaizen?

Most AI tools are stateless. They forget everything between sessions and repeat the same mistakes. Kaizen is different:

- **It automates, not just chats.** Kaizen browses the web, fills out forms, calls APIs, runs code, and connects to thousands of apps to complete real tasks end-to-end.
- **It learns.** After every run, insights and learnings are persisted to memory. The more you use it, the better it gets.
- **It's yours.** Runs entirely on your machine. No data leaves your environment except API calls to the model provider you choose.

## What Can Kaizen Do?

### Everyday Automation

| You say... | Kaizen does... |
|------------|----------------|
| *"Take this photo of a recipe and add all the ingredients to my Instacart cart"* | Reads the image, extracts ingredients and quantities, opens Instacart in the browser, searches for each item, and adds them to your cart |
| *"Every morning, check Hacker News for AI articles and send me a WhatsApp summary"* | Creates a scheduled skill that runs daily, scrapes HN, filters for AI topics, summarizes the top stories, and messages you on WhatsApp |
| *"Find me flights to Tokyo under $800 for next month"* | Searches multiple travel sites, compares prices, and presents the best options with booking links |
| *"Monitor this product page and alert me when the price drops below $50"* | Creates a recurring skill that checks the page on a schedule and sends you a WhatsApp notification when the price target is hit |

### Business Automation

| You say... | Kaizen does... |
|------------|----------------|
| *"Search LinkedIn for senior Python developer jobs in London and classify them by salary range"* | Browses LinkedIn, extracts job listings, classifies by salary band, and generates a structured report |
| *"Every week, pull our sales data from the CRM and build a performance report"* | Creates a scheduled skill that connects to your CRM via Zapier, pulls the data, generates charts and insights, and delivers the report |
| *"Research our top 5 competitors and summarize what they shipped this month"* | Investigates each competitor's blog, changelog, and social media, then produces a competitive intelligence summary |
| *"Take this spreadsheet of leads and enrich each one with company info from the web"* | Reads the spreadsheet, researches each company, adds industry, size, funding, and recent news, then saves the enriched data |

### Creative & Technical

| You say... | Kaizen does... |
|------------|----------------|
| *"Build me a weather dashboard for my city"* | Researches weather APIs, writes the code, tests it through a quality pipeline with visual review, and delivers a working dashboard |
| *"Generate a weekly newsletter from my RSS feeds"* | Creates a skill that fetches feeds, summarizes articles, formats them into a newsletter template, and can send it via Zapier |
| *"Analyze this CSV and tell me what's interesting"* | Reads the data, runs statistical analysis, generates visualizations, and presents findings with insights |

## Skills: Automations That Improve Themselves

Skills are the core of Kaizen. They are reusable automations that the agent creates, executes, and refines over time.

- **Natural language instructions.** "Check the top 10 posts on r/MachineLearning, summarize each one, and send the digest to WhatsApp." That's a complete skill.
- **Created by you or by the agent.** Define skills manually in the UI, or just ask: "create a skill that does X." The agent builds it for you.
- **Guardrails.** Each skill has editable rules that control quality, behavior, and boundaries. Both you and the agent can update them.
- **Sub-skills.** Skills can reference other skills, building complex multi-step workflows from simple building blocks.
- **Scheduling.** Attach a cron schedule to any skill. Daily reports, weekly digests, hourly monitoring. Set it and forget it.
- **Self-improving.** When something goes wrong, insights are persisted to memory. Next time, the skill runs better.

## Integrations

### Zapier (8,000+ Apps)
Connect Kaizen to Gmail, Google Sheets, Slack, Notion, Salesforce, HubSpot, Jira, Trello, and thousands more. The agent can trigger Zapier actions as part of any skill or automation.

### WhatsApp
Message Kaizen directly on WhatsApp. Send it tasks on the go, receive results and notifications, and interact with your automations from your phone.

### Browser Automation
Kaizen can navigate websites, fill out forms, click buttons, extract data, and take screenshots. Anything you can do in a browser, it can automate.

### Brave Search
Real-time web search and image search built in. The agent uses this for research, fact-checking, and finding up-to-date information.

### MCP Servers
Connect any [Model Context Protocol](https://modelcontextprotocol.io/) server to extend Kaizen's capabilities. Version-aware library documentation, custom data sources, and more.

## How It Works

Kaizen uses **handoff orchestration**. Specialized agents pass work through a pipeline, each handling what they're best at:

```
                          ┌─────────────────────────────────────────┐
                          │            KAIZEN PIPELINE              │
                          │                                         │
  User ──► Router ──► Planner ──► Executor ──► Reviewer             │
              │                       │            │                │
              │                       ▼            │                │
              │                 Code Pipeline      │                │
              │              ┌──────────────┐      │                │
              │              │  Developer   │      │                │
              │              │     ▼        │      │                │
              │              │  Test/Run    │      │                │
              │              │     ▼        │      │                │
              │              │  Review      │      │                │
              │              └──────────────┘      │                │
              │                                    │                │
              │              Output ◄─────────────┘                │
              └─────────────────────────────────────────────────────┘
```

**Router** classifies your intent and picks the right path. **Planner** researches the task and builds a step-by-step approach. **Executor** does the work using tools, skills, and integrations. **Developer** writes and tests code when needed. **Reviewer** inspects output for quality.

## Features

### Agents & Intelligence
- **Multi-agent pipeline** with Router, Planner, Executor, Reviewer, and Developer
- **Self-improvement** through persistent memory that accumulates learnings across runs
- **Smart guardrails** including loop detection, failure detection, grounding gates, and claim verification
- **Multi-model** support through [OpenRouter](https://openrouter.ai/): Claude, GPT, Gemini, DeepSeek, and more

### Memory & Learning
- **User memory** is a persistent profile that the agent maintains and compacts over time. It remembers your preferences, accounts, and how you like things done
- **Working memory** provides per-objective context that improves the agent's approach across runs
- **Learning loop** ensures insights from each run are merged into long-term memory

### Interface
- **Chat UI** with a clean dark mode interface built with shadcn/ui
- **WhatsApp** for messaging Kaizen from your phone
- **Soul** for customizable agent personality (tone, style, values)
- **Step viewer** shows exactly what each agent is doing in real time
- **Fully local.** Your data stays on your machine, secrets stored in an encrypted vault (AES-256-GCM)

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- [Git](https://git-scm.com/)

### Install & Run

```bash
git clone https://github.com/kaizen-labs-ai/kaizen.git
cd kaizen
npm run setup
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). On first launch, you'll be prompted to enter your [OpenRouter](https://openrouter.ai/) API key. It's stored in an encrypted local vault, never in plain text.

### Connect WhatsApp

Scan the QR code in Settings > WhatsApp to link your account. You can then message Kaizen directly from your phone.

### Connect Zapier

Add your Zapier API key in Settings > Extensions to unlock 8,000+ app integrations.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js](https://nextjs.org/) (App Router) |
| Language | TypeScript |
| UI | [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/) |
| State | [React Query](https://tanstack.com/query) |
| AI Gateway | [OpenRouter](https://openrouter.ai/) (multi-model) |
| Database | [SQLite](https://www.sqlite.org/) + [Prisma](https://www.prisma.io/) |
| Messaging | [WhatsApp](https://www.whatsapp.com/) via Baileys |
| Automation | [Zapier](https://zapier.com/) (8,000+ apps) |
| Search | [Brave Search API](https://brave.com/search/api/) |
| Streaming | Server-Sent Events |

## Status

Kaizen is in **alpha**. The core pipeline, skills system, and integrations are working, but expect rough edges. We're actively building and improving. More integrations, more capabilities, and a smoother experience are on the way.

## Documentation

Full documentation at [kaizen-4.gitbook.io/kaizen-docs](https://kaizen-4.gitbook.io/kaizen-docs).

## Contributing

Kaizen is in early development. We're not accepting pull requests yet, but bug reports and feature requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Found a vulnerability? Please don't open a public issue. See [SECURITY.md](./SECURITY.md) for responsible disclosure.

## License

[MIT](./LICENSE). Use it, fork it, build on it.

---

<p align="center">
  Built by <a href="https://kaizen-labs.ai">Kaizen Labs</a>
</p>
