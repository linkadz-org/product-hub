import { SetTestCaseResultUseCase } from './set-test-case-result.use-case';
import { ReportEntity } from '../domain/entities/report.entity';
import { SectionType } from '../domain/enums/section-type.enum';
import { TestResult } from '../domain/enums/test-result.enum';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { AuditLogEntity } from '@application/audit-log/domain/entities/audit-log.entity';

class FakeReportRepo {
  constructor(private readonly report: ReportEntity) {}
  async findByCaseShortId() { return this.report; }
  async update() { /* no-op */ }
}

class FakeAuditRepo {
  rows: AuditLogEntity[] = [];
  async append(e: AuditLogEntity) { this.rows.push(e); }
  async appendMany(es: AuditLogEntity[]) { this.rows.push(...es); }
  async findByProject() { throw new Error('unused'); }
  async findByEntities() { throw new Error('unused'); }
}

function makeReport(caseId: string, caseShortId: string) {
  const report = ReportEntity.create({
    tenantId: 't1',
    projectId: 'p1',
    slug: 'feature-x',
    title: 'Feature X',
    sections: [
      {
        id: 's1',
        type: SectionType.TESTING,
        title: 'Testing',
        coverage: [],
        cases: [
          {
            id: caseId,
            shortId: caseShortId,
            area: 'Login',
            type: '',
            result: TestResult.UNTESTED,
            owner: '',
          },
          {
            id: 'other-case-id',
            shortId: 'OTHER-1',
            area: 'Signup',
            type: '',
            result: TestResult.UNTESTED,
            owner: '',
          },
        ],
      },
    ],
  }).getValue();
  return report;
}

describe('SetTestCaseResultUseCase', () => {
  const actor = { type: AuditActor.USER, id: 'u1', name: 'Lucas' };

  it('records the row against the case id, not the report id — matches issue.caseId', async () => {
    const report = makeReport('case-1', 'QA-CASE-1');
    const reportRepo = new FakeReportRepo(report);
    const auditRepo = new FakeAuditRepo();
    const useCase = new SetTestCaseResultUseCase(reportRepo as never, auditRepo as never);

    await useCase.execute({
      tenantId: 't1',
      projectId: 'p1',
      shortId: 'QA-CASE-1',
      result: TestResult.PASSED,
      actor,
    });

    expect(auditRepo.rows).toHaveLength(1);
    const row = auditRepo.rows[0];
    expect(row.entity).toBe(AuditEntity.TESTCASE);
    // The case's own id — this is what issue.caseId is set to when a bug is
    // linked to this case (see frontend ReportSections.tsx `caseId: c.id`).
    expect(row.entityId).toBe('case-1');
    expect(row.entityId).not.toBe(report.id.toString());
    // reportId stays populated on the row, unchanged.
    expect(row.reportId).toBe(report.id.toString());
  });
});
