// Regression guard for the test foundation itself (Task 13), not for app code.
//
// Nothing else in the suite exercises localStorage or the DOM yet, so if the
// happy-dom/Node global collision documented in ./setup.ts ever regresses — a
// vitest/happy-dom upgrade, a setupFiles change, running on a Node version with a
// different globals story — every later task that depends on this foundation
// (Task 15's recentSource, Task 17's rendered dialog) would fail with no clue that
// the environment, not their own code, is at fault. This test exists so that failure
// is loud and local.
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('test environment', () => {
  it('resolves the @/ alias', () => {
    expect(cn('x')).toBe('x');
  });

  it('provides a working localStorage (round-trip, not the shadowed Node global)', () => {
    localStorage.setItem('environment-spec-key', 'v');
    expect(localStorage.getItem('environment-spec-key')).toBe('v');
    localStorage.removeItem('environment-spec-key');
    expect(localStorage.getItem('environment-spec-key')).toBeNull();
  });

  it('provides a DOM (document.createElement)', () => {
    const el = document.createElement('div');
    expect(el.tagName).toBe('DIV');
  });
});
