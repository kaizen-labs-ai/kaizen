import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: "file:./kaizen.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // Default Soul
  await prisma.soul.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      name: "Agent K",
      description: "A helpful, direct, and thoughtful assistant",
      traits: `## Communication Style
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
- Proactively suggest improvements when you notice patterns`,
      isActive: true,
    },
  });

  // UserMemory singleton
  await prisma.userMemory.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      content: "",
    },
  });

  // Default settings
  await prisma.setting.upsert({
    where: { key: "theme_kit_enabled" },
    update: {},
    create: { key: "theme_kit_enabled", value: "true" },
  });

  // Built-in tool: file-read
  await prisma.tool.upsert({
    where: { name: "file-read" },
    update: {},
    create: {
      name: "file-read",
      description: "Read the contents of a file from the local filesystem",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path to read" },
        },
        required: ["path"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          content: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: file-write (sandboxed to workspace)
  await prisma.tool.upsert({
    where: { name: "file-write" },
    update: {
      description: "Write content to a file in the workspace. Provide a filename (not a full path).",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          filename: { type: "string", description: "Filename for the output (e.g. 'report.csv'). Saved to workspace automatically." },
          content: { type: "string", description: "Content to write" },
          summary: { type: "string", description: "Brief description of what this file contains" },
          intermediate: { type: "boolean", description: "Set true for working/temporary files (scraping dumps, test data, debug output). These are NOT shown to the user. Default: false (file shown as downloadable artifact)." },
        },
        required: ["filename", "content"],
      }),
    },
    create: {
      name: "file-write",
      description: "Write content to a file in the workspace. Provide a filename (not a full path).",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          filename: { type: "string", description: "Filename for the output (e.g. 'report.csv'). Saved to workspace automatically." },
          content: { type: "string", description: "Content to write" },
          summary: { type: "string", description: "Brief description of what this file contains" },
          intermediate: { type: "boolean", description: "Set true for working/temporary files (scraping dumps, test data, debug output). These are NOT shown to the user. Default: false (file shown as downloadable artifact)." },
        },
        required: ["filename", "content"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          artifactId: { type: "string" },
          filename: { type: "string" },
          bytesWritten: { type: "number" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: web-fetch
  await prisma.tool.upsert({
    where: { name: "web-fetch" },
    update: {},
    create: {
      name: "web-fetch",
      description: "Fetch content from a URL and return the response",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          method: { type: "string", enum: ["GET", "POST"], default: "GET" },
          headers: { type: "object", description: "Optional headers" },
          body: { type: "string", description: "Optional request body" },
        },
        required: ["url"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          status: { type: "number" },
          body: { type: "string" },
          headers: { type: "object" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: brave-search
  await prisma.tool.upsert({
    where: { name: "brave-search" },
    update: {
      description: "Search the web using Brave Search API. Returns structured results with titles, URLs, and descriptions. Faster and cleaner than web-fetch for research tasks. Requires Brave API key (set in Extensions).",
    },
    create: {
      name: "brave-search",
      description: "Search the web using Brave Search API. Returns structured results with titles, URLs, and descriptions. Faster and cleaner than web-fetch for research tasks. Requires Brave API key (set in Extensions).",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "number", description: "Number of results (max 20, default 10)" },
          freshness: { type: "string", description: "Filter by date: pd (24h), pw (7d), pm (31d), py (year)" },
          country: { type: "string", description: "2-letter country code for result targeting" },
        },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string" },
          resultCount: { type: "number" },
          results: { type: "array" },
        },
      }),
      enabled: false,
      createdBy: "system",
    },
  });

  // Built-in tool: brave-instant
  await prisma.tool.upsert({
    where: { name: "brave-instant" },
    update: {
      description: "Get real-time data for crypto prices, stock quotes, weather, and currency conversions. Returns structured data from CoinGecko, OpenWeatherMap, FMP, Fixer. Use instead of brave-search when you need a current price, rate, or forecast.",
    },
    create: {
      name: "brave-instant",
      description: "Get real-time data for crypto prices, stock quotes, weather, and currency conversions. Returns structured data from CoinGecko, OpenWeatherMap, FMP, Fixer. Use instead of brave-search when you need a current price, rate, or forecast.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string", description: "Data query (e.g. 'bitcoin price', 'AAPL stock', 'weather in Paris', 'USD to EUR')" },
          country: { type: "string", description: "2-letter country code" },
        },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string" },
          available: { type: "boolean" },
          vertical: { type: "string" },
          data: { type: "object" },
        },
      }),
      enabled: false,
      createdBy: "system",
    },
  });

  // Built-in tool: brave-image-search
  await prisma.tool.upsert({
    where: { name: "brave-image-search" },
    update: {
      description: "Search for images using Brave Search API. Returns image URLs, thumbnails, dimensions, and source pages. Use with download-image to save results.",
    },
    create: {
      name: "brave-image-search",
      description: "Search for images using Brave Search API. Returns image URLs, thumbnails, dimensions, and source pages. Use with download-image to save results.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string", description: "Image search query" },
          count: { type: "number", description: "Number of images (max 50, default 10)" },
          country: { type: "string", description: "2-letter country code" },
          safesearch: { type: "string", description: "Content filter: off or strict (default: off)" },
        },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string" },
          imageCount: { type: "number" },
          images: { type: "array" },
        },
      }),
      enabled: false,
      createdBy: "system",
    },
  });

  // Built-in tool: brave-news-search
  await prisma.tool.upsert({
    where: { name: "brave-news-search" },
    update: {
      description: "Search for recent news articles using Brave Search API. Returns titles, URLs, descriptions, age, source, and thumbnails. Supports freshness filters and country targeting.",
    },
    create: {
      name: "brave-news-search",
      description: "Search for recent news articles using Brave Search API. Returns titles, URLs, descriptions, age, source, and thumbnails. Supports freshness filters and country targeting.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string", description: "News search query" },
          count: { type: "number", description: "Number of articles (max 50, default 10)" },
          freshness: { type: "string", description: "Time filter: pd (24h), pw (7 days), pm (31 days), py (365 days), or YYYY-MM-DDtoYYYY-MM-DD" },
          country: { type: "string", description: "2-letter country code (e.g. US, FR, JP)" },
        },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string" },
          articleCount: { type: "number" },
          articles: { type: "array" },
        },
      }),
      enabled: false,
      createdBy: "system",
    },
  });

  // Built-in tool: brave-video-search
  await prisma.tool.upsert({
    where: { name: "brave-video-search" },
    update: {
      description: "Search for videos using Brave Search API. Returns URLs, thumbnails, duration, view counts, creator info, and publisher. Great for finding tutorials, reviews, or entertainment.",
    },
    create: {
      name: "brave-video-search",
      description: "Search for videos using Brave Search API. Returns URLs, thumbnails, duration, view counts, creator info, and publisher. Great for finding tutorials, reviews, or entertainment.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string", description: "Video search query" },
          count: { type: "number", description: "Number of videos (max 50, default 10)" },
          freshness: { type: "string", description: "Time filter: pd (24h), pw (7 days), pm (31 days), py (365 days), or YYYY-MM-DDtoYYYY-MM-DD" },
          country: { type: "string", description: "2-letter country code (e.g. US, FR, JP)" },
        },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: { type: "string" },
          videoCount: { type: "number" },
          videos: { type: "array" },
        },
      }),
      enabled: false,
      createdBy: "system",
    },
  });

  // Built-in tool: create-skill
  const createSkillSchema = JSON.stringify({
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name" },
      description: { type: "string", description: "Skill description" },
      instructions: { type: "string", description: "Detailed instructions for the skill" },
      guardrails: {
        type: "array",
        description: "Optional safety guardrails",
        items: {
          type: "object",
          properties: {
            rule: { type: "string" },
            type: { type: "string", enum: ["must", "must_not", "limit"] },
          },
          required: ["rule", "type"],
        },
      },
      subSkillNames: {
        type: "array",
        description: "Optional list of existing skill names to link as sub-skills",
        items: { type: "string" },
      },
      attachmentPaths: {
        type: "array",
        description: "Optional list of workspace file paths (e.g. from user uploads) to copy as skill attachments",
        items: { type: "string" },
      },
      toolNames: {
        type: "array",
        description: "Optional list of tool names to link as recommended resources (informational, not restrictive)",
        items: { type: "string" },
      },
      pluginNames: {
        type: "array",
        description: "Optional list of plugin names to link as recommended resources (informational, not restrictive)",
        items: { type: "string" },
      },
    },
    required: ["name", "description", "instructions"],
  });
  await prisma.tool.upsert({
    where: { name: "create-skill" },
    update: {
      description: "Create a new skill. IMPORTANT: Always call list-skills first to check if a matching skill already exists before creating one.",
      inputSchema: createSkillSchema,
    },
    create: {
      name: "create-skill",
      description: "Create a new skill. IMPORTANT: Always call list-skills first to check if a matching skill already exists before creating one.",
      type: "system",
      inputSchema: createSkillSchema,
      outputSchema: JSON.stringify({
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, message: { type: "string" } },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: edit-skill
  const editSkillSchema = JSON.stringify({
    type: "object",
    properties: {
      id: { type: "string", description: "Skill ID to update (from list-skills)" },
      name: { type: "string", description: "New skill name (optional)" },
      description: { type: "string", description: "New skill description (optional)" },
      instructions: { type: "string", description: "New skill instructions (optional)" },
      guardrails: {
        type: "array",
        description: "Replace all guardrails with this list (optional). Omit to keep existing guardrails unchanged.",
        items: {
          type: "object",
          properties: {
            rule: { type: "string" },
            type: { type: "string", enum: ["must", "must_not", "limit"] },
          },
          required: ["rule", "type"],
        },
      },
      subSkillNames: {
        type: "array",
        description: "Replace sub-skills with these existing skill names (optional). Omit to keep existing sub-skills unchanged.",
        items: { type: "string" },
      },
      attachmentPaths: {
        type: "array",
        description: "Workspace file paths to copy as skill attachments (optional). Replaces all existing attachments.",
        items: { type: "string" },
      },
      toolNames: {
        type: "array",
        description: "Replace linked tools with these tool names (optional, informational). Omit to keep existing.",
        items: { type: "string" },
      },
      pluginNames: {
        type: "array",
        description: "Replace linked plugins with these plugin names (optional, informational). Omit to keep existing.",
        items: { type: "string" },
      },
    },
    required: ["id"],
  });
  await prisma.tool.upsert({
    where: { name: "edit-skill" },
    update: {
      description: "Update an existing skill. Use list-skills to find the skill ID first.",
      inputSchema: editSkillSchema,
    },
    create: {
      name: "edit-skill",
      description: "Update an existing skill. Use list-skills to find the skill ID first.",
      type: "system",
      inputSchema: editSkillSchema,
      outputSchema: JSON.stringify({
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, message: { type: "string" } },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Clean up removed workflow tools
  await prisma.tool.deleteMany({ where: { name: { in: ["create-workflow", "edit-workflow", "create-task"] } } });

  // Built-in tool: save-result
  await prisma.tool.upsert({
    where: { name: "save-result" },
    update: {},
    create: {
      name: "save-result",
      description: "Save structured result data with a human-readable summary",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          data: { type: "object", description: "Structured data to save (key-value pairs)" },
          summary: { type: "string", description: "Human-readable summary of the result" },
        },
        required: ["data", "summary"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: { message: { type: "string" }, summary: { type: "string" } },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: read-user-memory
  await prisma.tool.upsert({
    where: { name: "read-user-memory" },
    update: {},
    create: {
      name: "read-user-memory",
      description:
        "Read the user's long-term memory. Use this when the user asks about their stored preferences, facts, or memory.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {},
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          content: { type: "string", description: "The full user memory content" },
          lineCount: { type: "number", description: "Number of non-empty lines" },
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: write-user-memory
  await prisma.tool.upsert({
    where: { name: "write-user-memory" },
    update: {},
    create: {
      name: "write-user-memory",
      description:
        "Persist a user preference, correction, or learning to long-term memory so future runs remember it",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The text to append to user memory (markdown format, concise — one line per fact)",
          },
        },
        required: ["content"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: write-whatsapp-contact-memory
  await prisma.tool.upsert({
    where: { name: "write-whatsapp-contact-memory" },
    update: {},
    create: {
      name: "write-whatsapp-contact-memory",
      description:
        "Persist facts, preferences, or learnings about the current WhatsApp contact to their personal memory. Only available in WhatsApp channel conversations.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "Facts about this contact to remember (markdown format, concise — one line per fact)",
          },
        },
        required: ["content"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: list-skills
  await prisma.tool.upsert({
    where: { name: "list-skills" },
    update: { description: "List all available skills. Call this FIRST whenever skills are mentioned or before creating a skill." },
    create: {
      name: "list-skills",
      description: "List all available skills. Call this FIRST whenever skills are mentioned or before creating a skill.",
      type: "system",
      inputSchema: JSON.stringify({ type: "object", properties: {} }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          skills: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" } } } },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: create-schedule
  await prisma.tool.upsert({
    where: { name: "create-schedule" },
    update: { description: "Schedule a skill to run on a recurring cron schedule. Use list-skills to get the skill ID first." },
    create: {
      name: "create-schedule",
      description: "Schedule a skill to run on a recurring cron schedule. Use list-skills to get the skill ID first.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          name: { type: "string", description: "Schedule name (e.g. 'Daily AI News')" },
          cron: { type: "string", description: "Cron expression. Examples: '0 10 * * *' (daily 10 AM), '0 9 * * 1' (Mondays 9 AM), '*/30 * * * *' (every 30 min)" },
          skillId: { type: "string", description: "ID of the skill to schedule (from list-skills)" },
          destination: {
            type: "object",
            description: "Where to deliver results. Default: new chat per run.",
            properties: {
              type: { type: "string", enum: ["none", "new_chat", "chat"], description: "Destination type" },
              chatId: { type: "string", description: "Chat ID (only for type 'chat')" },
            },
          },
        },
        required: ["name", "cron", "skillId"],
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: list-schedules
  await prisma.tool.upsert({
    where: { name: "list-schedules" },
    update: { description: "List all schedules. Call this FIRST before creating, updating, or deleting schedules." },
    create: {
      name: "list-schedules",
      description: "List all schedules. Call this FIRST before creating, updating, or deleting schedules.",
      type: "system",
      inputSchema: JSON.stringify({ type: "object", properties: {} }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: update-schedule
  await prisma.tool.upsert({
    where: { name: "update-schedule" },
    update: { description: "Update a schedule — change cron, enable/disable, or update destination. Use list-schedules to find the ID." },
    create: {
      name: "update-schedule",
      description: "Update a schedule — change cron, enable/disable, or update destination. Use list-schedules to find the ID.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          id: { type: "string", description: "Schedule ID (from list-schedules)" },
          name: { type: "string", description: "New name (optional)" },
          cron: { type: "string", description: "New cron expression (optional)" },
          enabled: { type: "boolean", description: "Enable or disable the schedule" },
          destination: {
            type: "object",
            description: "New destination routing (optional)",
            properties: {
              type: { type: "string", enum: ["none", "new_chat", "chat"] },
              chatId: { type: "string" },
            },
          },
        },
        required: ["id"],
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: delete-schedule
  await prisma.tool.upsert({
    where: { name: "delete-schedule" },
    update: { description: "Delete a schedule. Use list-schedules to find the ID." },
    create: {
      name: "delete-schedule",
      description: "Delete a schedule. Use list-schedules to find the ID.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          id: { type: "string", description: "Schedule ID to delete (from list-schedules)" },
        },
        required: ["id"],
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: advance-phase
  await prisma.tool.upsert({
    where: { name: "advance-phase" },
    update: {
      description: "Transition to the next phase. If no phase is specified, the system auto-determines the best next phase.",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          phase: {
            type: "string",
            enum: ["discovery", "planning", "executing", "reviewing", "complete"],
            description: "The phase to transition to. If omitted, the system auto-determines the best next phase.",
          },
          summary: {
            type: "string",
            description: "Brief summary of what was accomplished in the current phase",
          },
        },
      }),
    },
    create: {
      name: "advance-phase",
      description: "Transition to the next phase. If no phase is specified, the system auto-determines the best next phase.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          phase: {
            type: "string",
            enum: ["discovery", "planning", "executing", "reviewing", "complete"],
            description: "The phase to transition to. If omitted, the system auto-determines the best next phase.",
          },
          summary: {
            type: "string",
            description: "Brief summary of what was accomplished in the current phase",
          },
        },
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          phase: { type: "string" },
          summary: { type: "string" },
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: list-tools
  await prisma.tool.upsert({
    where: { name: "list-tools" },
    update: {},
    create: {
      name: "list-tools",
      description: "List all available tools with their names and descriptions",
      type: "system",
      inputSchema: JSON.stringify({ type: "object", properties: {} }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          tools: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } } } },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: create-plugin
  await prisma.tool.upsert({
    where: { name: "create-plugin" },
    update: {
      description:
        "Create a new plugin (executable script) that becomes a reusable tool. Use this when you need a capability that doesn't exist yet.",
    },
    create: {
      name: "create-plugin",
      description:
        "Create a new plugin (executable script) that becomes a reusable tool. Use this when you need a capability that doesn't exist yet.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Plugin name (kebab-case, e.g. 'html-to-pdf')",
          },
          description: {
            type: "string",
            description: "Short one-line summary of what this plugin does (max 100 chars)",
          },
          language: {
            type: "string",
            enum: ["python", "node", "bash", "typescript", "ruby"],
            description: "Programming language of the script",
          },
          script: {
            type: "string",
            description:
              "The full source code of the plugin. Must read JSON from stdin and write JSON to stdout.",
          },
          inputSchema: {
            type: "object",
            description:
              "JSON Schema describing the plugin's input parameters. IMPORTANT: Every property MUST include a 'description' field explaining what the parameter is for — this helps the agent understand what values to pass. Use lowercase types (string, number, boolean, array, object). Example: { \"type\": \"object\", \"properties\": { \"url\": { \"type\": \"string\", \"description\": \"The full URL of the webpage to scrape\" } }, \"required\": [\"url\"] }",
          },
          timeout: {
            type: "number",
            description:
              "Execution timeout in milliseconds (default: 60000)",
          },
          dependencies: {
            type: "array",
            items: { type: "string" },
            description:
              "External packages required (call install-plugin-deps after creating)",
          },
        },
        required: ["name", "description", "language", "script"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          toolId: { type: "string" },
          name: { type: "string" },
          scriptPath: { type: "string" },
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: install-plugin-deps
  await prisma.tool.upsert({
    where: { name: "install-plugin-deps" },
    update: {
      description:
        "Install dependencies for a plugin. Required before running plugins that import external packages.",
    },
    create: {
      name: "install-plugin-deps",
      description:
        "Install dependencies for a plugin. Required before running plugins that import external packages.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          pluginName: {
            type: "string",
            description: "Name of the plugin to install dependencies for",
          },
          packages: {
            type: "array",
            items: { type: "string" },
            description: "Package names to install",
          },
          packageManager: {
            type: "string",
            description:
              "Override package manager (e.g. 'pip', 'npm'). Auto-detected from language if omitted.",
          },
        },
        required: ["pluginName", "packages"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          message: { type: "string" },
          warnings: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: list-plugins
  await prisma.tool.upsert({
    where: { name: "list-plugins" },
    update: {
      description:
        "List all available plugins with their language and status.",
    },
    create: {
      name: "list-plugins",
      description:
        "List all available plugins with their language and status.",
      type: "system",
      inputSchema: JSON.stringify({ type: "object", properties: {} }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          plugins: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                language: { type: "string" },
                enabled: { type: "boolean" },
              },
            },
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: edit-plugin
  await prisma.tool.upsert({
    where: { name: "edit-plugin" },
    update: { description: "Update an existing plugin's description, script, or input schema. Use list-plugins to find the plugin name first." },
    create: {
      name: "edit-plugin",
      description: "Update an existing plugin's description, script, or input schema. Use list-plugins to find the plugin name first.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          name: { type: "string", description: "Plugin name to update (from list-plugins)" },
          description: { type: "string", description: "New plugin description (optional)" },
          script: { type: "string", description: "New script source code (optional)" },
          inputSchema: { type: "object", description: "New JSON Schema for plugin input (optional)" },
        },
        required: ["name"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: { name: { type: "string" }, message: { type: "string" } },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: run-snippet (developer sub-agent)
  await prisma.tool.upsert({
    where: { name: "run-snippet" },
    update: {
      description: "Execute a short code snippet for calculations, testing, or data processing. Files written here are TEMPORARY and discarded — never use this to create deliverable files. Use file-write instead.",
    },
    create: {
      name: "run-snippet",
      description: "Execute a short code snippet for calculations, testing, or data processing. Files written here are TEMPORARY and discarded — never use this to create deliverable files. Use file-write instead.",
      type: "system",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          code: { type: "string", description: "The code to execute (keep it short — under 50 lines)" },
          language: { type: "string", description: "Language: 'python' or 'node'", enum: ["python", "node"] },
        },
        required: ["code"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          success: { type: "boolean" },
          stdout: { type: "string" },
          stderr: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: context7-resolve (MCP — library ID lookup)
  await prisma.tool.upsert({
    where: { name: "context7-resolve" },
    update: {
      description:
        "Resolve a library name to a Context7 library ID. Call this first to find the correct ID before querying docs. Covers 9,000+ libraries.",
    },
    create: {
      name: "context7-resolve",
      description:
        "Resolve a library name to a Context7 library ID. Call this first to find the correct ID before querying docs. Covers 9,000+ libraries.",
      type: "mcp",
      config: JSON.stringify({ server: "context7" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          libraryName: {
            type: "string",
            description:
              "Library name to search for (e.g. 'react', 'next.js', 'prisma', 'fpdf2')",
          },
          query: {
            type: "string",
            description:
              "The task or question you're trying to solve. Used to rank results by relevance.",
          },
        },
        required: ["libraryName"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: {
            type: "string",
            description:
              "List of matching libraries with Context7 IDs, snippet counts, and trust scores",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: context7-docs (MCP — version-specific documentation)
  await prisma.tool.upsert({
    where: { name: "context7-docs" },
    update: {
      description:
        "Fetch up-to-date, version-specific documentation and code examples for a library. Requires a Context7 library ID from context7-resolve.",
    },
    create: {
      name: "context7-docs",
      description:
        "Fetch up-to-date, version-specific documentation and code examples for a library. Requires a Context7 library ID from context7-resolve.",
      type: "mcp",
      config: JSON.stringify({ server: "context7" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          libraryId: {
            type: "string",
            description:
              "Context7 library ID (e.g. '/vercel/next.js', '/prisma/prisma'). Get this from context7-resolve first.",
          },
          query: {
            type: "string",
            description:
              "Specific question about the library. Be detailed — e.g. 'How to create a multi-column PDF layout with fpdf2' not just 'pdf'.",
          },
          topic: {
            type: "string",
            description:
              "Optional focus area (e.g. 'routing', 'hooks', 'layout', 'middleware').",
          },
          tokens: {
            type: "number",
            description:
              "Max documentation tokens to return. Default 10000. Minimum 5000.",
          },
        },
        required: ["libraryId", "query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          documentation: {
            type: "string",
            description: "Documentation text with code examples",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: download-image (contextual — saves to run artifacts)
  await prisma.tool.upsert({
    where: { name: "download-image" },
    update: {
      description:
        "Download an image from a URL and save it as a viewable artifact in the chat. Use after finding image URLs via web-fetch or Chrome tools. IMPORTANT: On Google Images, do NOT extract img[src] from the grid — those are tiny data-URI thumbnails. The full-res URLs are in the page's <script> tags. Use chrome-evaluate to extract them with a regex pattern that matches [\"url\",height,width] arrays, filtering out encrypted-tbn URLs and unescaping \\u003d/\\u0026.",
    },
    create: {
      name: "download-image",
      description:
        "Download an image from a URL and save it as a viewable artifact in the chat. Use after finding image URLs via web-fetch or Chrome tools. IMPORTANT: On Google Images, do NOT extract img[src] from the grid — those are tiny data-URI thumbnails. The full-res URLs are in the page's <script> tags. Use chrome-evaluate to extract them with a regex pattern that matches [\"url\",height,width] arrays, filtering out encrypted-tbn URLs and unescaping \\u003d/\\u0026.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Direct URL to the image to download",
          },
          filename: {
            type: "string",
            description:
              "Optional filename for the saved image (e.g. 'cat.jpg'). Auto-detected from URL if omitted.",
          },
        },
        required: ["url"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          artifactId: { type: "string" },
          filename: { type: "string" },
          bytesWritten: { type: "number" },
          markdown: { type: "string" },
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // ── Chrome DevTools MCP tools (browser automation) ──
  // Clean up old browser-* names (renamed to chrome-*)
  await prisma.tool.deleteMany({ where: { name: { startsWith: "browser-" } } });

  // chrome-navigate
  await prisma.tool.upsert({
    where: { name: "chrome-navigate" },
    update: {
      description:
        "Navigate to a URL in Chrome, or go back/forward/reload. Chrome is auto-launched if not running.",
    },
    create: {
      name: "chrome-navigate",
      description:
        "Navigate to a URL in Chrome, or go back/forward/reload. Chrome is auto-launched if not running.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to navigate to (required when type is 'url')",
          },
          type: {
            type: "string",
            description:
              "Navigation type: 'url' (default), 'back', 'forward', or 'reload'",
          },
        },
        required: ["url"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: { type: "string", description: "Navigation result" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-snapshot
  await prisma.tool.upsert({
    where: { name: "chrome-snapshot" },
    update: {
      description:
        "Read the current page as an accessibility tree (structured text). Returns element uids needed for chrome-click and chrome-fill. Always call this before clicking or filling.",
    },
    create: {
      name: "chrome-snapshot",
      description:
        "Read the current page as an accessibility tree (structured text). Returns element uids needed for chrome-click and chrome-fill. Always call this before clicking or filling.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          verbose: {
            type: "boolean",
            description:
              "If true, include more detail in the snapshot. Default false.",
          },
        },
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          snapshot: {
            type: "string",
            description: "Accessibility tree with element uids and text content",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-click
  await prisma.tool.upsert({
    where: { name: "chrome-click" },
    update: {
      description:
        "Click an element on the page by its uid. Get the uid from chrome-snapshot first.",
    },
    create: {
      name: "chrome-click",
      description:
        "Click an element on the page by its uid. Get the uid from chrome-snapshot first.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          uid: {
            type: "string",
            description:
              "The unique element ID from the accessibility snapshot. Use chrome-snapshot to find it.",
          },
          includeSnapshot: {
            type: "boolean",
            description:
              "If true, return an updated snapshot after clicking. Useful to see the result of the click.",
          },
        },
        required: ["uid"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: { type: "string", description: "Click result and optional snapshot" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-fill
  await prisma.tool.upsert({
    where: { name: "chrome-fill" },
    update: {
      description:
        "Fill a form field (input, textarea, select) with a value. Get the element uid from chrome-snapshot first.",
    },
    create: {
      name: "chrome-fill",
      description:
        "Fill a form field (input, textarea, select) with a value. Get the element uid from chrome-snapshot first.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          uid: {
            type: "string",
            description:
              "The unique element ID from the accessibility snapshot. Use chrome-snapshot to find it.",
          },
          value: {
            type: "string",
            description: "The text value to fill into the field.",
          },
          includeSnapshot: {
            type: "boolean",
            description:
              "If true, return an updated snapshot after filling. Useful to verify the field was filled.",
          },
        },
        required: ["uid", "value"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: { type: "string", description: "Fill result and optional snapshot" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-evaluate
  await prisma.tool.upsert({
    where: { name: "chrome-evaluate" },
    update: {
      description:
        "Execute JavaScript on the current page and return the result. Use for extracting specific data from the DOM.",
    },
    create: {
      name: "chrome-evaluate",
      description:
        "Execute JavaScript on the current page and return the result. Use for extracting specific data from the DOM.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          function: {
            type: "string",
            description:
              "JavaScript function to execute on the page. Can be an arrow function or function expression. Example: '() => document.title'",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional arguments to pass to the function. Must be JSON-serializable.",
          },
        },
        required: ["function"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: {
            type: "string",
            description: "JSON-serialized return value of the function",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-wait
  await prisma.tool.upsert({
    where: { name: "chrome-wait" },
    update: {
      description:
        "Wait for specific text to appear on the page. Useful after navigation or clicks to ensure content has loaded.",
    },
    create: {
      name: "chrome-wait",
      description:
        "Wait for specific text to appear on the page. Useful after navigation or clicks to ensure content has loaded.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to wait for on the page. You can pass a single string — it will be auto-wrapped into the array the MCP server expects.",
          },
          timeout: {
            type: "number",
            description:
              "Maximum time to wait in milliseconds. Default is 30000 (30 seconds).",
          },
        },
        required: ["text"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: { type: "string", description: "Confirmation that the text was found" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-new-tab
  await prisma.tool.upsert({
    where: { name: "chrome-new-tab" },
    update: {
      description:
        "Open a new tab in Chrome and navigate to a URL. Use this instead of chrome-navigate when the user wants to keep their current page open.",
    },
    create: {
      name: "chrome-new-tab",
      description:
        "Open a new tab in Chrome and navigate to a URL. Use this instead of chrome-navigate when the user wants to keep their current page open.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to open in the new tab.",
          },
          background: {
            type: "boolean",
            description:
              "If true, open the tab in the background without switching to it. Default false.",
          },
        },
        required: ["url"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: { type: "string", description: "New tab creation result with page ID" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-list-tabs
  await prisma.tool.upsert({
    where: { name: "chrome-list-tabs" },
    update: {
      description:
        "List all open tabs in Chrome with their page IDs and URLs. Use to find a tab before switching to it with chrome-select-tab.",
    },
    create: {
      name: "chrome-list-tabs",
      description:
        "List all open tabs in Chrome with their page IDs and URLs. Use to find a tab before switching to it with chrome-select-tab.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {},
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: {
            type: "string",
            description: "List of open tabs with page IDs and URLs",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // chrome-select-tab
  await prisma.tool.upsert({
    where: { name: "chrome-select-tab" },
    update: {
      description:
        "Switch to a specific tab by its page ID. Use chrome-list-tabs first to find the page ID.",
    },
    create: {
      name: "chrome-select-tab",
      description:
        "Switch to a specific tab by its page ID. Use chrome-list-tabs first to find the page ID.",
      type: "mcp",
      config: JSON.stringify({ server: "chrome-devtools" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          pageId: {
            type: "string",
            description:
              "The page ID of the tab to switch to. Get this from chrome-list-tabs.",
          },
        },
        required: ["pageId"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: { type: "string", description: "Tab switch confirmation" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // ── shadcn UI MCP tools (component docs) ──

  // shadcn-list
  await prisma.tool.upsert({
    where: { name: "shadcn-list" },
    update: {
      description:
        "List all available shadcn/ui components. Use this to discover which components exist before fetching their docs with shadcn-docs.",
    },
    create: {
      name: "shadcn-list",
      description:
        "List all available shadcn/ui components. Use this to discover which components exist before fetching their docs with shadcn-docs.",
      type: "mcp",
      config: JSON.stringify({ server: "shadcn" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {},
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: {
            type: "string",
            description: "List of available shadcn/ui components",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // shadcn-docs
  await prisma.tool.upsert({
    where: { name: "shadcn-docs" },
    update: {
      description:
        "Get documentation and source code for a specific shadcn/ui component. Use this to understand the exact structure, styles, and patterns before converting to vanilla HTML+CSS+JS.",
    },
    create: {
      name: "shadcn-docs",
      description:
        "Get documentation and source code for a specific shadcn/ui component. Use this to understand the exact structure, styles, and patterns before converting to vanilla HTML+CSS+JS.",
      type: "mcp",
      config: JSON.stringify({ server: "shadcn" }),
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          component: {
            type: "string",
            description:
              "Component name (e.g. 'table', 'card', 'dialog', 'tabs', 'badge'). Use shadcn-list to discover available components.",
          },
        },
        required: ["component"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          documentation: {
            type: "string",
            description:
              "Component documentation including structure, props, and usage examples",
          },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: use-secret (secure vault secret resolution)
  await prisma.tool.upsert({
    where: { name: "use-secret" },
    update: {
      description:
        "Securely use a vault secret (password, API key, token) linked to this skill. The actual value is never revealed — it is applied server-side. Use chrome-snapshot first to find the target element uid.",
    },
    create: {
      name: "use-secret",
      description:
        "Securely use a vault secret (password, API key, token) linked to this skill. The actual value is never revealed — it is applied server-side. Use chrome-snapshot first to find the target element uid.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          secretLabel: {
            type: "string",
            description:
              "The label of the vault secret to use (e.g. 'My Password', 'OpenRouter API Key'). Must match exactly.",
          },
          action: {
            type: "string",
            enum: ["fill", "header", "value"],
            description:
              "How to apply the secret: 'fill' = type into a browser field (requires target uid from chrome-snapshot), 'header' = resolve for an HTTP header, 'value' = generic resolution.",
          },
          target: {
            type: "string",
            description:
              "For 'fill': the element uid from chrome-snapshot. For 'header': the header name (e.g. 'Authorization'). Optional for 'value'.",
          },
        },
        required: ["secretLabel"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          message: { type: "string", description: "Confirmation that the secret was applied (actual value is NEVER returned)" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: read-run-history (inspect past actions in the chat)
  await prisma.tool.upsert({
    where: { name: "read-run-history" },
    update: {
      description: "Inspect your own past actions from previous runs in this conversation. Use 'list' mode to see all past runs, or 'detail' mode to see the full action log of a specific run.",
    },
    create: {
      name: "read-run-history",
      description: "Inspect your own past actions from previous runs in this conversation. Use 'list' mode to see all past runs, or 'detail' mode to see the full action log of a specific run.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["list", "detail"],
            description: "list = overview of all runs in this chat; detail = full action log of one run (defaults to most recent)",
          },
          runId: {
            type: "string",
            description: "For detail mode: specific run ID to inspect. If omitted, shows the most recent previous run.",
          },
        },
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          runs: { type: "array", description: "List of runs (list mode)" },
          report: { type: "string", description: "Action log (detail mode)" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: skill-db-schema (inspect skill database structure)
  await prisma.tool.upsert({
    where: { name: "skill-db-schema" },
    update: {
      description: "Inspect the structure of a skill's database — lists tables, columns, types, and row counts.",
    },
    create: {
      name: "skill-db-schema",
      description: "Inspect the structure of a skill's database — lists tables, columns, types, and row counts.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          skillId: { type: "string", description: "The skill ID to inspect" },
        },
        required: ["skillId"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          hasDatabase: { type: "boolean" },
          tables: { type: "array" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: skill-db-query (read data from a skill database)
  await prisma.tool.upsert({
    where: { name: "skill-db-query" },
    update: {
      description: "Run a SELECT query against a skill's database. Returns columns and rows.",
    },
    create: {
      name: "skill-db-query",
      description: "Run a SELECT query against a skill's database. Returns columns and rows.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          skillId: { type: "string", description: "The skill ID to query" },
          sql: { type: "string", description: "SELECT query to run against the skill's database" },
        },
        required: ["skillId", "sql"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          columns: { type: "array" },
          rows: { type: "array" },
          rowCount: { type: "number" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: skill-db-execute (modify a skill database — DDL/DML)
  await prisma.tool.upsert({
    where: { name: "skill-db-execute" },
    update: {
      description: "Run DDL or DML against a skill's database (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER TABLE). Creates the database on first use.",
    },
    create: {
      name: "skill-db-execute",
      description: "Run DDL or DML against a skill's database (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER TABLE). Creates the database on first use.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          skillId: { type: "string", description: "The skill ID whose database to modify" },
          sql: { type: "string", description: "DDL or DML statement (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER TABLE, DROP TABLE)" },
        },
        required: ["skillId", "sql"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          changes: { type: "number" },
          lastInsertRowid: { type: "number" },
          message: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  // Built-in tool: gitbook-docs (MCP — Kaizen documentation lookup)
  await prisma.tool.upsert({
    where: { name: "gitbook-docs" },
    update: {
      description: "Search Kaizen's own documentation to answer questions about features, configuration, architecture, skills, plugins, integrations, and usage. Use this when the user asks how Kaizen works or how to set something up.",
    },
    create: {
      name: "gitbook-docs",
      description: "Search Kaizen's own documentation to answer questions about features, configuration, architecture, skills, plugins, integrations, and usage. Use this when the user asks how Kaizen works or how to set something up.",
      type: "system",
      config: "{}",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to look up in the Kaizen documentation (e.g., 'how do skills work', 'WhatsApp integration setup', 'scheduling configuration')",
          },
        },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          documentation: { type: "string" },
        },
      }),
      enabled: true,
      createdBy: "system",
    },
  });

  console.log("Seed complete");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
