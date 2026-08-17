import {
  buildReportSearchFilter,
  buildTestCaseSearchFilter,
  keepReportsOfLiveProjects,
  mapReportRowToHit,
  mapTestCaseToHit,
  matchingTestCases,
} from './report-search.repository';
import { SectionType } from '@application/reports/domain/enums/section-type.enum';
import { TestCaseData, TestingSection } from '@application/reports/domain/types/section.types';
import { TestResult } from '@application/reports/domain/enums/test-result.enum';
import { ReportDoc } from '../../reports/entities/report.schema';

describe('buildReportSearchFilter', () => {
  it('lọc theo tenant và regex trên searchText', () => {
    const f = buildReportSearchFilter('t1', 'thanh toan');
    expect(f.tenantId).toBe('t1');
    expect((f.searchText as RegExp).source).toContain('thanh toan');
  });

  it('escape ký tự regex', () => {
    expect((buildReportSearchFilter('t1', 'a(b').searchText as RegExp).source).toContain('\\(');
  });
});

describe('buildTestCaseSearchFilter', () => {
  it('lọc theo tenant và regex trên casesSearchText (khác field với report search)', () => {
    const f = buildTestCaseSearchFilter('t1', 'TC-01');
    expect(f.tenantId).toBe('t1');
    expect((f.casesSearchText as RegExp).source).toContain('TC-01');
  });

  it('escape ký tự regex', () => {
    expect((buildTestCaseSearchFilter('t1', 'a(b').casesSearchText as RegExp).source).toContain(
      '\\(',
    );
  });
});

describe('keepReportsOfLiveProjects', () => {
  it('giữ report có projectId nằm trong live set, bỏ report còn lại', () => {
    const rows = [
      { _id: 'r1', projectId: 'p1' },
      { _id: 'r2', projectId: 'p-deleted' },
    ];
    expect(keepReportsOfLiveProjects(rows, new Set(['p1'])).map((r) => r._id)).toEqual(['r1']);
  });
});

describe('mapReportRowToHit', () => {
  const baseRow = (overrides: Partial<ReportDoc> = {}): ReportDoc =>
    ({
      _id: 'report-1',
      projectId: 'proj-1',
      title: 'Checkout flow',
      module: 'Payments',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      ...overrides,
    }) as ReportDoc;

  it('url trỏ vào /testing/:projectId/reports/:id, icon là projects', () => {
    const hit = mapReportRowToHit(baseRow({ projectId: 'proj-9', _id: 'report-3' }));
    expect(hit.url).toBe('/testing/proj-9/reports/report-3');
    expect(hit.icon).toBe('projects');
  });

  it('subtitle ưu tiên module', () => {
    expect(mapReportRowToHit(baseRow({ module: 'Auth' })).subtitle).toBe('Auth');
  });
});

const testCase = (overrides: Partial<TestCaseData> = {}): TestCaseData => ({
  id: 'case-1',
  shortId: 'TC-01',
  area: 'Login',
  type: '',
  result: TestResult.UNTESTED,
  owner: '',
  ...overrides,
});

const testingSection = (cases: TestCaseData[]): TestingSection => ({
  id: 'section-1',
  type: SectionType.TESTING,
  title: 'Testing',
  coverage: [],
  cases,
});

describe('matchingTestCases', () => {
  const reportRow = (sections: ReportDoc['sections']): ReportDoc =>
    ({ _id: 'report-1', projectId: 'proj-1', title: 'Checkout', sections }) as ReportDoc;

  it('chỉ xét case trong section type TESTING, bỏ qua section khác', () => {
    const row = reportRow([
      { id: 's0', type: SectionType.OVERVIEW, title: 'Overview', paragraphs: [] },
      testingSection([testCase({ shortId: 'TC-01', area: 'Login' })]),
    ]);
    const matches = matchingTestCases(row, /login/i);
    expect(matches).toHaveLength(1);
    expect(matches[0].shortId).toBe('TC-01');
  });

  it('khớp theo shortId hoặc area', () => {
    const row = reportRow([testingSection([testCase({ shortId: 'TC-42', area: 'Checkout' })])]);
    expect(matchingTestCases(row, /tc-42/i)).toHaveLength(1);
    expect(matchingTestCases(row, /checkout/i)).toHaveLength(1);
    expect(matchingTestCases(row, /unrelated/i)).toHaveLength(0);
  });

  /**
   * Ca quan trọng nhất: một report có HAI test case cùng khớp phải trả về cả
   * hai, mỗi cái giữ đúng danh tính của chính nó — không phải chỉ case đầu
   * tiên, và không phải case B mang id của case A (lỗi lệch vị trí nếu đọc
   * `casesSearchText[i]` theo chỉ số thay vì khớp lại trên case object thật).
   */
  it('hai case trong cùng report cùng khớp → cả hai được trả về, đúng danh tính từng cái', () => {
    const caseA = testCase({ id: 'case-A', shortId: 'TC-01', area: 'Login form' });
    const caseB = testCase({ id: 'case-B', shortId: 'TC-02', area: 'Login rate limit' });
    const caseC = testCase({ id: 'case-C', shortId: 'TC-03', area: 'Checkout' });
    const row = reportRow([testingSection([caseA, caseB, caseC])]);

    const matches = matchingTestCases(row, /login/i);
    expect(matches).toHaveLength(2);
    expect(matches.map((c) => c.id)).toEqual(['case-A', 'case-B']);
    expect(matches.map((c) => c.shortId)).toEqual(['TC-01', 'TC-02']);
  });

  it('gộp case từ nhiều TESTING section trong cùng report', () => {
    const row = reportRow([
      testingSection([testCase({ id: 'case-A', shortId: 'TC-01', area: 'Login' })]),
      testingSection([testCase({ id: 'case-B', shortId: 'TC-02', area: 'Login again' })]),
    ]);
    expect(matchingTestCases(row, /login/i).map((c) => c.id)).toEqual(['case-A', 'case-B']);
  });
});

describe('mapTestCaseToHit', () => {
  const row = { _id: 'report-1', projectId: 'proj-1', title: 'Checkout flow' } as ReportDoc;

  it('url trỏ vào report kèm hash shortId của case (không phải id report suông)', () => {
    const hit = mapTestCaseToHit(testCase({ shortId: 'TC-07' }), { ...row, _id: 'report-9', projectId: 'proj-2' } as ReportDoc);
    expect(hit.url).toBe('/testing/proj-2/reports/report-9#TC-07');
  });

  it('id của hit là id của case, không phải id của report', () => {
    const hit = mapTestCaseToHit(testCase({ id: 'case-77' }), row);
    expect(hit.id).toBe('case-77');
  });

  it('subtitle là tên report, icon là checks', () => {
    const hit = mapTestCaseToHit(testCase(), { ...row, title: 'Payments' } as ReportDoc);
    expect(hit.subtitle).toBe('Payments');
    expect(hit.icon).toBe('checks');
  });

  it('title ghép shortId · area', () => {
    const hit = mapTestCaseToHit(testCase({ shortId: 'TC-01', area: 'Login' }), row);
    expect(hit.title).toBe('TC-01 · Login');
  });
});
