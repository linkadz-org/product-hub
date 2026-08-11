import { describe, expect, it } from 'vitest';
import { NAV_AREAS } from '@/layouts/sidebar/menuConfig';
import { navSource } from './navSource';

describe('navSource', () => {
  it('KHÔNG trả mục adminOnly cho người không phải admin', () => {
    const paths = navSource(false).map((i) => i.run.to);
    expect(paths).not.toContain('/admin/settings');
    expect(paths).not.toContain('/admin/people');
    expect(paths).not.toContain('/design-patterns');
  });

  it('trả mục admin cho admin', () => {
    expect(navSource(true).map((i) => i.run.to)).toContain('/admin/settings');
  });

  it('phủ hết các mục không-admin trong NAV_AREAS', () => {
    const expected = NAV_AREAS
      .filter((a) => !a.adminOnly)
      .flatMap((a) => a.sections)
      .flatMap((s) => s.items)
      .flatMap((i) => [i, ...(i.children ?? [])])
      // Hàng có `search` là cùng pathname với hàng khác — palette gộp làm một.
      .filter((i) => !i.adminOnly && !i.search && !i.children);
    const got = new Set(navSource(false).map((i) => i.run.to));
    for (const item of expected) expect(got.has(item.path)).toBe(true);
  });
});
