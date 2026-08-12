import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchHit, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { RoadmapItemData } from '@application/roadmaps/domain/types/roadmap-item.type';
import { buildSearchText } from '@module-shared/utils/search-text.util';
import { RoadmapDoc } from '../../roadmaps/entities/roadmap.schema';
import { boundedCandidateLimit, clampSearchLimit, escapeRegex } from '../search-query.util';

/**
 * Roadmap item không phải document riêng — nó nằm trong mảng `items` của
 * roadmap. `itemsSearchText` (chỉ mục được) chỉ nói *document* nào khớp, không
 * nói *item nào trong đó*, nên filter này chỉ dùng để chọn ứng viên qua index;
 * việc xác định item nào khớp thật sự nằm ở `itemMatchesQuery` bên dưới, chạy
 * trong bộ nhớ trên chính `board.items` (không phải trên `itemsSearchText` —
 * hai mảng đó chỉ đồng bộ theo vị trí, dựa vào vị trí là nguồn lỗi lệch item).
 */
// `normalizeSearchText` lowercases both sides already — see the same note in
// report-search.repository.ts.
export function buildRoadmapItemSearchFilter(tenantId: string, q: string): FilterQuery<RoadmapDoc> {
  return { tenantId, itemsSearchText: new RegExp(escapeRegex(q)) };
}

/** Khớp lại trên chính object item (tái tạo `itemsSearchText[i]` từ `item`
 *  thay vì đọc `itemsSearchText[i]` theo chỉ số) — nhờ vậy mỗi hit luôn gắn
 *  đúng `id`/`shortId` của item vừa khớp, kể cả khi nhiều item trong cùng
 *  roadmap cùng khớp. */
export function itemMatchesQuery(item: RoadmapItemData, re: RegExp): boolean {
  return re.test(buildSearchText(item.title, item.shortId));
}

export function mapRoadmapItemToHit(item: RoadmapItemData, board: RoadmapDoc): SearchHit {
  return {
    id: item.id,
    ref: item.shortId ?? '',
    title: item.title,
    subtitle: board.title,
    url: `/roadmaps/${board._id}/items/${item.shortId || item.id}`,
    icon: 'roadmap',
    score: 0,
    updatedAt: board.updatedAt,
  };
}

@Injectable()
export class RoadmapItemSearchRepository implements ISearchableRepository {
  readonly type = SearchType.ROADMAP_ITEM;

  constructor(@InjectModel('Roadmap') private readonly model: Model<RoadmapDoc>) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const re = new RegExp(escapeRegex(q));
    const clampedLimit = clampSearchLimit(limit);

    // `items` (the field the post-filter actually needs) can't be projected
    // away, but `description`/`columns`/`publicToken` never touch
    // `itemMatchesQuery`/`mapRoadmapItemToHit`, so drop them from the wire.
    const boards = await this.model
      .find(buildRoadmapItemSearchFilter(tenantId, q), { description: 0, columns: 0, publicToken: 0 })
      .limit(boundedCandidateLimit(clampedLimit))
      .lean<RoadmapDoc[]>()
      .exec();

    const hits = boards.flatMap((board) =>
      board.items.filter((i) => itemMatchesQuery(i, re)).map((i) => mapRoadmapItemToHit(i, board)),
    );

    return {
      type: this.type,
      total: hits.length,
      items: hits.slice(0, clampedLimit),
    };
  }
}
