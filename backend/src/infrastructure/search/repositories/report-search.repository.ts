import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchGroup, SearchHit, SearchQuery } from '@application/search/domain/search-result.type';
import { SearchType } from '@application/search/domain/enums/search-type.enum';
import { SectionType } from '@application/reports/domain/enums/section-type.enum';
import { TestCaseData, TestingSection } from '@application/reports/domain/types/section.types';
import { buildSearchText } from '@module-shared/utils/search-text.util';
import { ReportDoc } from '../../reports/entities/report.schema';
import { ProjectDoc } from '../../projects/entities/project.schema';
import { clampSearchLimit, escapeRegex } from '../search-query.util';

export function buildReportSearchFilter(tenantId: string, q: string): FilterQuery<ReportDoc> {
  return { tenantId, searchText: new RegExp(escapeRegex(q), 'i') };
}

export function buildTestCaseSearchFilter(tenantId: string, q: string): FilterQuery<ReportDoc> {
  return { tenantId, casesSearchText: new RegExp(escapeRegex(q), 'i') };
}

/**
 * Report thuộc project đã xoá mềm phải biến mất theo (spec 2.7, Gap G3). Report
 * không tự mang cờ xoá, nên phải hỏi collection projects — một truy vấn chỉ lấy
 * `_id` của project còn sống, rồi lọc trong bộ nhớ. Cả `ReportSearchRepository`
 * và `TestCaseSearchRepository` (bên dưới) đều gọi hàm này trước khi map hit.
 */
export function keepReportsOfLiveProjects<T extends { projectId: string }>(
  rows: T[],
  liveProjectIds: Set<string>,
): T[] {
  return rows.filter((r) => liveProjectIds.has(r.projectId));
}

export function mapReportRowToHit(row: ReportDoc): SearchHit {
  return {
    id: row._id,
    ref: '',
    title: row.title,
    subtitle: row.module || row.subtitle || '',
    url: `/testing/${row.projectId}/reports/${row._id}`,
    icon: 'projects',
    score: 0,
    updatedAt: row.updatedAt,
  };
}

/**
 * `casesSearchText` (chỉ mục được) chỉ nói report nào khớp, không nói case
 * nào. Khớp lại trên chính object case — tái tạo `buildSearchText(c.shortId,
 * c.area)` giống hệt cách `ReportRepository.toDocument()` tính `casesSearchText`
 * — thay vì đọc mảng song song theo chỉ số, nên hai case cùng khớp trong một
 * report vẫn trả về đúng hai hit, mỗi hit gắn đúng `id`/`shortId` của chính nó.
 */
export function matchingTestCases(row: ReportDoc, re: RegExp): TestCaseData[] {
  return (row.sections ?? [])
    .filter((s): s is TestingSection => s.type === SectionType.TESTING)
    .flatMap((s) => s.cases)
    .filter((c) => re.test(buildSearchText(c.shortId, c.area)));
}

/** Nhãn hiển thị của một test case — cùng công thức với `caseLabelOf` trong
 *  `ReportSections.tsx` (không có field "title" trên `TestCaseData`, đây là
 *  quy ước hiển thị đã có sẵn trong codebase). */
export function mapTestCaseToHit(testCase: TestCaseData, row: ReportDoc): SearchHit {
  const title = [testCase.shortId, testCase.area].filter(Boolean).join(' · ') || testCase.shortId || 'Test case';
  return {
    id: testCase.id,
    ref: testCase.shortId ?? '',
    title,
    subtitle: row.title,
    url: `/testing/${row.projectId}/reports/${row._id}#${testCase.shortId}`,
    icon: 'checks',
    score: 0,
    updatedAt: row.updatedAt,
  };
}

async function findLiveProjectIds(tenantId: string, projects: Model<ProjectDoc>): Promise<Set<string>> {
  const live = await projects
    .find({ tenantId, deletedAt: null }, { _id: 1 })
    .lean<{ _id: string }[]>()
    .exec();
  return new Set(live.map((p) => p._id));
}

@Injectable()
export class ReportSearchRepository implements ISearchableRepository {
  readonly type = SearchType.REPORT;

  constructor(
    @InjectModel('Report') private readonly model: Model<ReportDoc>,
    @InjectModel('Project') private readonly projects: Model<ProjectDoc>,
  ) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const filter = buildReportSearchFilter(tenantId, q);
    const clampedLimit = clampSearchLimit(limit);

    const [found, liveProjectIds] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).lean<ReportDoc[]>().exec(),
      findLiveProjectIds(tenantId, this.projects),
    ]);
    const rows = keepReportsOfLiveProjects(found, liveProjectIds);

    return {
      type: this.type,
      total: rows.length,
      items: rows.slice(0, clampedLimit).map(mapReportRowToHit),
    };
  }
}

@Injectable()
export class TestCaseSearchRepository implements ISearchableRepository {
  readonly type = SearchType.TESTCASE;

  constructor(
    @InjectModel('Report') private readonly model: Model<ReportDoc>,
    @InjectModel('Project') private readonly projects: Model<ProjectDoc>,
  ) {}

  async search({ tenantId, q, limit }: SearchQuery): Promise<SearchGroup> {
    const re = new RegExp(escapeRegex(q), 'i');
    const filter = buildTestCaseSearchFilter(tenantId, q);
    const clampedLimit = clampSearchLimit(limit);

    const [found, liveProjectIds] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).lean<ReportDoc[]>().exec(),
      findLiveProjectIds(tenantId, this.projects),
    ]);
    const rows = keepReportsOfLiveProjects(found, liveProjectIds);

    const hits = rows.flatMap((row) => matchingTestCases(row, re).map((c) => mapTestCaseToHit(c, row)));

    return {
      type: this.type,
      total: hits.length,
      items: hits.slice(0, clampedLimit),
    };
  }
}
