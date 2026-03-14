# WhatsApp

Message Kaizen directly on WhatsApp. Send it tasks on the go, receive results and notifications, and interact with your automations from your phone.

## Setup

1. Go to **Channels** (`/channels`)
2. Click on **WhatsApp**
3. Click **Start Pairing**
4. Scan the QR code with your WhatsApp app (Settings > Linked Devices > Link a Device)
5. Wait for the connection to establish

Once paired, Kaizen stays connected. If the connection drops, it automatically reconnects.

## Sending Messages

Message Kaizen on WhatsApp just like you would in the web chat. It supports:

- **Text messages** with task descriptions
- **Images** (Kaizen can analyze and process them)
- **Videos** for analysis
- **Audio** messages (transcribed automatically)
- **Documents** (PDFs, spreadsheets, etc.)

Responses are prefixed with `[Kaizen]` by default to distinguish them from your own messages.

## Message Batching

If you send multiple messages in quick succession (within 1.5 seconds), Kaizen groups them into a single task. This lets you type naturally across multiple messages without triggering separate runs.

## Contacts

Manage WhatsApp contacts in **Channels > WhatsApp**:

- **Enable/Disable** individual contacts to control who can interact with Kaizen
- **View** chat history per contact
- **Configure** per-contact settings

### Self-Chat

The self-chat contact (your own WhatsApp number) is special. It has full permissions by default and is the primary way to interact with Kaizen from WhatsApp.

### Contact Permissions

Each contact has configurable permissions that control what Kaizen can do when responding:

| Permission | Description | Default (self) | Default (others) |
|------------|-------------|----------------|-------------------|
| Memory Access | Read/write user memory | Yes | No |
| Web Access | Browse the web | Yes | Yes |
| Extension Access | Use Zapier, Brave, etc. | Yes | No |
| Plugin Access | Create/run plugins | Yes | No |
| Code Execution | Run code snippets | Yes | No |
| File Access | Read/write files | Yes | No |
| Browser Access | Control Chrome | Yes | No |
| Skill Access | Create/edit skills | Yes | No |

## Scheduled Messages

Scheduled skills can route their output to WhatsApp. When setting up a schedule, choose **WhatsApp** as the destination. Results are sent to your self-chat.

## Data & Privacy

WhatsApp authentication credentials are stored locally in the `data/whatsapp-auth/` directory. This data never leaves your machine and is excluded from git.
