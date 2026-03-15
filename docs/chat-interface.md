# Chat Interface

The chat interface is where you interact with Kaizen. Type a task, and the agent pipeline handles the rest.

## Starting a Chat

Navigate to **Chats** and click **New Chat**, or go directly to `/chats/new`. Type your objective and press Enter.

You can optionally launch a chat with a pre-selected skill or plugin by choosing one from the sidebar before typing.

## Message Features

- **Markdown rendering** for formatted responses (headings, code blocks, lists, links, images)
- **Thinking blocks** show the agent's reasoning process (collapsible)
- **Plan proposals** let you choose between approaches when the agent wants your input
- **Artifacts** (files, images, reports) are displayed inline with download and preview options

## Dev Mode

Toggle the **Dev** button in the chat header to see exactly what each agent is doing:

- **Routing decisions** showing how your request was classified
- **Tool calls** with inputs, outputs, and duration
- **Agent handoffs** as work passes through the pipeline
- **Memory retrieval** and context building
- **Code pipeline** execution (developer, test, review steps)

Dev mode shows the full step-by-step execution with timing information.

## Chat Management

- **Search** across all chats by name or content
- **Rename** any chat from the sidebar
- **Delete** individual chats or use bulk select for multiple deletions
- **Unread indicators** show which chats have new responses

## Active Run Status

While a run is in progress, the chat shows a real-time activity label (e.g., "Thinking", "Searching", "Browsing") with an animated indicator. The sidebar also shows which chats have active runs.

## File Attachments

You can attach files to your message. The agent will process them based on the file type (images, documents, spreadsheets, etc.).

## Outputs

Files and artifacts generated during a run are available in the chat and also accessible from the **Outputs** page (`/outputs`).
