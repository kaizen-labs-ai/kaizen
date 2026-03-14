# Browser Automation

Kaizen can control a Chrome browser to navigate websites, fill out forms, click buttons, extract data, and take screenshots. Anything you can do in a browser, Kaizen can automate.

## Browser Tools

| Tool | Description |
|------|-------------|
| **chrome-navigate** | Navigate to a URL |
| **chrome-snapshot** | Take a screenshot of the current page |
| **chrome-click** | Click on an element |
| **chrome-fill** | Fill in form fields |
| **chrome-evaluate** | Run JavaScript on the page |
| **chrome-wait** | Wait for a condition or element |
| **chrome-new-tab** | Open a new browser tab |
| **chrome-list-tabs** | List all open tabs |
| **chrome-select-tab** | Switch between tabs |

## How It Works

When the agent needs to interact with a website, it launches a Chrome browser instance and uses the browser tools to navigate and interact with pages. The agent can:

- Navigate to URLs and follow links
- Fill out forms and submit them
- Click buttons and interact with UI elements
- Extract text and data from pages
- Take screenshots for visual verification
- Execute JavaScript for complex interactions

## Incognito Mode

You can configure the browser to launch in incognito mode:

1. Go to **Settings > Browser**
2. Enable **Incognito Mode**

In incognito mode, no cookies, history, or cache persist between sessions. This is useful for tasks that require a clean browser state.

## Smart Guardrails

Browser automation includes several built-in guardrails:

- **Verification gate**: For browser tasks, the agent must take a screenshot to verify the page state before completing
- **Progress checks**: Periodic progress checks every 15 browser tool calls
- **Snapshot pruning**: Keeps only the 2 most recent screenshots to manage memory
- **Loop detection**: Detects and breaks repetitive patterns

## Use Cases

- Filling out web forms and applications
- Scraping data from websites
- Monitoring pages for changes
- Testing web applications
- Taking screenshots for reports
- Automating multi-step web workflows
