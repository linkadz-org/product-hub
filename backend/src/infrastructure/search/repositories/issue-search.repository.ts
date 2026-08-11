import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { IssueDoc } from '../../issues/entities/issue.schema';
import { exactRefSearch } from '../../issues/repositories/issue.repository';

/** Trần cứng cho mỗi nhóm kết quả — không tin `SearchQuery.limit` vì kiểu của
 *  nó không ràng buộc giá trị này (xem Task 7). */
export const SEARCH_GROUP_LIMIT_MAX = 20;

/** Kẹp `limit` người dùng/caller truyền vào trong khoảng hợp lệ. */
export function clampSearchLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return SEARCH_GROUP_LIMIT_MAX;
  return Math.min(limit, SEARCH_GROUP_LIMIT_MAX);
}

/** Escape để chuỗi tự do từ ô tìm kiếm không làm vỡ regex (`(`, `[`, `*`…). */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildIssueSearchFilter(tenantId: string, q: string): FilterQuery<IssueDoc> {
  return { tenantId, searchText: new RegExp(escapeRegex(q), 'i') };
}

@Injectable()
export class IssueSearchRepository implements ISearchableRepository {
  readonly type = SearchType.ISSUE;

  constructor(@InjectModel('Issue') private readonly model: Model<IssueDoc>) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const filter = buildIssueSearchFilter(tenantId, q);
    const clampedLimit = clampSearchLimit(limit);
    const [rows, total] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).limit(clampedLimit).lean<IssueDoc[]>().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    // exactRefSearch nhận chuỗi thô người dùng gõ và trả mã ref viết hoa nếu nó
    // *là* một ref. `q` ở đây đã chuẩn hoá (viết thường) nên hàm vẫn nhận ra.
    const exactRef = exactRefSearch(q);

    return {
      type: this.type,
      total,
      items: rows.map((r) => ({
        id: r._id,
        ref: r.shortId ?? '',
        title: r.title,
        subtitle: r.status ?? '',
        url: `/issues/${r.shortId || r._id}`,
        icon: r.kind === 'bug' ? 'bug' : 'tasks',
        score: exactRef && r.shortId === exactRef ? 1000 : 0,
        updatedAt: r.updatedAt,
      })),
    };
  }
}
