# MCP Servers

Kaizen supports [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers for extending its capabilities with external tools and data sources.

## Context7

Context7 is a built-in MCP integration that provides version-specific documentation for 9,000+ libraries and packages. It helps the Developer agent write better code by giving it access to accurate, up-to-date API docs.

### How It Works

Two tools are available:

1. **context7-resolve**: Resolves a library name to its Context7 ID
   - Input: library name (e.g., "react", "next.js")
   - Output: ranked list of matching libraries with versions and trust scores

2. **context7-docs**: Fetches documentation for a specific library
   - Input: library ID, query, optional topic and token limit
   - Output: relevant code examples and API documentation

### Configuration

Context7 works out of the box with no configuration required. Optionally, set a `CONTEXT7_API_KEY` environment variable for higher rate limits.

### Usage

The Developer agent automatically uses Context7 when it needs library documentation. It prefers Context7 over web-fetch for API docs because the results are structured, version-specific, and more reliable.

## Adding MCP Servers

MCP is an open protocol. Any MCP-compatible server can potentially be integrated with Kaizen. The Zapier integration, for example, uses MCP under the hood to discover and call Zapier actions.
