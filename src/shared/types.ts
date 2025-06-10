/**
 * Shared types for MCP Zettelkasten servers
 */

export interface MCPConfig {
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

export interface NoteResult {
  id: string;
  content: string;
  via: string;
  title?: string;
  tags?: string[];
  links?: any[];
}

export interface SearchResult {
  results: any[];
  via: 'mem0' | 'sqlite';
}

export interface LinkData {
  from: string;
  to: string;
  type: string;
} 