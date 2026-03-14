# Backup & Recovery

Kaizen supports full data export and import for backup, migration, or disaster recovery.

## Export

Go to **Settings > Recovery** (`/settings/recovery`) to export all your data.

1. Click **Export**
2. Enter a password to encrypt the backup
3. Download the `.kaizen` backup file

The export includes everything:

- Agent configurations and custom prompts
- Tools, skills, and plugins
- Soul/personality profiles
- Extension configurations
- Contact settings and permissions
- MCP integrations
- Vault entries and encrypted secrets
- Global settings
- User memory
- Guardrails
- Skill attachments and files
- Chat history and messages
- Objectives, runs, and steps
- Artifacts and outputs

## Import

To restore from a backup:

1. Go to **Settings > Recovery**
2. Click **Import**
3. Select the `.kaizen` backup file
4. Enter the password used during export
5. Review the import results

The import summary shows counts for each data type imported and any warnings for issues encountered during the process.

## Use Cases

- **Backup**: Regular exports as insurance against data loss
- **Migration**: Move your Kaizen setup to a new machine
- **Sharing**: Share a configured setup with others (be careful with secrets)
- **Recovery**: Restore after a fresh install or database issue
