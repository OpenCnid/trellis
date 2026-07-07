import { describe, expect, it } from 'vitest';
import { buildAgentCard } from './agent_card';

// Session 11: the Agent Card is public discovery contract. Shape per
// A2A v1.0 §4.4, and — the load-bearing check — no secret or internal
// value may survive serialization (HANDOFF §6).

const INPUTS = {
  name: 'Trellis Engine',
  description: 'Provenance-preserving GraphRAG agent.',
  url: 'https://trellis.example.com/a2a/v1',
  apiKeyConfigured: true,
};

describe('buildAgentCard', () => {
  it('declares the required v1.0 card fields', () => {
    const card = buildAgentCard(INPUTS) as any;
    expect(card.name).toBe('Trellis Engine');
    expect(card.description).toBe('Provenance-preserving GraphRAG agent.');
    expect(card.version).toBeTruthy();
    expect(card.supportedInterfaces).toEqual([
      {
        url: 'https://trellis.example.com/a2a/v1',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ]);
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });

  it('declares streaming but not push notifications or the extended card', () => {
    const card = buildAgentCard(INPUTS) as any;
    expect(card.capabilities).toEqual({
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
    });
  });

  it('exposes exactly one goal-execution skill with required fields', () => {
    const card = buildAgentCard(INPUTS) as any;
    expect(card.skills).toHaveLength(1);
    const skill = card.skills[0];
    expect(skill.id).toBe('goal-execution');
    expect(skill.name).toBeTruthy();
    expect(skill.description).toContain('provenance');
    expect(skill.tags.length).toBeGreaterThan(0);
  });

  it('declares the x-api-key scheme only when a key is configured', () => {
    const withKey = buildAgentCard(INPUTS) as any;
    expect(withKey.securitySchemes.apiKey.apiKeySecurityScheme).toEqual({
      description: 'Trellis API key; also accepted as an Authorization: Bearer token.',
      location: 'header',
      name: 'x-api-key',
    });
    expect(withKey.securityRequirements).toEqual([{ schemes: { apiKey: { list: [] } } }]);

    const open = buildAgentCard({ ...INPUTS, apiKeyConfigured: false }) as any;
    expect(open.securitySchemes).toBeUndefined();
    expect(open.securityRequirements).toBeUndefined();
  });

  it('never leaks secrets or internal values into the serialized card', () => {
    // The builder receives only public inputs by construction; this
    // pins that no config plumbing ever routes internals through it.
    const serialized = JSON.stringify(
      buildAgentCard({
        ...INPUTS,
        apiKeyConfigured: true,
      })
    );
    for (const secretish of [
      'trellis-secret-api-key-value',
      'trellis_password', // database credentials
      'bolt://', // Neo4j URI scheme
      '127.0.0.1:5433', // Postgres
      '127.0.0.1:6379', // Redis
      'agent_queue',
      'rlm_queue',
      'TRELLIS_MCP_SERVERS',
      'OPENAI',
    ]) {
      expect(serialized).not.toContain(secretish);
    }
  });
});
