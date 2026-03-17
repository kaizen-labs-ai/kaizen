# Schedules

Schedules let you run any skill automatically on a cron schedule. Daily reports, weekly digests, hourly monitoring: set it and forget it.

## Creating a Schedule

### From the UI

1. Go to **Schedules** (`/schedules`)
2. Click **New Schedule**
3. Set a name, cron expression, and target skill
4. Choose a destination for the output
5. Enable the schedule

### From Chat

Ask the agent:

> "Schedule the 'Daily News Digest' skill to run every morning at 9am and send the result to WhatsApp."

## Cron Expressions

Schedules use standard 5-field cron expressions:

```
minute  hour  day  month  weekday
  *       *    *     *       *
```

### Examples

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 10 1 * *` | First of every month at 10:00 AM |
| `30 8 * * 1` | Every Monday at 8:30 AM |

The UI shows a human-readable translation of the cron expression and calculates the next run time.

## Destinations

Choose where the output goes when a scheduled skill runs:

| Destination | Description |
|-------------|-------------|
| **None** | Runs in the background, results available in Outputs |
| **New Chat** | Creates a new chat for each run |
| **Specific Chat** | Sends results to a chosen chat |
| **WhatsApp** | Sends results to your WhatsApp self-chat |

## Managing Schedules

- **Enable/Disable** any schedule with the toggle
- **Edit** the cron expression, destination, or linked skill
- **Delete** schedules you no longer need
- **View** the last run time and next scheduled run
- The schedule list auto-refreshes every 30 seconds

## How It Works

The scheduler checks for due schedules every 60 seconds. When a schedule fires:

1. Creates an objective from the linked skill
2. Runs the skill through the full agent pipeline
3. Sends the result to the configured destination
4. Records the run timestamp

If the server was offline when a schedule was due, it won't fire retroactively for missed runs. Re-enabling a disabled schedule resets the timer to prevent immediate firing.

{% hint style="warning" %}
**Scheduled tasks run unattended.** Since LLMs are non-deterministic, a skill that works perfectly today may produce unexpected results on a future run — especially if it interacts with external websites or APIs that change over time. Periodically review the outputs of your scheduled skills (available in the Outputs page) to ensure they are still working as expected.
{% endhint %}
