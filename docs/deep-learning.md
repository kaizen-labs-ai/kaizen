# Deep Learning

Deep Learning is an automated training pipeline that optimizes skills after each run. It analyzes execution results, identifies issues, and applies targeted improvements — instructions, guardrails, tools, plugins, and database schema — until the skill converges on its objectives.

## How It Works

After a skill run completes, the training pipeline:

1. **Gathers context** — recent run history, error logs, skill database data, previous training epochs
2. **Analyzes performance** — a dedicated Trainer agent (with thinking enabled) evaluates the skill against your training objective
3. **Proposes one improvement** — a single, surgical change to maximize impact while minimizing risk
4. **Snapshots the current state** — instructions, guardrails, and tools are saved for rollback
5. **Applies the mutation** — updates the skill configuration
6. **Scores fitness** — rates the skill on completion, errors, efficiency, quality, and data quality
7. **Checks convergence** — if fitness plateaus above 85% for consecutive epochs, marks the skill as "Optimized"

## Enabling Deep Learning

### From the Skill Detail Page

1. Go to **Skills** > select a skill
2. Click the **Deep Learning** link in the right sidebar
3. Toggle the switch to enable
4. Set a **Training Objective** — this tells the trainer what "optimized" means for this skill
5. Run the skill — training triggers automatically after each run

### Training Objective

The training objective is the most important configuration. It tells the trainer what to optimize for. Be specific:

- **Good**: "Ensure every database entry has a non-empty author name, quote text, and a meaningful category — no generic labels like 'inspirational'"
- **Good**: "Maximize win rate while keeping drawdown under 5%. Prioritize fewer, higher-quality entries."
- **Vague**: "Make it better" (the trainer won't know what to improve)

You can change the objective at any time. If the skill was already "Optimized", changing the objective automatically resets training so it can optimize for the new goal — while keeping all improvements from the previous objective.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| **Train every N runs** | 1 | How many skill runs between training epochs. Set higher for frequently scheduled skills to reduce cost. |
| **Convergence threshold** | 3 | Number of consecutive high-fitness epochs before marking "Optimized" |
| **Max epochs** | 50 | Safety cap — training stops after this many epochs regardless of fitness |

## Fitness Scoring

Each training epoch scores the skill on five metrics (0–100%):

| Metric | Weight | What It Measures |
|--------|--------|-----------------|
| **Quality** | 30% | Does the output achieve the skill's stated objectives? |
| **Completion rate** | 25% | Did runs complete without failing? |
| **Error rate** | 20% | How often do errors occur? (0% = no errors) |
| **Efficiency** | 15% | Step count — fewer steps = more efficient |
| **Data quality** | 10% | If the skill has a database, completeness of stored data |

The **composite score** is the weighted average. Convergence requires the composite to stay above 85% for the configured number of consecutive epochs.

## Training Actions

The Trainer agent can take the following actions, one per epoch:

| Action | Description |
|--------|-------------|
| **modify_instructions** | Surgical edit to the skill's instructions (only changes targeted lines) |
| **add_guardrail** | Adds a behavioral constraint (must / must_not / limit) |
| **remove_guardrail** | Removes a guardrail that's too restrictive |
| **modify_guardrail** | Updates an existing guardrail |
| **add_tool** | Links an existing tool to the skill |
| **remove_tool** | Unlinks an unnecessary tool |
| **create_plugin** | Builds a new custom plugin via the code pipeline |
| **edit_plugin** | Patches an existing plugin's code |
| **modify_db_schema** | Adds tracking columns or tables to the skill database |
| **no_change** | Waits for more data or the skill is already performing well |

### Escalation Ladder

When the executor repeatedly ignores a constraint (e.g., uses 5x leverage when told 3x), the trainer escalates its approach:

1. **Instruction change** — rewrite the rule more clearly
2. **Guardrail** — enforce it as a separate rule
3. **Embed in formulas** — pre-calculate values so the executor can't override them
4. **Create a plugin** — write code that computes the correct values

The trainer never repeats the same fix twice. If an approach was already tried and ignored, it moves to the next level.

## Safety Features

### Auto-Rollback

If fitness drops more than 10% from the best recent epoch, the system automatically rolls back to the best snapshot. The epoch is marked as "Rolled Back" in the timeline. This prevents compounding degradation.

### Snapshots

Every epoch creates a snapshot of the skill's state before applying changes. You can manually rollback to any snapshot from the training page.

### Surgical Edits

The trainer is required to make minimal changes — modifying only the specific lines that address the issue. Full instruction rewrites are prohibited to prevent losing improvements from prior epochs.

## Training Page

Access the training page from **Skills** > select a skill > **Deep Learning**.

The page shows:

- **Configuration** — toggle, objective, and training parameters
- **Fitness chart** — visual trend of the composite score across all epochs
- **Epoch timeline** — expandable list showing each epoch's hypothesis, action, fitness breakdown, and cost
- **Rollback** — restore the skill to any previous epoch's state
- **Clear All** — delete all training history and start fresh
- **Reset Training** — clear the "Optimized" status to resume training

## Status Badges

Skills with Deep Learning enabled show status badges in the skills list and detail page:

| Badge | Meaning |
|-------|---------|
| **Idle** (blue) | Deep Learning enabled, waiting for the next skill run |
| **Training** (amber, pulsing) | A training epoch is actively running |
| **Optimized** (green) | Training converged — the skill is fully optimized |

## Sequential Objectives

You can train a skill through multiple objectives in sequence. Each objective builds on the improvements from the previous one:

1. Set objective A (e.g., "Reduce errors") → train until optimized
2. Change objective to B (e.g., "Improve output formatting") → training resumes automatically
3. The skill keeps all improvements from objective A while optimizing for B

If the new objective conflicts with previous improvements, you can always rollback via the snapshots.

{% hint style="info" %}
Deep Learning uses a thinking-enabled model for the Trainer agent. Each training epoch makes one LLM call for analysis, plus additional calls if creating or editing plugins. Monitor your training costs on the **Usage** page.
{% endhint %}

{% hint style="warning" %}
Deep Learning works best with skills that have measurable outcomes — database entries, structured outputs, or clear success criteria. Skills that produce purely conversational responses are harder to optimize because "quality" is subjective.
{% endhint %}
