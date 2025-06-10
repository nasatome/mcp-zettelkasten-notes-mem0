/**
 * Shared constants for both MCP servers (STDIO and Express)
 */

/**
 * Specification of available MCP tools implementing Zettelkasten methodology.
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

/**
 * Zettelkasten methodology response (shared between servers)
 */
export const methodologyResponse = {
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
      action: "zk_search_notes",
      purpose: "Find existing context and related knowledge",
      rule: "NEVER respond without searching first"
    },
    "2_analyze": {
      action: "zk_get_note (if needed)",
      purpose: "Retrieve specific notes to understand current knowledge state",
      rule: "Plan response based on retrieved notes"
    },
    "3_create": {
      action: "zk_create_note", 
      purpose: "Add new atomic knowledge discoveries",
      rule: "One idea per note, clear title, concise content"
    },
    "4_link": {
      action: "zk_create_link",
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
      "1. zk_search_notes query='Next.js authentication'",
      "2. Analyze retrieved notes about auth patterns, libraries, security",
      "3. zk_create_note with new implementation approach",
      "4. zk_create_link connecting to existing auth/Next.js notes",
      "5. Respond with solution referencing note network used"
    ]
  }
};

/**
 * MCP Tool Schema for both STDIO and SSE transports
 */
export const mcpToolsSchema = [
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
  },
  {
    name: 'zk_get_methodology',
    description: 'Get Zettelkasten methodology and workflow explanation',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
]; 