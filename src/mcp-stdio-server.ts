#!/usr/bin/env node

/**
 * MCP Zettelkasten Server - STDIO Transport
 * 
 * This is a proper MCP server implementation for stdio transport.
 * Cursor will execute this and communicate via stdin/stdout.
 * 
 * Features:
 * - Dual mode support (Mem0 simple vs OSS advanced)
 * - Retry queue for failed operations
 * - SQLite backup with WAL mode
 * - Proper error handling and timeouts
 * - Graceful shutdown
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory } from 'mem0ai/oss';
import MemoryClient from 'mem0ai';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import dotenv from 'dotenv';

// Shared modules
import { MCPConfig } from './shared/types.js';
import { mcpToolsSchema, methodologyResponse } from './shared/constants.js';
import { stdioServerInfo, stdioCapabilities } from './shared/stdio-constants.js';
import { withTimeout, normalizeSearchResults, expandHomeDir, getDefaultStorageDir, formatSearchResults } from './shared/utils.js';
import { createLogger } from './shared/logger.js';

// Load environment variables with absolute path
dotenv.config({ path: '/opt/prj/mcp-zettelkasten-notes-mem0/.env' });

// Configuration interface imported from shared

// Configuration from environment variables
const config: MCPConfig = {
  mem0ApiKey: process.env.MEM0_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  mem0SimpleMode: process.env.MEM0_SIMPLE_MODE === 'true',
  userId: process.env.MCP_USER_ID || 'zettelkasten_mcp',
  storageDir: process.env.MCP_STORAGE_DIR,
  mem0TimeoutMs: process.env.MCP_MEM0_TIMEOUT ? parseInt(process.env.MCP_MEM0_TIMEOUT) : 5000,
};

const {
  mem0ApiKey,
  openaiApiKey,
  mem0SimpleMode = true,
  userId = 'zettelkasten_mcp',
  storageDir,
  mem0TimeoutMs = 5000
} = config as Required<MCPConfig>;

// Validate required API keys based on mode
if (mem0SimpleMode && !mem0ApiKey) {
  console.error('[MCP] Missing Mem0 API Key for simple mode');
  console.error('[MCP] Please set MEM0_API_KEY in your environment');
  process.exit(1);
}

if (!mem0SimpleMode && !openaiApiKey) {
  console.error('[MCP] Missing OpenAI API Key for advanced mode');
  console.error('[MCP] Please set OPENAI_API_KEY in your environment');
  process.exit(1);
}

// Setup storage directory
const defaultDir = getDefaultStorageDir();

let dbDir = storageDir || defaultDir;
dbDir = expandHomeDir(dbDir);
fs.mkdirSync(dbDir, { recursive: true });

const storageFile = path.join(dbDir, 'notes-db.sqlite');

// Database setup
let db: Database<sqlite3.Database, sqlite3.Statement>;

async function initDB(): Promise<void> {
  db = await open({ filename: storageFile, driver: sqlite3.Database });
  // Performance optimizations
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
  logger.info(`SQLite initialized at ${storageFile}`);
}

// Memory setup - dual mode support
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

// Create logger for STDIO server
const logger = createLogger('stdio');

logger.info(`Mem0 initialized in ${mem0SimpleMode ? 'SIMPLE' : 'ADVANCED'} mode`);

// Utility functions imported from shared

/**
 * Sync a note to Mem0 with retry on failure
 */
async function syncNoteToMem0(id: string, title: string, content: string): Promise<void> {
  try {
    const payload = mem0SimpleMode 
      ? [{ role: "user" as const, content: `[${id}] ${title}: ${content}` }]
      : [
          { role: 'user', content: `Note: ${title}` },
          { role: 'assistant', content }
        ];
    
    const options = mem0SimpleMode 
      ? { user_id: userId }
      : { userId, metadata: { noteId: id, title } };

    await withTimeout(
      memory.add(payload, options),
      mem0TimeoutMs
    );
    logger.info(`Note ${id} synced to Mem0`);
  } catch (err: any) {
    logger.error(`Mem0 sync failed: ${err.message}`);
    // Add to retry queue
    await db.run('INSERT OR REPLACE INTO retry_queue (id,payload) VALUES (?,?)', 
      id, JSON.stringify({ id, title, content }));
  }
}

/**
 * Get note from Mem0 with proper result handling
 */
async function getNoteFromMem0(id: string): Promise<{id: string, content: string, via: string} | null> {
  try {
    const query = mem0SimpleMode ? `[${id}]` : `noteId:${id}`;
    const options = mem0SimpleMode 
      ? { user_id: userId, limit: 1 }
      : { userId, limit: 1 };

    const rawResults = await withTimeout(
      memory.search(query, options),
      mem0TimeoutMs
    );
    
    const results = normalizeSearchResults(rawResults);
    if (results.length > 0) {
      const content = mem0SimpleMode 
        ? (results[0].content || results[0].memory || String(results[0]))
        : results[0].memory;
      return { id, content: String(content), via: 'mem0' };
    }
  } catch (err: any) {
    logger.error(`Mem0 search failed: ${err.message}`);
  }
  return null;
}

/**
 * Search notes in Mem0 with proper result handling
 */
async function searchNotesInMem0(query: string): Promise<any[]> {
  try {
    const options = mem0SimpleMode 
      ? { user_id: userId, limit: 10 }
      : { userId, limit: 10 };

    const rawResults = await withTimeout(
      memory.search(query, options),
      mem0TimeoutMs
    );
    
    return normalizeSearchResults(rawResults);
  } catch (err: any) {
    logger.error(`Mem0 search error: ${err.message}`);
    throw err;
  }
}

/**
 * Retry queue flush
 */
async function flushRetryQueue(): Promise<void> {
  try {
    const failed = await db.all<{ id: string; payload: string }[]>('SELECT * FROM retry_queue');
    if (!failed.length) return;
    
    logger.info(`Flushing ${failed.length} retry queue item(s)`);
    for (const row of failed) {
      try {
        const { id, title, content }: { id: string; title: string; content: string } = JSON.parse(row.payload);
        await syncNoteToMem0(id, title, content);
        await db.run('DELETE FROM retry_queue WHERE id = ?', row.id);
        logger.info(`Retry synced ${row.id}`);
      } catch (err: any) {
        logger.warn(`Retry still failing ${row.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`Retry queue flush error: ${err.message}`);
  }
}

// Create MCP server
const server = new Server(
  stdioServerInfo,
  {
    capabilities: stdioCapabilities,
  }
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: mcpToolsSchema
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'zk_create_note':
      const { title, content, tags } = args as { title: string, content: string, tags?: string[] };
      if (typeof title !== 'string' || typeof content !== 'string') {
        throw new Error('Invalid payload: title and content must be strings');
      }
      const id = uuidv4();
      
      // Store in SQLite
      await db.run(
        `INSERT INTO notes (id,title,content,tags,links) VALUES (?,?,?,?,?)`,
        id, title, content,
        tags ? JSON.stringify(tags) : null,
        JSON.stringify([])
      );
      
      // Store in Mem0 (async with retry on failure)
      syncNoteToMem0(id, title, content);
      
      return {
        content: [{ type: 'text', text: `Created note "${title}" with ID: ${id}` }]
      };

    case 'zk_get_note':
      if (!args) {
        throw new Error('Arguments required');
      }
      const noteId = args.id as string;
      if (!noteId) {
        throw new Error('Note ID required');
      }
      
      // Try Mem0 first
      const memNote = await getNoteFromMem0(noteId);
      if (memNote) {
        return {
          content: [{ type: 'text', text: `Note: ${memNote.content}` }]
        };
      }
      
      // Fallback to SQLite
      const row = await db.get(`SELECT * FROM notes WHERE id = ?`, noteId);
      if (row) {
        return {
          content: [{ type: 'text', text: `Note: ${row.title}\n${row.content}` }]
        };
      } else {
        throw new Error('Note not found');
      }

    case 'zk_search_notes':
      if (!args) {
        throw new Error('Arguments required');
      }
      const query = args.query as string;
      if (typeof query !== 'string') {
        throw new Error('Invalid query: must be a string');
      }
      
      try {
        const results = await searchNotesInMem0(query);
        const notes = formatSearchResults(results, mem0SimpleMode);
        return {
          content: [{ type: 'text', text: `Search results:\n${notes}` }]
        };
      } catch (err: any) {
        logger.warn(`Mem0 search error, using SQLite fallback`);
        const rows = await db.all(
          `SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 10`,
          `%${query}%`, `%${query}%`
        );
        const notes = rows.map(row => `ID: ${row.id}\nTitle: ${row.title}\nContent: ${row.content}`).join('\n\n');
        return {
          content: [{ type: 'text', text: `Search results (SQLite):\n${notes}` }]
        };
      }

    case 'zk_create_link':
      const { from, to, type } = args as { from: string, to: string, type: string };
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
      
      return {
        content: [{ type: 'text', text: `Created ${type} link from ${from} to ${to}` }]
      };

    case 'zk_get_methodology':
      return {
        content: [{ 
          type: 'text', 
          text: `Zettelkasten Methodology with Mem0\n\n${JSON.stringify(methodologyResponse, null, 2)}` 
        }]
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Main function
async function main() {
  try {
    await initDB();
    logger.info('Database initialized');
    
    // Start retry queue flush interval
    setInterval(flushRetryQueue, 10000).unref();
    logger.info('Retry queue started');
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Server started on stdio');
  } catch (error) {
    logger.error(`Server error: ${error}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  if (db) {
    await db.close();
    logger.info('Database closed');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  if (db) {
    await db.close();
    logger.info('Database closed');
  }
  process.exit(0);
});

main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
}); 