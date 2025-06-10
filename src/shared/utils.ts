/**
 * Shared utility functions for MCP Zettelkasten servers
 */

import path from 'path';
import os from 'os';

/**
 * Wrap a promise with a timeout.
 * @template T
 * @param {Promise<T>} promise - The promise to wrap.
 * @param {number} ms - Timeout in milliseconds.
 * @returns {Promise<T>} A promise that rejects on timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Helper function to handle both MemoryClient and Memory search results
 * @param {any} results - Search results from either client
 * @returns {any[]} Normalized array of results
 */
export function normalizeSearchResults(results: any): any[] {
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
 * Helper function to expand ~ to home directory
 * @param {string} filePath - Path that might contain ~
 * @returns {string} Expanded path
 */
export function expandHomeDir(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Get the default storage directory for the application
 * @returns {string} Default storage directory path
 */
export function getDefaultStorageDir(): string {
  return path.join(os.homedir(), '.mcp-servers', 'mcp-zettelkasten-notes-mem0');
}

/**
 * Format search results for display
 * @param {any[]} results - Normalized search results
 * @param {boolean} mem0SimpleMode - Whether using simple mode
 * @returns {string} Formatted results string
 */
export function formatSearchResults(results: any[], mem0SimpleMode: boolean): string {
  if (results.length === 0) {
    return 'No results found';
  }
  
  return results.map((m: any) => {
    const content = mem0SimpleMode 
      ? (m.content || m.memory || String(m))
      : m.memory;
    return `ID: ${m.id || 'unknown'}\nContent: ${content}`;
  }).join('\n\n');
} 