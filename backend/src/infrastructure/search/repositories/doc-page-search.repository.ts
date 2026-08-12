import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchHit, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { DocPageDoc } from '../../docs/entities/doc-page.schema';
import { clampSearchLimit, escapeRegex } from '../search-query.util';

/** Một trang khớp nếu tiêu đề (`searchText`) HOẶC nội dung (`searchBody`) chứa
 *  chuỗi tìm — người dùng thường nhớ nội dung, không phải tiêu đề trang. */
export function buildDocPageFilter(tenantId: string, q: string): FilterQuery<DocPageDoc> {
  // No `i` flag: `normalizeSearchText` already lowercases both the stored
  // field and the query, so it's a no-op for matching and only costs index
  // eligibility.
  const re = new RegExp(escapeRegex(q));
  return { tenantId, $or: [{ searchText: re }, { searchBody: re }] };
}

/** Trang doc hiện trong cùng nhóm `SearchType.DOC` với chính doc — frontend
 *  không cần biết đây là trang con hay doc gốc, chỉ URL khác nhau. */
export function mapDocPageRowToHit(row: DocPageDoc): SearchHit {
  return {
    id: row._id,
    ref: '',
    title: row.title,
    subtitle: '',
    url: `/docs/${row.docId}/${row._id}`,
    icon: 'docs',
    score: 0,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DocPageSearchRepository implements ISearchableRepository {
  readonly type = SearchType.DOC;

  constructor(@InjectModel('DocPage') private readonly model: Model<DocPageDoc>) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const filter = buildDocPageFilter(tenantId, q);
    const clampedLimit = clampSearchLimit(limit);
    const [rows, total] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).limit(clampedLimit).lean<DocPageDoc[]>().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      type: this.type,
      total,
      items: rows.map(mapDocPageRowToHit),
    };
  }
}
