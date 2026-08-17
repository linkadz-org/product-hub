import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchHit, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { DocDoc } from '../../docs/entities/doc.schema';
import { clampSearchLimit, escapeRegex } from '../search-query.util';

// No `i` flag: `normalizeSearchText` already lowercases both sides.
export function buildDocSearchFilter(tenantId: string, q: string): FilterQuery<DocDoc> {
  return { tenantId, searchText: new RegExp(escapeRegex(q)) };
}

export function mapDocRowToHit(row: DocDoc): SearchHit {
  return {
    id: row._id,
    ref: row.ref ?? '',
    title: row.title,
    subtitle: '',
    url: `/docs/${row._id}`,
    icon: 'docs',
    score: 0,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DocSearchRepository implements ISearchableRepository {
  readonly type = SearchType.DOC;

  constructor(@InjectModel('Doc') private readonly model: Model<DocDoc>) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const filter = buildDocSearchFilter(tenantId, q);
    const clampedLimit = clampSearchLimit(limit);
    const [rows, total] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).limit(clampedLimit).lean<DocDoc[]>().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      type: this.type,
      total,
      items: rows.map(mapDocRowToHit),
    };
  }
}
