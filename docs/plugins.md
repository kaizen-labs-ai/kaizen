# Plugins

Plugins are custom code scripts that extend Kaizen's capabilities. Use them for tasks that require deterministic code execution: PDF generation, image processing, data transformation, API calls, and more.

## Skills vs Plugins

| | Skills | Plugins |
|---|--------|---------|
| **Written in** | Natural language | Code (Python, Node.js, etc.) |
| **Best for** | Agentic workflows, multi-step tasks | Deterministic operations, heavy computation |
| **Self-improving** | Yes, via memory | No, code is fixed until edited |
| **Quality checked** | Via guardrails | Via code pipeline (test + review) |

Skills and plugins work together. A skill can reference a plugin for its code-heavy steps (e.g., a "Weather Dashboard" skill that calls a chart-generation plugin).

## Supported Languages

| Language | Runtime | File Extension |
|----------|---------|----------------|
| Python | `python3` (or `python` on Windows) | `.py` |
| Node.js | `node` | `.js` |
| TypeScript | `npx tsx` | `.ts` |
| Bash | `bash` | `.sh` |
| Ruby | `ruby` | `.rb` |

## Creating a Plugin

### From the UI

1. Go to **Plugins** (`/plugins`)
2. Click **Create Plugin**
3. Choose a language, name, and description
4. Write your code in the Monaco editor
5. Define input parameters
6. Add dependencies if needed

### From Chat

Ask the agent:

> "Create a plugin that takes a CSV file and generates a bar chart as a PNG."

The agent will write the code, test it through the code pipeline (developer, execute, review), and register it as a tool.

## Input / Output Contract

Plugins receive input as JSON and must output JSON to stdout.

### Python

```python
import json, sys

input_data = json.loads(sys.argv[1])
name = input_data.get("name", "World")

result = {"message": f"Hello, {name}!"}
print(json.dumps(result))
```

### Node.js / TypeScript

```javascript
const input = JSON.parse(process.argv[2] || '{}');
const name = input.name || 'World';

const result = { message: `Hello, ${name}!` };
console.log(JSON.stringify(result));
```

### File Output

If your plugin generates files, include a `files` array in the output. Kaizen will automatically track them as artifacts.

```python
result = {
    "message": "Generated report",
    "files": ["report.pdf", "chart.png"]
}
print(json.dumps(result))
```

## Input Parameters

Define input parameters in the plugin detail page. Each parameter has:

- **Name**: Parameter key
- **Type**: string, number, boolean, etc.
- **Description**: What the parameter does
- **Required**: Whether the parameter is mandatory

These generate a JSON Schema that the agent uses to validate inputs when calling the plugin.

## Dependencies

Add package dependencies in the plugin detail page:

- **Python**: Installed via `pip install`
- **Node.js / TypeScript**: Installed via `npm install`
- **Ruby**: Installed via `gem install`

Dependencies are installed in the plugin's directory, keeping them isolated from other plugins and the main project.

## Code Pipeline

When a plugin is created or edited through chat, it goes through a quality pipeline:

1. **Developer** writes or patches the code
2. **Syntax validation** checks for errors before execution
3. **Execute** runs the plugin with test inputs
4. **Review** inspects the output (especially for visual content like images or HTML)

The pipeline runs up to 3 attempts. On attempt 2+, the developer uses patch mode for surgical edits rather than full rewrites.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| **Timeout** | 60 seconds | Maximum execution time before the plugin is killed |
| **Enabled** | true | Whether the plugin is available as a tool |

## Storage

Plugins are stored on disk at `workspace/plugins/{plugin-name}/` with the main script file and any dependencies. Plugin metadata (name, description, schema, config) is stored in the database.
