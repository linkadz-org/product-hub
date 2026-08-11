import { GlobalSearchUseCase } from './global-search.use-case';
import { SearchType } from '../domain/enums/search-type.enum';
import { ISearchableRepository } from '../repositories/searchable.repository';
import { SearchGroup } from '../domain/search-result.type';

const hit = (title: string, over: Partial<SearchGroup['items'][0]> = {}) => ({
  id: title,
  ref: '',
  title,
  subtitle: '',
  url: '/x',
  icon: 'tasks',
  score: 0,
  updatedAt: new Date('2020-01-01'),
  ...over,
});

const repo = (type: SearchType, items: SearchGroup['items'], delayMs = 0): ISearchableRepository => ({
  type,
  search: () =>
    new Promise((res) => setTimeout(() => res({ type, total: items.length, items }), delayMs)),
});

describe('GlobalSearchUseCase', () => {
  it('trả rỗng và KHÔNG gọi repository nào khi q ngắn hơn 2 ký tự', async () => {
    const search = jest.fn();
    const uc = new GlobalSearchUseCase([{ type: SearchType.ISSUE, search }]);
    const out = await uc.execute({ tenantId: 't1', q: 'a' });
    expect(out.groups).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('chuẩn hoá q trước khi đưa xuống repository', async () => {
    const search = jest.fn().mockResolvedValue({ type: SearchType.ISSUE, total: 0, items: [] });
    const uc = new GlobalSearchUseCase([{ type: SearchType.ISSUE, search }]);
    await uc.execute({ tenantId: 't1', q: 'Đăng Nhập' });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: 'dang nhap' }));
  });

  it('một repository lỗi không làm hỏng các nhóm khác', async () => {
    const bad: ISearchableRepository = {
      type: SearchType.DOC,
      search: () => Promise.reject(new Error('boom')),
    };
    const uc = new GlobalSearchUseCase([repo(SearchType.ISSUE, [hit('ok')]), bad]);
    const out = await uc.execute({ tenantId: 't1', q: 'ok' });
    expect(out.groups.map((g) => g.type)).toEqual([SearchType.ISSUE]);
  });

  it('repository quá chậm bị bỏ qua, phần còn lại vẫn trả về', async () => {
    const uc = new GlobalSearchUseCase(
      [repo(SearchType.ISSUE, [hit('nhanh')]), repo(SearchType.DOC, [hit('cham')], 3000)],
      50, // timeout ms, rút ngắn cho test
    );
    const out = await uc.execute({ tenantId: 't1', q: 'ab' });
    expect(out.groups.map((g) => g.type)).toEqual([SearchType.ISSUE]);
  });

  it('không đợi repository chậm — trả về trong khoảng thời gian của timeout, không phải delay của repo', async () => {
    const uc = new GlobalSearchUseCase(
      [repo(SearchType.ISSUE, [hit('nhanh')]), repo(SearchType.DOC, [hit('cham')], 3000)],
      50,
    );
    const start = Date.now();
    await uc.execute({ tenantId: 't1', q: 'ab' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('khớp đầu chuỗi xếp trên khớp giữa chuỗi', async () => {
    const uc = new GlobalSearchUseCase([
      repo(SearchType.ISSUE, [hit('sua loi dang nhap'), hit('dang nhap loi')]),
    ]);
    const out = await uc.execute({ tenantId: 't1', q: 'dang nhap' });
    expect(out.groups[0].items[0].title).toBe('dang nhap loi');
  });

  it('chỉ hỏi những loại được yêu cầu qua `types`', async () => {
    const docSearch = jest.fn();
    const uc = new GlobalSearchUseCase([
      repo(SearchType.ISSUE, [hit('a')]),
      { type: SearchType.DOC, search: docSearch },
    ]);
    await uc.execute({ tenantId: 't1', q: 'ab', types: [SearchType.ISSUE] });
    expect(docSearch).not.toHaveBeenCalled();
  });

  it('hai repository cùng type (doc + doc-page) được gộp thành một nhóm chứa cả hai kết quả', async () => {
    const uc = new GlobalSearchUseCase([
      repo(SearchType.DOC, [hit('tai lieu a')]),
      repo(SearchType.DOC, [hit('trang b')]),
    ]);
    const out = await uc.execute({ tenantId: 't1', q: 'ab' });
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].type).toBe(SearchType.DOC);
    expect(out.groups[0].total).toBe(2);
    expect(out.groups[0].items.map((i) => i.title).sort()).toEqual(['tai lieu a', 'trang b']);
  });

  it('kẹp limit về tối đa 20 sau khi gộp', async () => {
    const items = Array.from({ length: 15 }, (_, i) => hit(`item ${i}`));
    const uc = new GlobalSearchUseCase([
      repo(SearchType.ISSUE, items),
      repo(SearchType.ISSUE, items.map((h) => ({ ...h, id: h.id + '-b' }))),
    ]);
    const out = await uc.execute({ tenantId: 't1', q: 'item', limit: 100 });
    expect(out.groups[0].items.length).toBeLessThanOrEqual(20);
  });

  it('luôn truyền tenantId xuống mọi repository', async () => {
    const search = jest.fn().mockResolvedValue({ type: SearchType.ISSUE, total: 0, items: [] });
    const uc = new GlobalSearchUseCase([{ type: SearchType.ISSUE, search }]);
    await uc.execute({ tenantId: 'tenant-42', q: 'ab' });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-42' }));
  });
});
