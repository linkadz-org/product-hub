import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchHit, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { IssueDoc } from '../../issues/entities/issue.schema';
import { exactRefSearch } from '../../issues/repositories/issue.repository';
import { clampSearchLimit, escapeRegex, EXACT_MATCH_SCORE } from '../search-query.util';

// No `i` flag: `normalizeSearchText` already lowercases both sides.
export function buildIssueSearchFilter(tenantId: string, q: string): FilterQuery<IssueDoc> {
  return { tenantId, searchText: new RegExp(escapeRegex(q)) };
}

/**
 * Chuyển một `IssueDoc` phẳng thành `SearchHit`. Tách riêng khỏi `search()` vì
 * đây là logic nghiệp vụ duy nhất riêng của loại issue trong file này (mọi
 * thứ khác đã chuyển sang `search-query.util.ts` dùng chung) — và vì
 * `exactRef` boost là lý do Gap G1 bắt dùng lại `exactRefSearch`, nó cần được
 * test độc lập với Mongo.
 */
export function mapIssueRowToHit(row: IssueDoc, exactRef: string | null): SearchHit {
  return {
    id: row._id,
    ref: row.shortId ?? '',
    title: row.title,
    subtitle: row.status ?? '',
    url: `/issues/${row.shortId || row._id}`,
    icon: row.kind === 'bug' ? 'bug' : 'tasks',
    score: exactRef && row.shortId === exactRef ? EXACT_MATCH_SCORE : 0,
    updatedAt: row.updatedAt,
  };
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
      items: rows.map((r) => mapIssueRowToHit(r, exactRef)),
    };
  }
}
