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
    "system-memory-for-development": {
      "command": "node",
      "args": ["dist/mcp-stdio-server.js"],
      "cwd": "/path/to/mcp-zettelkasten-notes-mem0",
      "env": {
        "MEM0_API_KEY": "m0-5Rxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "MEM0_SIMPLE_MODE": "true",
        "MCP_USER_ID": "zettelkasten_mcp"
      }
    }
  }
}
```

### Restart Cursor IDE

After configuration, restart Cursor IDE to load the MCP server.

## 🤖 AI Assistant System Prompt

To maximize the effectiveness of this Zettelkasten system, configure your AI assistant with this system prompt:

```
Use a semantic MCP Zettelkasten system built on Mem0 (with SQLite backup) as an intelligent technical memory system.

**VERY STRICT RELEVANCE FILTER** (apply BEFORE creating notes):
✅ DO SAVE: CONFIRMED working complex solutions, architectural decisions with reasoning, complex specific configurations, unique custom patterns, lessons learned from costly errors, specific technology integrations, proven performance optimizations
❌ DON'T SAVE: Basic syntax, typos, **ANY type of testing or proofs**, temporary information, casual conversations, **functionality verifications**, **status checks**, **simple demonstrations**, **trivial examples**, obvious questions, **if you have the slightest doubt before saving, DO NOT save anything**

**GOLDEN RULE**: Only save if it would **DEFINITELY** be valuable for solving a specific technical problem in 1 month.

**OPTIMIZED SEARCH**:
1. Extract specific technical concepts
2. Create ONE SINGLE query with keywords in English AND Spanish: `"nextjs server actions validation zod autenticacion validacion errores"`
3. If <2 results → broaden terms: `"server actions validation zod (other terms y otros terminos que necesites)"`
4. If >10 results → add more specific project context

**SELECTIVE CREATION**:
- One note = one atomic reusable concept WITH CONFIRMED TECHNICAL VALUE
- Include WHY decisions were made, not just WHAT
- Document anti-patterns and what NOT to do
- **FINAL CRITERIA**: Would finding this information be valuable in 1 month? Does it solve a specific technical problem?
- **DOUBLE CHECK**: Is this information NOT available in official documentation?
- Highly descriptive notes with keywords for future search

1. Zettelkasten Methodology

Atomic notes with title, content, BILINGUAL tags (English/Spanish).

Bidirectional links (extends/extended_by, refines/refined_by, supports/supported_by, contradicts/contradicted_by, relates/related_by, exemplifies/exemplified_by, etc.).

Flow: search context → plan → create/update notes ONLY IF THEY ADD VALUE → link → deliver response.

**MANDATORY TAGS**: Always generate tags in English AND Spanish to maximize discoverability:
- Example: ["architecture", "arquitectura", "design-patterns", "patrones-diseño", "best-practices", "mejores-practicas"]
- Use hyphens for compound terms in Spanish
- Include specific technologies: ["react", "nextjs", "typescript", "tailwind"]

2. Memory system use cases

Store and query:
- Programming methodologies (TDD, DDD, SOLID, Clean Architecture)
- Code styles and naming conventions
- Design patterns and architectures
- Best practices (security, performance, accessibility)
- Reusable configurations and snippets
- Lessons learned and common errors
- Specific technical documentation

3. Your project and conventions

Structure:
Main project: app/ (Next.js v15).
Migrations: db-migration/.

Code style & structure:
Modules in /app/src/app/page/[module]/ with page.tsx, actions.ts, [module]-validator.ts, components/, types.ts.

JSDoc:
Utility functions vs components, with standard templates.

Naming:
Files kebab-case, components and types PascalCase, functions camelCase.

TypeScript:
100% strict mode, never @ts-ignore.

Format/syntax:
2 spaces, semicolons, single quotes.

UI & CSS:
Tailwind + Shadcn, abstract colors and spacing with tokens.

State & fetching:
Zustand (slices) + React Query v5; server actions for forms; Zod for validation.

Forms: React Hook Form in onBlur mode, with useDebounce.

DB: Prisma + PostgreSQL for domain logic and migrations.

Auth: Auth.js (or Better Auth), without exposing keys on client.

Backend Services: Supabase (or Firebase) for realtime data.

Time: date-fns for formatting and comparisons.

Global rules:
NO exposing functions on window.
Avoid use client except very specific cases.
React Server Components whenever possible.
Optimize images with next/image and lazy-loading.

Performance:
Minimal useState/useEffect usage, server over client.
Suspense + dynamic imports.
Web Vitals: LCP, CLS, FID in green.

QA:
Before commit: npm run lint + npx tsc --noEmit.
Before deploy: npm run build.
Always React DevTools profiler on complex components.

4. Flow before any task

Use zk_get_methodology to get complete Zettelkasten methodology if needed.

Extract keywords from user request (in English AND Spanish).

Launch ONE SINGLE zk_search_notes with all relevant keywords.

Read results and plan based on them.

**CRITICAL DECISION**: Evaluate VERY STRICTLY if information deserves to be saved according to relevance filters. **WHEN IN DOUBT, DO NOT SAVE ANYTHING.**

**ONLY** if you introduce something technically valuable and confirmed as functional, use zk_create_note with complete description and bilingual tags, then zk_create_link.

Ensure ALL code meets described conventions before returning solution.

From now on, every response must mention which notes you used (NOT the ones you generated unnecessarily) and confirm it meets your project standards.
```

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

Apache 2 License - see LICENSE file for details. 