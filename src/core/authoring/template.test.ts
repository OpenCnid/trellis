import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_TEMPLATE,
  AUTHORING_TOPIC_MAX_CHARS,
  composeAuthoringPrompt,
  validateAuthoringTopic,
} from './template';

// Session 19 (design record §6): the authoring template is a kernel
// constant, byte-pinned so drift fails loudly. It renders from exactly
// two operator inputs — a bounded topic and the corpus doc keys — so
// pre-stating the target directives is structurally impossible.

const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// The template's byte pin (recompute in the same commit only when the
// kernel template legitimately changes).
const TEMPLATE_SHA256 = '3ff3e36cba719a20cc5becade6578869af5c01e5960d046f24ba8b9044ca6b27';
// A composed example's byte pin: (topic, doc keys) -> exact bytes.
const EXAMPLE_SHA256 = '307a0a582c4608c1bd5861687877ed0bdd023aef53648d5fed0493afdaeef4bb';

describe('AUTHORING_TEMPLATE', () => {
  it('is byte-pinned against drift', () => {
    expect(sha256(AUTHORING_TEMPLATE)).toBe(TEMPLATE_SHA256);
  });

  it('is brace-free (it transits rlms .format())', () => {
    expect(AUTHORING_TEMPLATE).not.toMatch(/[{}]/);
  });

  it('does not enumerate protocol directives (only the two substitution tokens are variable)', () => {
    expect(AUTHORING_TEMPLATE).toContain('<<AUTHORING_TOPIC>>');
    expect(AUTHORING_TEMPLATE).toContain('<<AUTHORING_DOC_KEYS>>');
    // The task frame: sources in, protocol out; derive, declare gaps.
    expect(AUTHORING_TEMPLATE).toContain('derive the operating protocol');
    expect(AUTHORING_TEMPLATE).toContain('gap note');
  });
});

describe('validateAuthoringTopic', () => {
  it('accepts a bounded single-line printable sentence', () => {
    expect(validateAuthoringTopic('workspace discipline for an RLM sub-agent')).toEqual({ ok: true });
  });

  it('rejects empty, over-long, multi-line, control-bearing, and brace-bearing topics', () => {
    expect(validateAuthoringTopic('   ').ok).toBe(false);
    expect(validateAuthoringTopic('x'.repeat(AUTHORING_TOPIC_MAX_CHARS + 1)).ok).toBe(false);
    expect(validateAuthoringTopic('two\nlines').ok).toBe(false);
    expect(validateAuthoringTopic('tab\there').ok).toBe(false);
    expect(validateAuthoringTopic('has {brace}').ok).toBe(false);
  });
});

describe('composeAuthoringPrompt', () => {
  it('renders from (topic, doc keys) only and is byte-pinned', () => {
    const prompt = composeAuthoringPrompt('workspace discipline for an RLM sub-agent', [
      'research:trellis/a',
      'research:trellis/b',
    ]);
    expect(sha256(prompt)).toBe(EXAMPLE_SHA256);
    expect(prompt).toContain('TOPIC: workspace discipline for an RLM sub-agent');
    expect(prompt).toContain('research:trellis/a, research:trellis/b');
    // The substitution tokens are gone; no literal braces reach rlms.
    expect(prompt).not.toContain('<<AUTHORING_TOPIC>>');
    expect(prompt).not.toContain('<<AUTHORING_DOC_KEYS>>');
    expect(prompt).not.toMatch(/[{}]/);
  });

  it('preserves doc-key order', () => {
    const prompt = composeAuthoringPrompt('t', ['research:z', 'research:a', 'research:m']);
    expect(prompt).toContain('research:z, research:a, research:m');
  });

  it('refuses an invalid topic or an empty corpus', () => {
    expect(() => composeAuthoringPrompt('bad {brace}', ['research:a'])).toThrow(/topic/);
    expect(() => composeAuthoringPrompt('fine topic', [])).toThrow(/doc key/);
  });
});
