import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchHit, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { ProjectDoc } from '../../projects/entities/project.schema';
import { clampSearchLimit, escapeRegex } from '../search-query.util';

/**
 * Loại trừ (Gap G3): project đã xoá mềm không bao giờ được trả về — `deletedAt`
 * luôn bị ép về `null` trong filter, không phải là tham số người dùng có thể
 * đổi. Xuất riêng hàm này (thay vì gói trong `search()`) để `exclusions.spec.ts`
 * kiểm được rule mà không cần Mongo.
 */
export function activeProjectFilter(tenantId: string, q: string): FilterQuery<ProjectDoc> {
  return {
    tenantId,
    // Xoá mềm: không bao giờ trả về.
    deletedAt: null,
    // No `i` flag: `normalizeSearchText` already lowercases both sides.
    searchText: new RegExp(escapeRegex(q)),
  };
}

export function mapProjectRowToHit(row: ProjectDoc): SearchHit {
  return {
    id: row._id,
    ref: '',
    title: row.title,
    subtitle: row.subtitle ?? '',
    url: `/testing/${row._id}`,
    icon: 'projects',
    score: 0,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class ProjectSearchRepository implements ISearchableRepository {
  readonly type = SearchType.PROJECT;

  constructor(@InjectModel('Project') private readonly model: Model<ProjectDoc>) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const filter = activeProjectFilter(tenantId, q);
    const clampedLimit = clampSearchLimit(limit);
    const [rows, total] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).limit(clampedLimit).lean<ProjectDoc[]>().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      type: this.type,
      total,
      items: rows.map(mapProjectRowToHit),
    };
  }
}
