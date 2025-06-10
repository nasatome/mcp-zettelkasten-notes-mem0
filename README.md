# MCP Zettelkasten Notes with Mem0

A Model-Context Protocol (MCP) server implementing Zettelkasten methodology using Mem0 for semantic memory management.

## 🧠 What is this?

This MCP server enables AI assistants (like Cursor IDE) to maintain a **semantic knowledge graph** following Zettelkasten principles:

- **Atomic Notes**: Each idea is a single, complete concept
- **Bidirectional Links**: Knowledge emerges from connections
- **Semantic Search**: Mem0 vector embeddings for intelligent discovery
- **Structured Workflow**: Search → Analyze → Create → Link → Respond

## 🚀 Quick Start

### 1. Installation & Setup

```bash
# Clone and install
git clone <repository>
cd mcp-zettelkasten-notes-mem0
npm install

# Configure environment
cp env.example .env
# Edit .env with your OPENAI_API_KEY
```

### 2. Environment Configuration

```bash
# Required
OPENAI_API_KEY=your_openai_api_key_here

# Memory Mode (true = simple, false = advanced)
MEM0_SIMPLE_MODE=true

# Optional
MCP_USER_ID=zettelkasten_mcp
PORT=8080
# MCP_STORAGE_DIR=~/.mcp-servers/mcp-zettelkasten-notes-mem0
```

### 3. Start the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## 🔧 Cursor IDE Integration

### Configure MCP in Cursor

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "zettelkasten-mem0": {
      "name": "Zettelkasten Memory System",
      "description": "MCP server for Zettelkasten methodology using Mem0",
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/mcp-zettelkasten-notes-mem0",
      "baseUrl": "http://localhost:8080/mcp",
      "toolsPrefix": "zk_",
      "enabled": true
    }
  },
  "globalSettings": {
    "enableZettelkastenWorkflow": true,
    "autoSearchBeforeResponse": true,
    "defaultMemoryProvider": "zettelkasten-mem0"
  }
}
```

### Restart Cursor IDE

After configuration, restart Cursor IDE to load the MCP server.

## 📋 Available Endpoints

### Core MCP Tools (use these in Cursor)

1. **`zk_search_notes`** - Search existing knowledge
2. **`zk_get_note`** - Retrieve specific note
3. **`zk_create_note`** - Add new atomic knowledge
4. **`zk_create_link`** - Connect related notes

### HTTP Endpoints (for debugging)

- `GET /mcp/spec` - View tool specifications
- `GET /mcp/methodology` - Learn Zettelkasten workflow
- `GET /health` - Server health check

## 🔄 Zettelkasten Workflow

### The 5-Step Process

1. **SEARCH FIRST**: `zk_search_notes` with keywords from user query
2. **ANALYZE**: Review retrieved notes, plan response
3. **CREATE**: `zk_create_note` for new discoveries (atomic ideas)
4. **LINK**: `zk_create_link` to connect with existing knowledge
5. **RESPOND**: Reference notes used/created in final answer

### Example Workflow

```bash
# User asks: "How to implement authentication in Next.js?"

# Step 1: Search existing knowledge
curl -X POST http://localhost:8080/mcp/zk_search_notes \
  -H "Content-Type: application/json" \
  -d '{"query": "Next.js authentication"}'

# Step 2: Analyze results (suppose we get note IDs)

# Step 3: Create new note with solution
curl -X POST http://localhost:8080/mcp/zk_create_note \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Next.js Auth Implementation with Auth.js",
    "content": "Implementation pattern using Auth.js for Next.js applications...",
    "tags": ["nextjs", "authentication", "security", "auth.js"]
  }'

# Step 4: Link to related notes
curl -X POST http://localhost:8080/mcp/zk_create_link \
  -H "Content-Type: application/json" \
  -d '{
    "from": "new-note-id",
    "to": "existing-nextjs-note-id", 
    "type": "extends"
  }'

# Step 5: Respond referencing the note network
```

## 🔗 Link Types

Use meaningful relationship types:

- `extends` / `extended_by` - Builds upon concept
- `refines` / `refined_by` - Improves or details
- `contradicts` / `contradicted_by` - Opposes idea
- `supports` / `supported_by` - Provides evidence
- `relates` / `related_by` - General connection
- `exemplifies` / `exemplified_by` - Concrete example

## 💾 Storage Architecture

- **Primary**: Mem0 OSS (semantic vector search)
- **Backup**: SQLite (local fallback)
- **Location**: `~/.mcp-servers/mcp-zettelkasten-notes-mem0/`

## 🎯 Best Practices

1. **Always search first** - Never respond without checking existing knowledge
2. **Atomic notes** - One clear idea per note
3. **Descriptive titles** - Make concepts discoverable
4. **Consistent tagging** - Enable cross-referencing
5. **Meaningful links** - Use specific relationship types
6. **Reference notes** - Always mention which notes you used/created

## 🐛 Troubleshooting

### Server won't start
- Check `OPENAI_API_KEY` is set
- Verify port 8080 is available
- Check storage directory permissions

### Cursor can't find MCP
- Verify `.cursor/mcp.json` configuration
- Restart Cursor IDE after configuration
- Check server is running on correct port

### Search returns no results
- Create some initial notes first
- Check Mem0 is properly initialized
- Verify network connectivity

## 📚 Learn More

- [Zettelkasten Method](https://zettelkasten.de/)
- [Mem0 Documentation](https://docs.mem0.ai/)
- [Model Context Protocol](https://github.com/anthropic/model-context-protocol)

## 📝 License

MIT License - see LICENSE file for details. 