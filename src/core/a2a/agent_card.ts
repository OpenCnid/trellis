import { A2A_SUPPORTED_VERSION } from './protocol.js';

// Session 11: the A2A Agent Card (spec §4.4/§8), built purely from
// validated config. The card is served from the public well-known
// discovery path, so its content is public contract by definition:
// nothing secret — the API key, internal hosts, queue names, bounds —
// may ever appear here. The no-leak property is pinned by unit test.

/** Advertised agent version; tracks the package release line. */
export const A2A_AGENT_VERSION = '1.0.0';

export interface AgentCardInputs {
  name: string;
  description: string;
  /** Public URL of the JSON-RPC interface (config.a2a.agentUrl). */
  url: string;
  /** Whether the API requires a key, so the card can declare the scheme. */
  apiKeyConfigured: boolean;
}

/**
 * The ProtoJSON AgentCard. One skill — bounded agentic goal execution —
 * over one JSONRPC interface. Streaming is declared (SendStreamingMessage
 * is served); push notifications and the extended card are not.
 */
export function buildAgentCard(inputs: AgentCardInputs): Record<string, unknown> {
  return {
    name: inputs.name,
    description: inputs.description,
    supportedInterfaces: [
      {
        url: inputs.url,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_SUPPORTED_VERSION,
      },
    ],
    version: A2A_AGENT_VERSION,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    ...(inputs.apiKeyConfigured && {
      securitySchemes: {
        apiKey: {
          apiKeySecurityScheme: {
            description: 'Trellis API key; also accepted as an Authorization: Bearer token.',
            location: 'header',
            name: 'x-api-key',
          },
        },
      },
      securityRequirements: [{ schemes: { apiKey: { list: [] } } }],
    }),
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'goal-execution',
        name: 'Agentic goal execution',
        description:
          'Executes one natural-language goal as a bounded agentic loop over a '
          + 'provenance-preserving knowledge graph. The goal is decomposed into '
          + 'research sub-tasks; the final answer is returned as a text artifact. '
          + 'Every run is hard-bounded in iterations and dispatched tasks, and '
          + 'answers are grounded in content-addressed source provenance.',
        tags: ['graphrag', 'provenance', 'knowledge-graph', 'agentic-goal'],
        examples: [
          'Summarize everything the graph knows about Globex Corporation and cite the sources.',
        ],
      },
    ],
  };
}
