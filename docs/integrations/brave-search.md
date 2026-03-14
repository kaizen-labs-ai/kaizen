# Brave Search

Brave Search gives Kaizen real-time web search, image search, news, video search, and instant data lookup capabilities.

## Setup

1. Go to **Extensions** (`/extensions`)
2. Click on **Brave Search**
3. Enter your [Brave Search API](https://brave.com/search/api/) key
4. Click **Connect**

Once connected, five search tools become available to the agent.

## Tools

### Web Search (`brave-search`)

General web search with structured results including titles, URLs, descriptions, and extra snippets.

Supports:
- **Freshness filtering**: past 24 hours, week, month, year, or custom date range
- **Country filtering**: restrict results to a specific region

### Instant Data (`brave-instant`)

Real-time data without traditional web results:

- **Cryptocurrency prices** (via CoinGecko)
- **Stock prices** (via Financial Modeling Prep)
- **Weather** (via OpenWeatherMap)
- **Currency exchange rates** (via Fixer)

### Image Search (`brave-image-search`)

Search for images with results including title, source URL, thumbnail, and dimensions. Supports safe search modes and up to 50 results.

### News Search (`brave-news-search`)

Search recent news articles with source, age, and thumbnails. Supports freshness filtering to narrow results to recent time periods.

### Video Search (`brave-video-search`)

Search for videos with metadata including duration, view count, creator, and publisher information.

## Managing Tools

Each Brave Search tool can be individually enabled or disabled in the **Extensions > Brave Search** page. When the Brave Search integration is disconnected, all five tools are automatically hidden from the tools list.

## Usage in Skills

When creating skills that need web research, the agent will automatically use Brave Search tools. You can also explicitly reference them in skill instructions:

> "Use Brave Search to find the latest pricing for competitors, then compile the results into a comparison table."
