# Agent Pipeline

The agent pipeline is the core execution engine. When you send a message, here's what happens step by step.

## 1. Routing

The **Router** agent classifies your message into one of three categories:

| Category | Route | When |
|----------|-------|------|
| **Simple** | Straight to executing | Quick tasks, follow-ups, complaints |
| **Complex** | Discovery, then executing | Tasks needing research, planning, external APIs |
| **Image Generation** | Straight to executing | Image creation requests |

The router also detects skill matches and determines whether a skill's full instructions or just its context should be used.

### Smart Classifications

- Complaints about output ("the result is wrong") route to executing, not conversational
- Alternative approach suggestions ("try using X instead") always route to executing
- Tasks producing substantial code (websites, dashboards) route through discovery
- Follow-up questions about a skill get the skill's context without its full instructions

## 2. Discovery (Complex Tasks)

The **Planner** agent researches the task before execution:

- Investigates available APIs, data sources, and approaches
- Considers constraints (free vs paid, auth requirements)
- Outlines a step-by-step plan

When **Interactive Planning** is enabled (Settings > Agents > Planner), the plan is proposed to you for approval before proceeding.

## 3. Execution

The **Executor** is the workhorse. It:

- Reads the user's message and any skill instructions
- Uses tools to accomplish the task (web search, browser, file operations, Zapier, etc.)
- Calls plugins when custom code is needed
- Triggers the [code pipeline](code-pipeline.md) for substantial code deliverables

### Executor Rules

1. Read the user's latest message first. User intent takes priority over skill instructions.
2. Do the task directly using tools. Only create skills/plugins when explicitly asked.
3. Use `create-plugin` for any substantial code output (triggers the quality pipeline).

### Guardrails

The executor has several smart guardrails:

- **Consecutive failure detection**: Warns at 3 failures, stops at 5
- **Loop detection**: Breaks if the same tool is called with the same arguments 3 times
- **Claim verification**: Rejects responses that claim actions not backed by tool calls
- **Empty-work gate**: Rejects completion when no substantive work was done
- **Grounding gate**: Catches hallucinated URLs not found in tool results
- **Search-pivot nudge**: After 3+ thin search results, suggests trying a different approach
- **Response-count guardrail**: Forces conclusion after excessive text regeneration

## 4. Review

The **Reviewer** agent inspects the output, particularly for visual content:

- Describes what it sees (images, dashboards, HTML pages)
- Reports gaps in a structured format (REQUIREMENT | OBSERVED | GAP)
- Never suggests code fixes (that's the developer's job)

Review happens automatically for code pipeline outputs that produce visual results.

{% hint style="info" %}
**Non-determinism in the pipeline.** LLMs may produce different results for the same input. Routing decisions, plans, and execution strategies can vary between runs. The guardrails above mitigate common failure modes, but they cannot guarantee identical outcomes every time. For critical workflows, consider enabling Interactive Planning (to approve plans before execution) and reviewing outputs before acting on them.
{% endhint %}

## Output Routing

All user-facing output goes through the **OutputRouter**, which:

- Streams interim text (first iteration only, for acknowledge-then-work)
- Deduplicates repeated content
- Suppresses internal agent text (planner output is never shown to the user)
- Ensures the longest, most substantive response wins
