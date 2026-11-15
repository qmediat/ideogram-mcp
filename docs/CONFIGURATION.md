# Configuration

## Quick start

Requires Node.js 22.18 or newer (`engines` in `package.json`) and an `IDEOGRAM_API_KEY` — create one in Ideogram's
API dashboard at [ideogram.ai/platform](https://ideogram.ai/platform) → **API Keys** → **Create key**
([setup guide](https://developer.ideogram.ai/ideogram-api/api-setup)).

```bash
claude mcp add --scope user ideogram -e IDEOGRAM_API_KEY=your-api-key -e IDEOGRAM_OUTPUT_DIR=/tmp/ideogram-output -- npx -y @qmediat.io/ideogram-mcp
```

or by hand (below). `npm install -g @qmediat.io/ideogram-mcp` installs the `ideogram-mcp` command, which can replace
the `npx` line in any config. The server speaks MCP over stdio: any MCP client that starts a server by command takes
the same command and environment.

## Claude Code

Add to `~/.claude.json` → `mcpServers`:

```json
{
  "ideogram": {
    "command": "npx",
    "args": ["-y", "@qmediat.io/ideogram-mcp"],
    "env": {
      "IDEOGRAM_API_KEY": "your-api-key",
      "IDEOGRAM_OUTPUT_DIR": "/tmp/ideogram-output"
    }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ideogram": {
      "command": "npx",
      "args": ["-y", "@qmediat.io/ideogram-mcp"],
      "env": {
        "IDEOGRAM_API_KEY": "your-api-key",
        "IDEOGRAM_OUTPUT_DIR": "/tmp/ideogram-output"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `IDEOGRAM_API_KEY` | Yes | — | Your Ideogram API key ([ideogram.ai/platform](https://ideogram.ai/platform) → API Keys) |
| `IDEOGRAM_OUTPUT_DIR` | No | `/tmp/ideogram-output` | Any folder where you want images saved. Use absolute paths (e.g. `/home/user/images/ideogram`) |
