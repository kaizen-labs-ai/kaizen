# Introduction

Kaizen is an open-source AI automation agent that runs locally on your machine. Give it a task, and a team of specialized agents collaborates to get it done: researching, browsing, automating workflows, and learning from every run.

## Why Kaizen?

Most AI tools are stateless. They forget everything between sessions and repeat the same mistakes. Kaizen is different:

- **It automates, not just chats.** Kaizen browses the web, fills out forms, calls APIs, runs code, and connects to thousands of apps to complete real tasks end-to-end.
- **It learns.** After every run, reflection and repair agents analyze what happened, identify gaps, and persist improvements to memory. The more you use it, the better it gets.
- **It's yours.** Runs entirely on your machine. No data leaves your environment except API calls to the model provider you choose.

## What Can Kaizen Do?

### Everyday Automation

| You say... | Kaizen does... |
|------------|----------------|
| "Take this photo of a recipe and add all the ingredients to my Instacart cart" | Reads the image, extracts ingredients and quantities, opens Instacart in the browser, searches for each item, and adds them to your cart |
| "Every morning, check Hacker News for AI articles and send me a WhatsApp summary" | Creates a scheduled skill that runs daily, scrapes HN, filters for AI topics, summarizes the top stories, and messages you on WhatsApp |
| "Find me flights to Tokyo under $800 for next month" | Searches multiple travel sites, compares prices, and presents the best options with booking links |

### Business Automation

| You say... | Kaizen does... |
|------------|----------------|
| "Search LinkedIn for senior Python developer jobs and classify them by salary range" | Browses LinkedIn, extracts job listings, classifies by salary band, and generates a structured report |
| "Every week, pull our sales data from the CRM and build a performance report" | Creates a scheduled skill that connects to your CRM via Zapier, pulls the data, generates charts, and delivers the report |
| "Research our top 5 competitors and summarize what they shipped this month" | Investigates each competitor's blog, changelog, and social media, then produces a competitive intelligence summary |

### Creative & Technical

| You say... | Kaizen does... |
|------------|----------------|
| "Build me a weather dashboard for my city" | Researches weather APIs, writes the code, tests it through a quality pipeline with visual review, and delivers a working dashboard |
| "Analyze this CSV and tell me what's interesting" | Reads the data, runs statistical analysis, generates visualizations, and presents findings with insights |

## Key Features

- **Multi-agent pipeline** with specialized agents for routing, planning, executing, reviewing, and repairing
- **Skills system** for reusable automations that improve themselves over time
- **Scheduling** to run any skill on a cron schedule
- **Plugins** for custom code (Python, Node.js, TypeScript, Bash, Ruby)
- **Integrations** with WhatsApp, Zapier (8,000+ apps), Brave Search, and browser automation
- **Memory** that persists across sessions and improves with every run
- **Multi-model support** via OpenRouter: Claude, GPT, Gemini, DeepSeek, and more
- **Fully local** with secrets stored in an encrypted vault (AES-256-GCM)
