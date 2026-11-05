import { Result } from '@shared/logic/result';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { AuditActor } from '@application/audit-log/domain/enums/audit.enums';
import {
  RoadmapDifficulty,
  RoadmapItemStatus,
} from '@application/roadmaps/domain/enums/roadmap.enums';
import type { RoadmapItemData } from '@application/roadmaps/domain/types/roadmap-item.type';
import {
  McpAddBacklogItemCommentUseCase,
  McpCreateBacklogItemUseCase,
  McpDeleteBacklogItemUseCase,
  McpGetBacklogItemUseCase,
  McpUpdateBacklogItemUseCase,
  type McpActor,
} from './mcp.use-cases';

/**
 * RM item qua MCP. Lỗi gốc: description được lưu nguyên văn chữ trơn trong khi
 * trang chi tiết vẽ HTML, nên mọi dấu xuống dòng biến mất; và không có tool nào
 * đọc được description của một item.
 */

const actor: McpActor = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope: ApiKeyScope.READ_WRITE,
  clientName: 'claude-code/1.0',
};

const item = (over: Partial<RoadmapItemData> = {}): RoadmapItemData => ({
  id: 'item-1',
  shortId: 'RM-88',
  title: 'Onboarding',
  description: 'Dòng 1\nDòng 2',
  phase: 'now',
  status: RoadmapItemStatus.IDEA,
  difficulty: RoadmapDifficulty.MEDIUM,
  reach: 3,
  impact: 3,
  confidence: 3,
  effort: 3,
  progress: 0,
  imageUrl: '',
  startDate: '',
  endDate: '',
  assignees: [],
  milestoneId: '',
  objectiveId: '',
  keyResultId: '',
  okrLabel: '',
  ...over,
});

const roadmap = (items: RoadmapItemData[]) => ({
  id: { toString: () => 'rm-1' },
  title: 'Product',
  columns: [],
  items,
});

const deps = (items = [item(), item({ id: 'item-2', shortId: 'RM-89', title: 'Other' })]) => {
  const map = roadmap(items);
  const getRoadmaps = { execute: jest.fn().mockResolvedValue(Result.ok([map])) };
  const replaceItems = {
    execute: jest.fn().mockImplementation(({ dto }) =>
      Promise.resolve(Result.ok(roadmap(dto.items))),
    ),
  };
  const addItem = {
    execute: jest.fn().mockImplementation(({ item: added }) =>
      Promise.resolve(Result.ok({ roadmap: map, item: { ...item(), ...added } })),
    ),
  };
  const person = (id: string, name: string, email: string) => ({
    id: { toString: () => id },
    name,
    email,
  });
  const users = {
    findById: jest.fn().mockResolvedValue({ name: 'Ada' }),
    findByTenant: jest.fn().mockResolvedValue({
      data: [person('u1', 'Ada Lovelace', 'ada@e.com'), person('u2', 'Lucas Tran', 'lucas@e.com')],
    }),
  };
  const events = { append: jest.fn().mockResolvedValue(undefined) };
  return { getRoadmaps, replaceItems, addItem, users, events };
};

/** `GetIssuesUseCase` serving `issues` in batches, the way the repository pages. */
const issuesOf = (issues: Record<string, unknown>[]) => ({
  execute: jest.fn().mockImplementation(({ query }) => {
    const start = (query.page - 1) * query.limit;
    return Promise.resolve(
      Result.ok({ data: issues.slice(start, start + query.limit), total: issues.length }),
    );
  }),
});

const ticket = (n: number) => ({
  id: { toString: () => `issue-${n}` },
  shortId: `TSK-${n}`,
  title: `Ticket ${n}`,
  kind: 'task',
  status: 'todo',
  priority: 'medium',
  teamId: 'team-1',
  assignees: [],
  labels: [],
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

describe('McpGetBacklogItemUseCase', () => {
  const build = (d: ReturnType<typeof deps>, issues = issuesOf([]), comments: unknown[] = []) =>
    new McpGetBacklogItemUseCase(
      d.getRoadmaps as never,
      issues as never,
      { execute: jest.fn().mockResolvedValue(Result.ok([{ id: { toString: () => 'team-1' }, name: 'Core' }])) } as never,
      { execute: jest.fn().mockResolvedValue(Result.ok(comments)) } as never,
    );

  it('đọc một item theo ref, kèm description và nhãn cột', async () => {
    const d = deps();
    const result = await build(d).execute({
      actor,
      dto: { item: 'RM-88' },
    });
    expect(result.isSuccess).toBe(true);
    expect(result.getValue()).toMatchObject({
      shortId: 'RM-88',
      description: 'Dòng 1\nDòng 2',
      phaseLabel: 'Now',
      riceScore: 9,
    });
  });

  it('ref không tồn tại thì báo lỗi rõ ràng', async () => {
    const d = deps();
    const result = await build(d).execute({
      actor,
      dto: { item: 'RM-404' },
    });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('RM-404');
  });

  it('trả về TẤT CẢ ticket con — không cắt ở 20 hay 500', async () => {
    const d = deps();
    const issues = issuesOf(Array.from({ length: 1203 }, (_, i) => ticket(i + 1)));
    const result = await build(d, issues).execute({ actor, dto: { item: 'RM-88' } });
    expect(result.getValue().tickets).toHaveLength(1203);
    expect(result.getValue().tickets[1202]).toMatchObject({ shortId: 'TSK-1203', teamName: 'Core' });
    expect(issues.execute.mock.calls[0][0].query.roadmapItemId).toEqual(['item-1']);
  });

  it('kèm toàn bộ comment, đọc nguyên văn', async () => {
    const d = deps();
    const long = 'y'.repeat(4000);
    const comment = {
      id: { toString: () => 'c1' },
      authorName: 'Ada',
      body: `<p>${long}</p><img src="https://cdn.e.com/x.png">`,
      parentId: '',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const result = await build(d, issuesOf([]), [comment]).execute({ actor, dto: { item: 'RM-88' } });
    expect(result.getValue().comments[0].body).toBe(`${long}\n\n[image: https://cdn.e.com/x.png]`);
  });
});

describe('McpUpdateBacklogItemUseCase', () => {
  const run = (d: ReturnType<typeof deps>, dto: Record<string, unknown>) =>
    new McpUpdateBacklogItemUseCase(
      d.getRoadmaps as never,
      d.replaceItems as never,
      d.users as never,
      d.events as never,
    ).execute({ actor, dto: { item: 'RM-88', ...dto } });

  it('description được chuyển sang HTML, giữ xuống dòng', async () => {
    const d = deps();
    const result = await run(d, { description: 'Vấn đề: chậm\nMục tiêu: nhanh' });
    expect(result.isSuccess).toBe(true);
    expect(result.getValue().description).toBe('<p>Vấn đề: chậm<br>Mục tiêu: nhanh</p>');
  });

  it('chỉ sửa đúng item đó, các item khác giữ nguyên; ghi lịch sử là API', async () => {
    const d = deps();
    await run(d, { title: 'Onboarding v2' });
    const call = d.replaceItems.execute.mock.calls[0][0];
    expect(call.actorType).toBe(AuditActor.API);
    expect(call.dto.items.map((i: RoadmapItemData) => i.title)).toEqual(['Onboarding v2', 'Other']);
    expect(d.events.append).toHaveBeenCalledTimes(1);
  });

  it('ảnh được nối vào description và thành ảnh bìa', async () => {
    const d = deps();
    const result = await run(d, { images: ['https://cdn.e.com/a.png'] });
    expect(result.getValue().description).toBe(
      'Dòng 1\nDòng 2<img src="https://cdn.e.com/a.png" alt="">',
    );
    expect(result.getValue().imageUrl).toBe('https://cdn.e.com/a.png');
  });

  it('cột nhận theo nhãn; nhãn sai thì gợi ý các cột hợp lệ', async () => {
    const d = deps();
    expect((await run(d, { phase: 'Next' })).getValue().phase).toBe('next');
    const bad = await run(deps(), { phase: 'Someday' });
    expect(bad.isFailure).toBe(true);
    expect(bad.error).toContain('Now');
  });

  it('gán người phụ trách theo tên/email — THAY cả danh sách', async () => {
    const d = deps([item({ assignees: [{ id: 'u9', name: 'Old' }] })]);
    const result = await run(d, { assignee: 'Ada Lovelace, lucas@e.com' });
    expect(result.isSuccess).toBe(true);
    expect(d.replaceItems.execute.mock.calls[0][0].dto.items[0].assignees).toEqual([
      { id: 'u1', name: 'Ada Lovelace' },
      { id: 'u2', name: 'Lucas Tran' },
    ]);
  });

  it('assignee "" xoá hết người phụ trách', async () => {
    const d = deps([item({ assignees: [{ id: 'u9', name: 'Old' }] })]);
    await run(d, { assignee: '' });
    expect(d.replaceItems.execute.mock.calls[0][0].dto.items[0].assignees).toEqual([]);
  });

  it('tên người không tồn tại thì báo lỗi kèm gợi ý, không ghi DB', async () => {
    const d = deps();
    const result = await run(d, { assignee: 'Nobody' });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Lucas Tran');
    expect(d.replaceItems.execute).not.toHaveBeenCalled();
  });

  it('không truyền gì để sửa thì từ chối, không ghi DB', async () => {
    const d = deps();
    const result = await run(d, {});
    expect(result.isFailure).toBe(true);
    expect(d.replaceItems.execute).not.toHaveBeenCalled();
  });
});

describe('McpCreateBacklogItemUseCase — description', () => {
  it('lưu description dạng HTML và lấy ảnh đầu tiên làm ảnh bìa', async () => {
    const d = deps();
    await new McpCreateBacklogItemUseCase(
      d.getRoadmaps as never,
      d.addItem as never,
      d.users as never,
      d.events as never,
    ).execute({
      actor,
      dto: {
        title: 'Mới',
        description: 'Dòng 1\nDòng 2\n\n![chụp](https://cdn.e.com/s.png)',
      },
    });
    expect(d.addItem.execute.mock.calls[0][0].item).toMatchObject({
      description: '<p>Dòng 1<br>Dòng 2</p><img src="https://cdn.e.com/s.png" alt="chụp">',
      imageUrl: 'https://cdn.e.com/s.png',
    });
  });
});

describe('McpCreateBacklogItemUseCase — assignee', () => {
  it('gán người phụ trách ngay lúc tạo', async () => {
    const d = deps();
    await new McpCreateBacklogItemUseCase(
      d.getRoadmaps as never,
      d.addItem as never,
      d.users as never,
      d.events as never,
    ).execute({ actor, dto: { title: 'Mới', assignee: 'Lucas' } });
    expect(d.addItem.execute.mock.calls[0][0].item.assignees).toEqual([
      { id: 'u2', name: 'Lucas Tran' },
    ]);
  });
});

describe('McpDeleteBacklogItemUseCase', () => {
  const build = (d: ReturnType<typeof deps>, issues = issuesOf([])) =>
    new McpDeleteBacklogItemUseCase(
      d.getRoadmaps as never,
      d.replaceItems as never,
      issues as never,
      d.users as never,
      d.events as never,
    );

  it('xoá đúng item đó, giữ các item khác, ghi lịch sử là API', async () => {
    const d = deps();
    const result = await build(d).execute({ actor, dto: { item: 'RM-88' } });
    expect(result.getValue()).toMatchObject({ shortId: 'RM-88', roadmapTitle: 'Product' });
    const call = d.replaceItems.execute.mock.calls[0][0];
    expect(call.actorType).toBe(AuditActor.API);
    expect(call.dto.items.map((i: RoadmapItemData) => i.shortId)).toEqual(['RM-89']);
    expect(d.events.append).toHaveBeenCalledTimes(1);
  });

  it('còn ticket bên trong thì từ chối, liệt kê ticket, không ghi DB', async () => {
    const d = deps();
    const result = await build(d, issuesOf([ticket(7)])).execute({ actor, dto: { item: 'RM-88' } });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('TSK-7');
    expect(d.replaceItems.execute).not.toHaveBeenCalled();
  });
});

describe('McpAddBacklogItemCommentUseCase', () => {
  it('comment lên RM: Markdown → HTML, mention theo tên, trả về link của item', async () => {
    const d = deps();
    const createComment = {
      execute: jest.fn().mockImplementation(({ dto }) =>
        Promise.resolve(
          Result.ok({ id: { toString: () => 'c1' }, authorName: 'Ada', body: dto.body, parentId: '' }),
        ),
      ),
    };
    const result = await new McpAddBacklogItemCommentUseCase(
      d.getRoadmaps as never,
      createComment as never,
      d.users as never,
      d.events as never,
    ).execute({
      actor,
      dto: { item: 'RM-88', body: 'Dòng 1\nDòng 2', mentions: ['Lucas'], images: ['https://e.com/a.mp4'] },
    });
    expect(result.isSuccess).toBe(true);
    const call = createComment.execute.mock.calls[0][0];
    expect(call).toMatchObject({ roadmapId: 'rm-1', itemId: 'item-1', authorId: 'u1' });
    expect(call.dto).toMatchObject({
      body: '<p>Dòng 1<br>Dòng 2</p>',
      mentions: ['u2'],
      images: ['https://e.com/a.mp4'],
    });
    expect(result.getValue()).toMatchObject({ itemShortId: 'RM-88', body: 'Dòng 1\nDòng 2' });
    expect(d.events.append).toHaveBeenCalledTimes(1);
  });
});
