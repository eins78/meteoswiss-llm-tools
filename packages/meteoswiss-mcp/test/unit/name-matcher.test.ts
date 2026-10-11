import { describe, expect, it } from 'vitest';
import { scoreNameMatch, escapeRegex } from '../../src/support/name-matcher.js';

describe('scoreNameMatch', () => {
  it('should return 0 for empty query', () => {
    expect(scoreNameMatch('', 'bern / zollikofen')).toBe(0);
  });

  it('should return 100 for exact match', () => {
    expect(scoreNameMatch('davos', 'davos')).toBe(100);
    expect(scoreNameMatch('bern / zollikofen', 'bern / zollikofen')).toBe(100);
  });

  it('should return 50 for word-boundary match', () => {
    // "bern" is a complete word in "bern / zollikofen"
    expect(scoreNameMatch('bern', 'bern / zollikofen')).toBe(50);
    // "zurich" is a complete word in "zurich / fluntern"
    expect(scoreNameMatch('zurich', 'zurich / fluntern')).toBe(50);
  });

  it('should return 10 for substring-only match', () => {
    // "bern" is inside "bernina" — not a word boundary
    expect(scoreNameMatch('bern', 'passo del bernina')).toBe(10);
  });

  it('should return 0 for no match', () => {
    expect(scoreNameMatch('xyz', 'bern / zollikofen')).toBe(0);
    expect(scoreNameMatch('paris', 'zurich / fluntern')).toBe(0);
  });

  it('should score "Bern" higher for BER than BEH', () => {
    const berScore = scoreNameMatch('bern', 'bern / zollikofen');
    const behScore = scoreNameMatch('bern', 'passo del bernina');
    expect(berScore).toBeGreaterThan(behScore);
  });

  it('should handle word boundaries with hyphens, apostrophes, and commas', () => {
    // Apostrophe is a word boundary — "oex" is a separate word in "chateau-d'oex"
    expect(scoreNameMatch('oex', "chateau-d'oex")).toBe(50);
    expect(scoreNameMatch('maria', 'sta. maria, val mustair')).toBe(50);
  });

  it('should handle query with regex special characters', () => {
    // "st." contains a regex wildcard — should be escaped for literal matching
    expect(scoreNameMatch('st.', 'st. gallen')).toBe(50);
    // "stabio" does NOT contain "st." (no period) — no match at all
    expect(scoreNameMatch('st.', 'stabio')).toBe(0);
  });
});

describe('escapeRegex', () => {
  it('should escape regex special characters', () => {
    expect(escapeRegex('st.')).toBe('st\\.');
    expect(escapeRegex('a+b')).toBe('a\\+b');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
  });

  it('should leave normal strings unchanged', () => {
    expect(escapeRegex('bern')).toBe('bern');
    expect(escapeRegex('zurich / fluntern')).toBe('zurich / fluntern');
  });
});
