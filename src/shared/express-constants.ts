/**
 * Constants specific to Express/SSE MCP server
 */

/**
 * Specification of available MCP tools implementing Zettelkasten methodology.
 * Used for GET /mcp/spec endpoint
 */
export const toolSpec = [
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

// methodologyResponse moved to shared/constants.ts 