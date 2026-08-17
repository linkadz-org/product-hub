import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('gộp class và bỏ giá trị falsy', () => {
    expect(cn('a', false && 'b', 'c')).toContain('a');
    expect(cn('a', false && 'b', 'c')).toContain('c');
  });
});
