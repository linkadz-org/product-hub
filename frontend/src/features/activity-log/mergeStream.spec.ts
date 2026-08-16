import { describe, expect, it } from 'vitest';
import { mergeStream } from './mergeStream';

const c = (id: string, at: string) => ({ id, createdAt: at }) as never;
const e = (id: string, at: string) => ({ id, createdAt: at }) as never;

describe('mergeStream', () => {
  it('interleaves comments and events oldest first', () => {
    const out = mergeStream(
      [c('c1', '2026-08-02T10:03:00Z'), c('c2', '2026-08-05T09:00:00Z')],
      [e('e1', '2026-08-02T09:14:00Z'), e('e2', '2026-08-03T08:41:00Z')],
    );
    expect(out.map((x) => x.id)).toEqual(['e1', 'c1', 'e2', 'c2']);
  });

  it('tags each item with its kind', () => {
    const out = mergeStream([c('c1', '2026-08-02T10:00:00Z')], [e('e1', '2026-08-02T09:00:00Z')]);
    expect(out[0].kind).toBe('event');
    expect(out[1].kind).toBe('comment');
  });

  it('survives either side being empty or undefined', () => {
    expect(mergeStream([], [])).toEqual([]);
    expect(mergeStream(undefined as never, undefined as never)).toEqual([]);
  });
});
