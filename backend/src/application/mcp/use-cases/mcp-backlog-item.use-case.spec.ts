import { Result } from '@shared/logic/result';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { AuditActor } from '@application/audit-log/domain/enums/audit.enums';
import {
  RoadmapDifficulty,
  RoadmapItemStatus,
} from '@application/roadmaps/domain/enums/roadmap.enums';
import type { RoadmapItemData } from '@application/roadmaps/domain/types/roadmap-item.type';
import {
  McpCreateBacklogItemUseCase,
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
  const users = { findById: jest.fn().mockResolvedValue({ name: 'Ada' }) };
  const events = { append: jest.fn().mockResolvedValue(undefined) };
  return { getRoadmaps, replaceItems, addItem, users, events };
};

describe('McpGetBacklogItemUseCase', () => {
  it('đọc một item theo ref, kèm description và nhãn cột', async () => {
    const d = deps();
    const result = await new McpGetBacklogItemUseCase(d.getRoadmaps as never).execute({
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
    const result = await new McpGetBacklogItemUseCase(d.getRoadmaps as never).execute({
      actor,
      dto: { item: 'RM-404' },
    });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('RM-404');
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
