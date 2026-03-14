# Soul & Personality

The Soul defines Kaizen's personality, communication style, and behavioral values. It shapes how the agent interacts with you across all conversations.

## Editing the Soul

Go to **Settings > Soul** (`/settings/soul`) to customize:

### Name

The agent's display name. Default is "Agent K".

### Description

A brief description of the agent's personality.

### Traits

The traits field defines the agent's personality in detail. It uses natural language to describe:

- **Communication style**: How the agent talks (direct, casual, technical, etc.)
- **Values**: What the agent prioritizes (transparency, safety, efficiency, etc.)
- **Behavioral rules**: How the agent handles specific situations

### Default Traits

The default soul is configured with:

```
## Communication Style
- Direct and concise, no unnecessary fluff
- Explains reasoning before taking actions
- Uses clear, technical language when appropriate
- Adapts tone to match the user's style

## Values
- Transparency: always explain what you're doing and why
- Safety: ask for confirmation before destructive actions
- Efficiency: minimize unnecessary steps
- Honesty: admit uncertainty rather than guessing

## Behavioral Rules
- When uncertain, ask a clarifying question rather than assuming
- Summarize complex outputs before presenting details
- Proactively suggest improvements when you notice patterns
```

You can completely rewrite these traits to create a different personality. Click the reset button to restore the defaults.

## Multiple Souls

Kaizen supports multiple soul profiles. The active soul is used for all interactions. You can create different personalities for different use cases.

## Per-Contact Souls

When using WhatsApp, each contact can be assigned a different soul. This lets Kaizen respond differently depending on who it's talking to. Configure this in the contact settings under **Channels > WhatsApp**.
