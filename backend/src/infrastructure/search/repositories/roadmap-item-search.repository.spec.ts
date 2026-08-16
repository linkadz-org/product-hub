import {
  buildRoadmapItemSearchFilter,
  itemMatchesQuery,
  mapRoadmapItemToHit,
} from './roadmap-item-search.repository';
import { RoadmapItemData } from '@application/roadmaps/domain/types/roadmap-item.type';
import { RoadmapDoc } from '../../roadmaps/entities/roadmap.schema';
import { escapeRegex } from '../search-query.util';

describe('buildRoadmapItemSearchFilter', () => {
  it('lọc theo tenant và regex trên itemsSearchText (chọn ứng viên qua index)', () => {
    const f = buildRoadmapItemSearchFilter('t1', 'dang nhap');
    expect(f.tenantId).toBe('t1');
    expect((f.itemsSearchText as RegExp).source).toContain('dang nhap');
  });

  it('escape ký tự regex', () => {
    const f = buildRoadmapItemSearchFilter('t1', 'a(b');
    expect((f.itemsSearchText as RegExp).source).toContain('\\(');
  });
});

const item = (overrides: Partial<RoadmapItemData> = {}): RoadmapItemData =>
  ({
    id: 'item-1',
    shortId: 'RM-AAA',
    title: 'Improve login flow',
    description: '',
    phase: 'now',
    ...overrides,
  }) as RoadmapItemData;

describe('itemMatchesQuery', () => {
  const re = (q: string) => new RegExp(escapeRegex(q), 'i');

  it('khớp theo title, kể cả khi title có dấu và query không dấu (buildSearchText chuẩn hoá cả hai)', () => {
    expect(itemMatchesQuery(item({ title: 'Đăng nhập lỗi' }), re('dang nhap'))).toBe(true);
  });

  it('khớp theo shortId', () => {
    expect(itemMatchesQuery(item({ shortId: 'RM-6HCUHKX' }), /6hcuhkx/i)).toBe(true);
  });

  it('không khớp khi cả title lẫn shortId đều không chứa query', () => {
    expect(itemMatchesQuery(item({ title: 'Checkout redesign', shortId: 'RM-ZZZ' }), /login/i)).toBe(
      false,
    );
  });
});

describe('mapRoadmapItemToHit', () => {
  const board = (overrides: Partial<RoadmapDoc> = {}): RoadmapDoc =>
    ({
      _id: 'board-1',
      title: 'Q1 Roadmap',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      ...overrides,
    }) as RoadmapDoc;

  it('subtitle là tên roadmap, không phải tên item', () => {
    const hit = mapRoadmapItemToHit(item(), board({ title: 'Q2 Roadmap' }));
    expect(hit.subtitle).toBe('Q2 Roadmap');
  });

  it('url ưu tiên shortId, rơi về id khi thiếu shortId', () => {
    const withShortId = mapRoadmapItemToHit(
      item({ shortId: 'RM-6HCUHKX', id: 'uuid-1' }),
      board({ _id: 'board-9' }),
    );
    expect(withShortId.url).toBe('/roadmaps/board-9/items/RM-6HCUHKX');

    const withoutShortId = mapRoadmapItemToHit(
      item({ shortId: undefined, id: 'uuid-2' }),
      board({ _id: 'board-9' }),
    );
    expect(withoutShortId.url).toBe('/roadmaps/board-9/items/uuid-2');
  });

  it('id của hit là id của item, không phải id của board', () => {
    const hit = mapRoadmapItemToHit(item({ id: 'item-42' }), board({ _id: 'board-1' }));
    expect(hit.id).toBe('item-42');
  });

  /**
   * Đây là ca quan trọng nhất của loại "nhúng": một roadmap có HAI item cùng
   * khớp phải trả về HAI hit riêng biệt, mỗi hit gắn đúng id/shortId của
   * chính item đó — không phải cả hai cùng trỏ về item đầu tiên (lỗi lệch vị
   * trí nếu implementation đọc `itemsSearchText[i]` theo chỉ số thay vì khớp
   * lại trên object item thật).
   */
  it('hai item của cùng một board cùng khớp → hai hit riêng biệt, đúng id mỗi cái', () => {
    const b = board({ _id: 'board-1', title: 'Q1 Roadmap' });
    const itemA = item({ id: 'item-A', shortId: 'RM-AAA', title: 'Login redesign' });
    const itemB = item({ id: 'item-B', shortId: 'RM-BBB', title: 'Login rate limiting' });
    const re = /login/i;

    const matched = [itemA, itemB].filter((i) => itemMatchesQuery(i, re));
    expect(matched).toHaveLength(2);

    const hits = matched.map((i) => mapRoadmapItemToHit(i, b));
    expect(hits).toHaveLength(2);
    expect(hits[0].id).toBe('item-A');
    expect(hits[0].ref).toBe('RM-AAA');
    expect(hits[0].url).toBe('/roadmaps/board-1/items/RM-AAA');
    expect(hits[1].id).toBe('item-B');
    expect(hits[1].ref).toBe('RM-BBB');
    expect(hits[1].url).toBe('/roadmaps/board-1/items/RM-BBB');
  });
});
