# Vault & Secrets

The vault is Kaizen's encrypted secret store. It keeps API keys, passwords, tokens, and other sensitive data safe on your machine.

## How It Works

- Secrets are encrypted with **AES-256-GCM** using a PBKDF2-derived key
- The encrypted vault file (`vault.enc`) and master key (`.vault-key`) are stored in the `data/` directory
- The master key is auto-generated on first use (64 hex characters)
- Secrets never appear in environment variables, the database, or git

This means:
- Subprocesses (plugins, scripts) cannot read your secrets from the environment
- AI model responses cannot accidentally leak secrets from the database
- Git history never contains sensitive data

## Managing Secrets

Go to **Vault** (`/secrets`) to manage your secrets.

### Secret Types

| Type | Fields | Use Case |
|------|--------|----------|
| **API Key** | Value | Service API keys |
| **Token** | Value | Auth tokens, access tokens |
| **Password** | Password | Service passwords |
| **Login** | Username + Password | Service credentials |
| **Address** | Name, Street, City, State, Postal, Country | Physical addresses |
| **Other** | Value | Any other sensitive data |

### Creating a Secret

1. Click **Add Secret**
2. Choose a type
3. Enter a name and the secret value
4. Click Save

### Using Secrets

Secrets can be used in two ways:

1. **System secrets**: Kaizen uses these internally (e.g., `openrouter_api_key`, `brave_api_key`, `zapier_api_key`)
2. **Skill secrets**: Link vault entries to specific skills so the agent can access them during execution via the `use-secret` tool

When the agent uses a secret, the value is scrubbed from tool results before being passed to the AI model. The agent never sees the actual secret value in its context.

## Built-in Secrets

| Secret Name | Purpose |
|-------------|---------|
| `openrouter_api_key` | AI model access via OpenRouter |
| `brave_api_key` | Brave Search API |
| `zapier_api_key` | Zapier integration |
