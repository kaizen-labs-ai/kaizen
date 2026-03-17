# Code Pipeline

When Kaizen needs to produce code (websites, dashboards, data visualizations, scripts), it runs through a dedicated quality pipeline.

## Pipeline Flow

```
Executor calls create-plugin or edit-plugin
    |
    v
  Developer  -->  Writes or patches the code
    |
    v
  Syntax Check  -->  Validates code before execution (py_compile / node --check)
    |
    v
  Execute  -->  Runs the plugin with test inputs
    |
    v
  Conditional Review  -->  Inspects visual output (images, HTML)
    |
    v
  Pass / Fail  -->  Up to 3 attempts
```

## Developer Agent

The Developer writes code with access to:

- **Web search** (Brave Search, web-fetch) for API documentation
- **Context7** for version-specific library docs
- **Code execution** (run-snippet) for testing ideas
- **Tool budget**: Up to 8 tool calls per invocation

If the developer exhausts its tool budget without producing code, a final toolless call forces code production.

### Patch Mode

On attempt 2+, the developer uses **patch mode** instead of rewriting the entire script:

```
<<<<<<< SEARCH
old code to find
=======
replacement code
>>>>>>> REPLACE
```

This is also used on attempt 1 for `edit-plugin` operations (existing working script should get surgical patches, not full rewrites).

If patch validation fails (leaked conflict markers, mismatched blocks), the pipeline falls back to a full rewrite.

## Syntax Validation

Before execution, the code is validated:

- **Python**: `py_compile` checks for syntax errors
- **Node.js / TypeScript**: `node --check` validates syntax

If validation fails, the error is fed back to the developer for correction. Line-1 errors get a specific "preamble" hint (the model may have included prose before the code).

## Execution

The plugin runs with test inputs derived from its input schema. If no schema is defined, it runs with an empty object `{}`. Output files are tracked as artifacts.

## Conditional Review

Review only triggers for visual output (images, HTML, dashboards). The reviewer:

- Describes what it SEES in the output
- Uses REQUIREMENT | OBSERVED | GAP format
- Never suggests code (that's the developer's job)

Text-only output skips the review step.

## Quality Controls

- **MAX_PIPELINES_PER_RUN = 2**: Caps total pipeline cycles per run
- **Banned APIs**: If execution fails due to missing APIs/imports, those are banned and injected into the developer's prompt on retry
- **Version verification**: `pip show` / `npm list` runs before the developer step to inject accurate version info
- **Edit-plugin disk override**: When editing a plugin, the orchestrator reads the actual current script from disk, preventing the executor's simplified version from replacing developer-enhanced code

{% hint style="warning" %}
**AI-generated code requires human review.** The code pipeline includes automated quality checks (syntax validation, test execution, visual review), but these do not replace human oversight. LLMs are non-deterministic — the same prompt can produce different code each time, and automated tests may not cover all edge cases. Always review generated code before relying on it for important tasks.
{% endhint %}

## Composite Skill + Plugin Pattern

For skills with code-heavy steps (charts, dashboards), the executor creates a dedicated plugin first (goes through the full pipeline), then creates the skill referencing that plugin. This ensures the code is quality-checked before the skill uses it.
