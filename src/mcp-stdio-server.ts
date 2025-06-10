#!/usr/bin/env node

/**
 * MCP Zettelkasten Server - STDIO Transport
 * 
 * This is a proper MCP server implementation for stdio transport.
 * Cursor will execute this and communicate via stdin/stdout.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import MemoryClient from 'mem0ai';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  mem0ApiKey: process.env.MEM0_API_KEY,
  userId: process.env.MCP_USER_ID || 'zettelkasten_mcp',
  storageDir: process.env.MCP_STORAGE_DIR,
  mem0TimeoutMs: process.env.MCP_MEM0_TIMEOUT ? parseInt(process.env.MCP_MEM0_TIMEOUT) : 5000,
};

if (!config.mem0ApiKey) {
  console.error('[MCP] Missing Mem0 API Key');
  console.error('[MCP] Please set MEM0_API_KEY in your environment');
  process.exit(1);
}

// Setup storage directory
const defaultDir = path.join(os.homedir(), '.mcp-servers', 'mcp-zettelkasten-notes-mem0');
function expandHomeDir(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

let dbDir = config.storageDir || defaultDir;
dbDir = expandHomeDir(dbDir);
fs.mkdirSync(dbDir, { recursive: true });

const storageFile = path.join(dbDir, 'notes-db.sqlite');

// Database setup
let db: Database<sqlite3.Database, sqlite3.Statement>;

async function initDB(): Promise<void> {
  db = await open({ filename: storageFile, driver: sqlite3.Database });
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
  console.error('[MCP] SQLite initialized'); // Use stderr for logging
}

// Memory setup - using Mem0 managed service
const memory = new MemoryClient({ apiKey: config.mem0ApiKey });

// Utility functions
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
}

async function syncNoteToMem0(id: string, title: string, content: string): Promise<void> {
  try {
    const messages = [
      { role: "user" as const, content: `[${id}] ${title}: ${content}` }
    ];
    await withTimeout(
      memory.add(messages, { user_id: config.userId }),
      config.mem0TimeoutMs
    );
    console.error(`[MCP] Note ${id} synced to Mem0`);
  } catch (err: any) {
    console.error(`[MCP] Mem0 sync failed: ${err.message}`);
  }
}

async function getNoteFromMem0(id: string): Promise<{id: string, content: string, via: string} | null> {
  try {
    const results = await withTimeout(
      memory.search(`[${id}]`, { user_id: config.userId, limit: 1 }),
      config.mem0TimeoutMs
    );
    if (Array.isArray(results) && results.length > 0 && results[0] && 'content' in results[0]) {
      return { id, content: String(results[0].content), via: 'mem0' };
    }
  } catch (err: any) {
    console.error(`[MCP] Mem0 search failed: ${err.message}`);
  }
  return null;
}

// Create MCP server
const server = new Server(
  {
    name: 'zettelkasten-mem0-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
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
      
      // Store in Mem0
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
        const results = await withTimeout(
          memory.search(query, { user_id: config.userId, limit: 10 }),
          config.mem0TimeoutMs
        );
        const notes = Array.isArray(results) ? 
          results.map((m: any) => `ID: ${m.id}\nContent: ${m.memory}`).join('\n\n') : 
          'No results found';
        return {
          content: [{ type: 'text', text: `Search results:\n${notes}` }]
        };
      } catch (err: any) {
        console.error(`[MCP] Mem0 search error: ${err.message}, using SQLite`);
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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Main function
async function main() {
  try {
    await initDB();
    console.error('[MCP] Server initialized');
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] Server started on stdio');
  } catch (error) {
    console.error('[MCP] Server error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (db) {
    await db.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (db) {
    await db.close();
  }
  process.exit(0);
});

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
}); 