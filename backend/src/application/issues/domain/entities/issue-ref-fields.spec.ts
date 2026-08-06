import { IssueEntity } from './issue.entity';
import { IssueKind } from '../enums/issue.enums';

function issue(extra: Record<string, unknown> = {}): IssueEntity {
  const result = IssueEntity.create({
    kind: IssueKind.TASK,
    tenantId: 't1',
    title: 'A task',
    createdBy: 'u1',
    shortId: 'ENG-14',
    ...extra,
  } as never);
  expect(result.isSuccess).toBe(true);
  return result.getValue();
}

describe('IssueEntity ref sort fields', () => {
  it('reads back the prefix and number it was created with', () => {
    const it = issue({ refPrefix: 'ENG', refSeq: 14 });
    expect(it.refPrefix).toBe('ENG');
    expect(it.refSeq).toBe(14);
  });

  it('leaves both undefined on a legacy issue', () => {
    // A row created before sequential refs has neither field, and nothing in this
    // change may ever write them onto one.
    const it = issue({ shortId: 'BUG-ESP4F4T' });
    expect(it.refPrefix).toBeUndefined();
    expect(it.refSeq).toBeUndefined();
  });
});
