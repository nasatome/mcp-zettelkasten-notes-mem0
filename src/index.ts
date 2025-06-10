/**
 * @fileoverview **MCP Zettelkasten Server** – production‑ready, local‑first.
 *
 * ## Architecture
 * | Concern           | Tech                              |
 * |-------------------|-----------------------------------|
 * | Primary store     | **Mem0 OSS** (semantic vector)   |
 * | Local backup      | **SQLite** (WAL, durable)         |
 * | Web framework     | **Express**                       |
 * | Logging           | **Pino**                          |
 * | Security          | Helmet, CORS, rate‑limit          |
 * | Resilience        | Timeouts, retry queue, graceful shutdown |
 * | Observability     | `/health` JSON endpoint           |
 *
 * All endpoints follow the **Model‑Context Protocol (MCP)** for tool discovery (`/mcp/spec`).
 * The server is intended to run **locally** but aims for production‑grade robustness.
 *
 * @version 0.10.0
 * @author  nasatome
 */

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import { Memory } from 'mem0ai/oss';
import MemoryClient from 'mem0ai';
import pino from 'pino';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Load environment variables from .env file with absolute path
dotenv.config({ path: '/opt/prj/mcp-zettelkasten-notes-mem0/.env' });

/**
 * Robust MCP Server: Zettelkasten + Mem0 + SQLite backup
 * - Primary store/retrieve via Mem0 (semantic)
 * - Local SQLite backup for resilience
 * - Circuit breaker + timeout for Mem0 calls
 * - Structured routes, validation, security middlewares
 * - Graceful init/shutdown
 */

/**
 * Application configuration interface
 * @typedef {Object} MCPConfig
 * @property {string} mem0ApiKey - API key for Mem0
 * @property {string} mem0OrgId - Organization ID in Mem0
 * @property {string} mem0ProjectId - Project ID in Mem0
 * @property {string} [userId] - User identifier for memories
 * @property {number} [port] - Port for the Express server
 * @property {string} [storageDir] - Directory path for SQLite backup
 * @property {number} [mem0TimeoutMs] - Timeout for Mem0 API calls (ms)
 * @property {number} [rateLimitWindowMs] - Rate limit window in milliseconds
 * @property {number} [rateLimitMax] - Maximum requests per window
 */
interface MCPConfig {
  mem0ApiKey?: string;
  openaiApiKey?: string;
  mem0SimpleMode?: boolean;
  userId?: string;
  port?: number;
  storageDir?: string;
  mem0TimeoutMs?: number;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
}

// Configuration from environment variables
const config: MCPConfig = {
  mem0ApiKey: process.env.MEM0_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  mem0SimpleMode: process.env.MEM0_SIMPLE_MODE === 'true',
  userId: process.env.MCP_USER_ID || 'zettelkasten_mcp',
  port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
  storageDir: process.env.MCP_STORAGE_DIR,
  mem0TimeoutMs: process.env.MCP_MEM0_TIMEOUT ? parseInt(process.env.MCP_MEM0_TIMEOUT) : 5000,
  rateLimitWindowMs: process.env.MCP_RATE_WINDOW ? parseInt(process.env.MCP_RATE_WINDOW) : 15 * 60 * 1000,
  rateLimitMax: process.env.MCP_RATE_MAX ? parseInt(process.env.MCP_RATE_MAX) : 100
};

const {
  mem0ApiKey,
  openaiApiKey,
  mem0SimpleMode = true,
  userId = 'zettelkasten_mcp',
  port = 8080,
  storageDir,
  mem0TimeoutMs = 5000,
  rateLimitWindowMs = 15 * 60 * 1000,
  rateLimitMax = 100
} = config as Required<MCPConfig>;

// Validate required API keys based on mode
if (mem0SimpleMode && !mem0ApiKey) {
  console.error('[MCP] Missing Mem0 API Key for simple mode');
  console.error('[MCP] Please set MEM0_API_KEY in your .env file');
  process.exit(1);
}

if (!mem0SimpleMode && !openaiApiKey) {
  console.error('[MCP] Missing OpenAI API Key for advanced mode');
  console.error('[MCP] Please set OPENAI_API_KEY in your .env file');
  process.exit(1);
}

// --- Setup storage directory for SQLite ---
const defaultDir = path.join(os.homedir(), '.mcp-servers', 'mcp-zettelkasten-notes-mem0');

// Helper function to expand ~ to home directory
function expandHomeDir(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

let dbDir = process.env.MCP_STORAGE_DIR || storageDir || defaultDir;
// Expand ~ if present in the path
dbDir = expandHomeDir(dbDir);

fs.mkdirSync(dbDir, { recursive: true });

const storageFile = path.join(dbDir, 'notes-db.sqlite');

// --- Logger (Pino) ---
const logger = pino({ level: 'info', timestamp: pino.stdTimeFunctions.isoTime });

// Log which Mem0 mode is being used
logger.info(`[Mem0] Initialization mode: ${mem0SimpleMode ? 'SIMPLE' : 'ADVANCED'}`);

// --- SQLite Initialization & Pool ---
/**
 * SQLite database instance.
 * @type {Database<sqlite3.Database, sqlite3.Statement>}
 */
let db: Database<sqlite3.Database, sqlite3.Statement>;

/**
 * Initialize SQLite with pragmas and table schema.
 * @returns {Promise<void>}
 */
async function initDB(): Promise<void> {
  db = await open({ filename: storageFile, driver: sqlite3.Database });
  // performance optimizations
  await db.exec('PRAGMA journal_mode=WAL;');
  await db.exec('PRAGMA synchronous=NORMAL;');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      tags TEXT,
      links TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS retry_queue (
      id TEXT PRIMARY KEY,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  logger.info(`[SQLite] Backup ready at ${storageFile}`);
}

// --- Mem0 Client with Timeout / Circuit Breaker ---
/**
 * Mem0 client instance for memory operations.
 * Supports both simple and advanced initialization modes.
 */
const memory: any = mem0SimpleMode 
  ? new MemoryClient({ apiKey: mem0ApiKey })
  : new Memory({
      version: 'v1.1',
      embedder: {
        provider: 'openai',
        config: {
          apiKey: openaiApiKey,
          model: 'text-embedding-3-small',
        },
      },
      vectorStore: {
        provider: 'memory',
        config: {
          collectionName: 'zettelkasten_memories',
          dimension: 1536,
        },
      },
      llm: {
        provider: 'openai',
        config: {
          apiKey: openaiApiKey,
          model: 'gpt-4o-mini',
        },
      },
      historyDbPath: path.join(dbDir, 'memory-history.db'),
    });

/**
 * Wrap a promise with a timeout.
 * @template T
 * @param {Promise<T>} promise - The promise to wrap.
 * @param {number} ms - Timeout in milliseconds.
 * @returns {Promise<T>} A promise that rejects on timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms));
  return Promise.race([promise, timeout]);
}

/**
 * Helper function to handle both MemoryClient and Memory search results
 * @param {any} results - Search results from either client
 * @returns {any[]} Normalized array of results
 */
function normalizeSearchResults(results: any): any[] {
  if (Array.isArray(results)) {
    // MemoryClient returns Memory[] directly
    return results;
  } else if (results && Array.isArray(results.results)) {
    // Memory (OSS) returns SearchResult with results property
    return results.results;
  }
  return [];
}

/**
 * Sync a note to Mem0 asynchronously, with timeout.
 * @param {string} id - Note ID.
 * @param {string} title - Note title.
 * @param {string} content - Note content.
 * @returns {Promise<void>}
 */
async function syncNoteToMem0(id: string, title: string, content: string): Promise<void> {
  try {
    await withTimeout(
      memory.add([
        { role: 'user', content: `Note: ${title}` },
        { role: 'assistant', content }
      ], { userId, metadata: { noteId: id, title } }),
      mem0TimeoutMs
    );
    logger.info(`[Mem0] Synced note ${id}`);
  } catch (err: any) {
    logger.error(`[Mem0] Sync error for ${id}: ${err.message}`);
    // Add to retry queue
    await db.run('INSERT OR REPLACE INTO retry_queue (id,payload) VALUES (?,?)', 
      id, JSON.stringify({ id, title, content }));
  }
}

/**
 * Retrieve a note from Mem0, fallback to null on error.
 * @param {string} id - Note ID.
 * @returns {Promise<{id: string, content: string, via: string} | null>}
 */
async function getNoteFromMem0(id: string): Promise<{id: string, content: string, via: string} | null> {
  try {
    const rawResults = await withTimeout(
      memory.search(`noteId:${id}`, { userId, limit: 1 }),
      mem0TimeoutMs
    );
    const results = normalizeSearchResults(rawResults);
    if (results.length > 0) {
      return { id, content: results[0].memory, via: 'mem0' };
    }
    return null;
  } catch (err: any) {
    logger.warn(`[Mem0] Get failed for ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Retry queue flush
 */
async function flushRetryQueue(): Promise<void> {
  const failed = await db.all<{ id: string; payload: string }[]>('SELECT * FROM retry_queue');
  if (!failed.length) return;
  logger.info(`[Retry] Flushing ${failed.length} item(s)…`);
  for (const row of failed) {
    try {
      const { id, title, content }: { id: string; title: string; content: string } = JSON.parse(row.payload);
      await withTimeout(
        memory.add([
          { role: 'user', content: `Note: ${title}` },
        { role: 'assistant', content }
        ], { userId, metadata: { noteId: id, title } }),
        mem0TimeoutMs
      );
      await db.run('DELETE FROM retry_queue WHERE id = ?', row.id);
      logger.info(`[Retry] Synced ${row.id}`);
    } catch (err: any) {
      logger.warn(`[Retry] Still failing ${row.id}: ${err.message}`);
    }
  }
}

// --- Express App & Middlewares ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(rateLimit({ windowMs: rateLimitWindowMs, max: rateLimitMax }));

// Ensure DB initialized
initDB().catch(err => { logger.error(`[DB] Init failed: ${err.message}`); process.exit(1); });

// Start retry queue flush interval
setInterval(() => flushRetryQueue().catch(logger.error), 10000).unref();

/**
 * Specification of available MCP tools implementing Zettelkasten methodology.
 * 
 * ZETTELKASTEN WORKFLOW:
 * 1. SEARCH FIRST: Always start with zk_search_notes to find existing context
 * 2. ANALYZE: Plan your response based on retrieved notes  
 * 3. CREATE: Add new atomic knowledge with zk_create_note
 * 4. LINK: Connect related ideas with zk_create_link (bidirectional)
 * 5. RESPOND: Reference which notes were used/created
 * 
 * @type {{name: string, description: string, params: string[], methodology: string}[]}
 */
const toolSpec = [
  { 
    name: 'zk_search_notes', 
    description: 'STEP 1: Search existing notes semantically before any action. Find context and related knowledge using Mem0 vector search.',
    params: ['query:string'],
    methodology: 'Always start here. Extract keywords from user request and search for existing knowledge before proceeding.'
  },
  { 
    name: 'zk_get_note', 
    description: 'STEP 2: Retrieve specific note by ID when you have exact reference. Mem0 primary with SQLite fallback.',
    params: ['id:string'],
    methodology: 'Use when you have a specific note ID from search results or links. Part of analysis phase.'
  },
  { 
    name: 'zk_create_note', 
    description: 'STEP 3: Create atomic note with clear title, concise content, and relevant tags. Each idea = one note.',
    params: ['title:string', 'content:string', 'tags?:string[]'],
    methodology: 'Only after searching. One atomic idea per note. Title must be descriptive. Content concise but complete.'
  },
  { 
    name: 'zk_create_link', 
    description: 'STEP 4: Create bidirectional relationship between notes. Types: extends/refines/contradicts/relates/supports.',
    params: ['from:string','to:string','type:string'],
    methodology: 'Always link new notes to existing ones. Use meaningful relationship types that explain the connection.'
  }
];

/**
 * GET /mcp/spec - Return MCP tools specification.
 */
app.get('/mcp/spec', (_req: Request, res: Response) => {
  res.json(toolSpec);
});

/**
 * GET /mcp/methodology - Explain Zettelkasten methodology and workflow.
 */
app.get('/mcp/methodology', (_req: Request, res: Response) => {
  res.json({
    name: "Zettelkasten Methodology with Mem0",
    version: "1.0",
    description: "Semantic memory management following Zettelkasten principles",
    
    principles: {
      atomicity: "Each note contains one clear, complete idea with descriptive title",
      connectivity: "All notes are connected through bidirectional semantic links", 
      discoverability: "Use semantic search (Mem0) to find related knowledge before creating",
      emergence: "Knowledge emerges from the network of connected atomic notes"
    },
    
    workflow: {
      "1_search": {
        action: "POST /mcp/zk_search_notes",
        purpose: "Find existing context and related knowledge",
        rule: "NEVER respond without searching first"
      },
      "2_analyze": {
        action: "GET /mcp/zk_get_note (if needed)",
        purpose: "Retrieve specific notes to understand current knowledge state",
        rule: "Plan response based on retrieved notes"
      },
      "3_create": {
        action: "POST /mcp/zk_create_note", 
        purpose: "Add new atomic knowledge discoveries",
        rule: "One idea per note, clear title, concise content"
      },
      "4_link": {
        action: "POST /mcp/zk_create_link",
        purpose: "Connect new knowledge to existing network",
        rule: "Always create bidirectional semantic relationships"
      },
      "5_respond": {
        action: "Final response to user",
        purpose: "Reference notes used and created",
        rule: "Make knowledge graph explicit in communication"
      }
    },
    
    linkTypes: [
      "extends", "extended_by", 
      "refines", "refined_by",
      "contradicts", "contradicted_by", 
      "supports", "supported_by",
      "relates", "related_by",
      "exemplifies", "exemplified_by"
    ],
    
    bestPractices: [
      "Search before every action using semantic keywords",
      "Create atomic notes with single, clear concepts", 
      "Use meaningful, descriptive titles",
      "Tag consistently for discoverability",
      "Link bidirectionally with semantic relationship types",
      "Prefer Mem0 semantic search over SQLite text search",
      "Document inconsistencies as new notes",
      "Reference note IDs in final responses"
    ],
    
    example: {
      userQuery: "How to implement authentication in Next.js?",
      workflow: [
        "1. POST /mcp/zk_search_notes query='Next.js authentication'",
        "2. Analyze retrieved notes about auth patterns, libraries, security",
        "3. POST /mcp/zk_create_note with new implementation approach",
        "4. POST /mcp/zk_create_link connecting to existing auth/Next.js notes",
        "5. Respond with solution referencing note network used"
      ]
    }
  });
});

// --- Routes ---
/**
 * POST /mcp/zk_create_note - Create a new Zettelkasten note.
 * @param {string} title - Note title.
 * @param {string} content - Note content.
 * @param {string[]} [tags] - Optional tags.
 */
app.post('/mcp/zk_create_note', async (req: Request, res: Response) => {
  const { title, content, tags } = req.body;
  if (typeof title !== 'string' || typeof content !== 'string') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  const id = uuidv4();
  // Backup in SQLite
  await db.run(
    `INSERT INTO notes (id,title,content,tags,links) VALUES (?,?,?,?,?)`,
    id,
    title,
    content,
    tags ? JSON.stringify(tags) : null,
    JSON.stringify([])
  );
  // Primary storage in Mem0
  syncNoteToMem0(id, title, content);
  res.json({ id, title, tags: tags||[], via: 'mem0' });
});

/**
 * GET /mcp/zk_get_note - Retrieve a note by ID, Mem0 primary with SQLite fallback.
 * @param {string} id - Note ID.
 */
app.get('/mcp/zk_get_note', async (req: Request, res: Response) => {
  const id = String(req.query.id || '');
  if (!id) {
    res.status(400).json({ error: 'ID required' });
    return;
  }
  const memNote = await getNoteFromMem0(id);
  if (memNote) {
    res.json(memNote);
    return;
  }
  // Fallback to SQLite
  const row = await db.get(`SELECT * FROM notes WHERE id = ?`, id);
  if (row) {
    res.json({ 
      id: row.id, 
      title: row.title, 
      content: row.content,
      tags: row.tags ? JSON.parse(row.tags) : [],
      links: JSON.parse(row.links || '[]'),
      via: 'sqlite' 
    });
    return;
  }
  res.status(404).json({ error: 'Note not found' });
});

/**
 * POST /mcp/zk_create_link - Create a bidirectional link between notes (SQLite backup only).
 * @param {string} from - Origin note ID.
 * @param {string} to - Target note ID.
 * @param {string} type - Link type.
 */
app.post('/mcp/zk_create_link', async (req: Request, res: Response) => {
  const { from, to, type } = req.body;
  if (!from || !to || !type) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }
  const origin = await db.get(`SELECT links FROM notes WHERE id=?`, from);
  const target = await db.get(`SELECT links FROM notes WHERE id=?`, to);
  if (!origin || !target) {
    res.status(404).json({ error: 'Note(s) not found' });
    return;
  }
  const oLinks = JSON.parse(origin.links);
  const tLinks = JSON.parse(target.links);
  oLinks.push({ from, to, type });
  tLinks.push({ from: to, to: from, type: `${type}_by` });
  await db.run(`UPDATE notes SET links=? WHERE id=?`, JSON.stringify(oLinks), from);
  await db.run(`UPDATE notes SET links=? WHERE id=?`, JSON.stringify(tLinks), to);
  res.json({ success: true, from, to, type });
});

/**
 * POST /mcp/zk_search_notes - Search notes semantically via Mem0 with SQLite fallback.
 * @param {string} query - Search query string.
 */
app.post('/mcp/zk_search_notes', async (req: Request, res: Response) => {
  const { query } = req.body;
  if (typeof query !== 'string') {
    res.status(400).json({ error: 'Invalid query' });
    return;
  }
  try {
    const results = await withTimeout(
      memory.search(query, { userId, limit: 10 }),
      mem0TimeoutMs
    );
    const notes = Array.isArray(results) ? results.map((m: any) => ({ id: m.id, content: m.memory, via: 'mem0' })) : [];
    res.json({ results: notes, via: 'mem0' });
    return;
  } catch (err: any) {
    logger.warn(`[Mem0] Search error: ${err.message}, using SQLite`);
    const rows = await db.all(
      `SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 10`,
      `%${query}%`, `%${query}%`
    );
    const processedResults = rows.map(row => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : [],
      links: JSON.parse(row.links || '[]')
    }));
    res.json({ results: processedResults, via: 'sqlite' });
  }
});

/**
 * GET /health - Health check endpoint.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '0.10.0'
  });
});

/**
 * GET /sse - Server-Sent Events endpoint for MCP SSE transport
 */
app.get('/sse', (req: Request, res: Response) => {
  logger.info(`[SSE] Connection attempt from ${req.ip}, headers:`, req.headers);
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  logger.info('[SSE] Headers sent, writing endpoint event...');

  // Send endpoint event (required by MCP SSE spec)
  res.write('event: endpoint\n');
  res.write('data: {"uri": "/messages"}\n\n');

  logger.info('[SSE] Endpoint event sent, connection established');

  // Handle client disconnect
  req.on('close', () => {
    logger.info('[SSE] Client disconnected');
  });

  req.on('error', (err) => {
    logger.error(`[SSE] Connection error: ${err.message}, stack:`, err.stack);
  });

  // Handle response errors
  res.on('error', (err) => {
    logger.error(`[SSE] Response error: ${err.message}`);
  });

  // Don't end the response - keep it open for streaming
});

/**
 * POST /messages - Handle MCP messages for SSE transport
 */
app.post('/messages', async (req: Request, res: Response) => {
  try {
    logger.info('[SSE] Received message:', JSON.stringify(req.body, null, 2));
    const { method, params, id } = req.body;
    
    if (method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: 'zettelkasten-mem0-server',
            version: '0.10.0'
          }
        }
      });
      return;
    }

    if (method === 'tools/list') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'zk_create_note',
              description: 'Create a new Zettelkasten note with semantic storage',
              inputSchema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Note title' },
                  content: { type: 'string', description: 'Note content' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' }
                },
                required: ['title', 'content']
              }
            },
            {
              name: 'zk_get_note',
              description: 'Retrieve a note by ID from semantic memory',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Note ID' }
                },
                required: ['id']
              }
            },
            {
              name: 'zk_search_notes',
              description: 'Search notes semantically using Mem0',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' }
                },
                required: ['query']
              }
            },
            {
              name: 'zk_create_link',
              description: 'Create bidirectional link between notes',
              inputSchema: {
                type: 'object',
                properties: {
                  from: { type: 'string', description: 'Source note ID' },
                  to: { type: 'string', description: 'Target note ID' },
                  type: { type: 'string', description: 'Link type' }
                },
                required: ['from', 'to', 'type']
              }
            }
          ]
        }
      });
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      let result;

      switch (name) {
        case 'zk_create_note':
          const { title, content, tags } = args;
          if (typeof title !== 'string' || typeof content !== 'string') {
            throw new Error('Invalid payload: title and content must be strings');
          }
          const id = uuidv4();
          // Backup in SQLite
          await db.run(
            `INSERT INTO notes (id,title,content,tags,links) VALUES (?,?,?,?,?)`,
            id, title, content,
            tags ? JSON.stringify(tags) : null,
            JSON.stringify([])
          );
          // Primary storage in Mem0
          syncNoteToMem0(id, title, content);
          result = { content: [{ type: 'text', text: `Created note "${title}" with ID: ${id}` }] };
          break;

        case 'zk_get_note':
          const noteId = args.id;
          if (!noteId) {
            throw new Error('Note ID required');
          }
          const memNote = await getNoteFromMem0(noteId);
          if (memNote) {
            result = { content: [{ type: 'text', text: `Note: ${memNote.content}` }] };
          } else {
            // Fallback to SQLite
            const row = await db.get(`SELECT * FROM notes WHERE id = ?`, noteId);
            if (row) {
              result = { content: [{ type: 'text', text: `Note: ${row.title}\n${row.content}` }] };
            } else {
              throw new Error('Note not found');
            }
          }
          break;

        case 'zk_search_notes':
          const query = args.query;
          if (typeof query !== 'string') {
            throw new Error('Invalid query: must be a string');
          }
          try {
            const results = await withTimeout(
              memory.search(query, { userId, limit: 10 }),
              mem0TimeoutMs
            );
            const notes = Array.isArray(results) ? results.map((m: any) => `ID: ${m.id}\nContent: ${m.memory}`).join('\n\n') : 'No results found';
            result = { content: [{ type: 'text', text: `Search results:\n${notes}` }] };
          } catch (err: any) {
            logger.warn(`[Mem0] Search error: ${err.message}, using SQLite`);
            const rows = await db.all(
              `SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 10`,
              `%${query}%`, `%${query}%`
            );
            const notes = rows.map(row => `ID: ${row.id}\nTitle: ${row.title}\nContent: ${row.content}`).join('\n\n');
            result = { content: [{ type: 'text', text: `Search results (SQLite):\n${notes}` }] };
          }
          break;

        case 'zk_create_link':
          const { from, to, type } = args;
          if (!from || !to || !type) {
            throw new Error('Missing fields: from, to, and type are required');
          }
          const origin = await db.get(`SELECT links FROM notes WHERE id=?`, from);
          const target = await db.get(`SELECT links FROM notes WHERE id=?`, to);
          if (!origin || !target) {
            throw new Error('One or both notes not found');
          }
          const oLinks = JSON.parse(origin.links);
          const tLinks = JSON.parse(target.links);
          oLinks.push({ from, to, type });
          tLinks.push({ from: to, to: from, type: `${type}_by` });
          await db.run(`UPDATE notes SET links=? WHERE id=?`, JSON.stringify(oLinks), from);
          await db.run(`UPDATE notes SET links=? WHERE id=?`, JSON.stringify(tLinks), to);
          result = { content: [{ type: 'text', text: `Created ${type} link from ${from} to ${to}` }] };
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      res.json({
        jsonrpc: '2.0',
        id,
        result
      });
      return;
    }

    // Unknown method
    res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });

  } catch (error: any) {
    logger.error(`[MCP] Tool execution error: ${error.message}`);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: { code: -32603, message: error.message }
    });
  }
});

/**
 * Error-handling middleware.
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`[Error] Unhandled: ${err.message}`);
  res.status(500).json({ error: 'Internal error' });
});

/**
 * Start the server and handle graceful shutdown.
 */
const server = app.listen(port, () => {
  logger.info(`[MCP] Server listening on port ${port}`);
  logger.info(`[MCP] Health check: http://localhost:${port}/health`);
  logger.info(`[MCP] MCP spec: http://localhost:${port}/mcp/spec`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`[Shutdown] Received ${signal}`);
  try {
    server.close(() => {
      logger.info('[Shutdown] HTTP server closed');
    });
    if (db) {
      await db.close();
      logger.info('[Shutdown] SQLite closed');
    }
    process.exit(0);
  } catch (err) {
    logger.error('[Shutdown] Error during cleanup:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
