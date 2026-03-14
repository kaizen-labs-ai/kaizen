# Zapier

Connect Kaizen to 8,000+ apps through Zapier. Send emails via Gmail, create rows in Google Sheets, post messages to Slack, update CRM records, and more.

## Setup

1. Go to **Extensions** (`/extensions`)
2. Click on **Zapier**
3. Enter your Zapier API key
4. Click **Connect**

Kaizen will discover all your configured Zapier actions and import them as tools.

## How It Works

Kaizen connects to Zapier via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). When you connect:

1. Kaizen discovers all available Zapier actions from your account
2. Each action is imported as a tool (e.g., "Gmail: Send Email", "Google Sheets: Create Row")
3. Tools appear in the **Tools** page with a `zapier_` prefix
4. The agent can call these tools during any run

## Managing Zapier Tools

In the **Extensions > Zapier** page:

- **View** all imported Zapier tools grouped by app
- **Enable/Disable** individual tools
- **Sync** to refresh the tool list (picks up new Zapier actions)
- **View** the last sync timestamp

You can also enable/disable Zapier tools from the main **Tools** page.

## Configuring Zapier Actions

Zapier actions are configured in your [Zapier dashboard](https://zapier.com/). Add new actions there, then sync in Kaizen to make them available.

Common integrations:

| App | Example Actions |
|-----|----------------|
| **Gmail** | Send email, search emails |
| **Google Sheets** | Create/update rows, read data |
| **Slack** | Send messages, create channels |
| **Notion** | Create pages, update databases |
| **Salesforce** | Create/update records |
| **HubSpot** | Manage contacts, deals |
| **Jira** | Create/update issues |
| **Trello** | Create/move cards |

## Security

- Your Zapier API key is stored in the encrypted local vault
- Kaizen automatically scrubs sensitive data (bearer tokens, API keys) from Zapier tool responses before passing them to the AI model
- Responses are capped at 30,000 characters to stay within model context limits
