import { TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { RelationType } from '@application/issue-links/domain/relation-type.enum';
import {
  anyTeamChoices,
  hierarchyRole,
  RELATION_TYPE_CHOICES,
  resolveRelationType,
  resolveTeamAnyKind,
} from './mcp-resolve';

const team = (id: string, name: string, issueType: TeamIssueType, archived = false) =>
  ({ id: { toString: () => id }, name, key: name.toLowerCase(), issueType, archived }) as never;

describe('resolveTeamAnyKind', () => {
  const teams = [
    team('t1', 'Engineering', TeamIssueType.TASK),
    team('t2', 'QC', TeamIssueType.BUG),
    team('t3', 'Old', TeamIssueType.TASK, true),
  ];

  it('tìm được team task', () => {
    expect(resolveTeamAnyKind(teams, 'Engineering')?.name).toBe('Engineering');
  });

  it('tìm được team bug — không cần biết trước loại', () => {
    expect(resolveTeamAnyKind(teams, 'QC')?.name).toBe('QC');
  });

  it('không khớp thì trả null, không rơi về team mặc định', () => {
    expect(resolveTeamAnyKind(teams, 'Marketing')).toBeNull();
  });

  it('ref rỗng trả null — không đoán team mặc định', () => {
    expect(resolveTeamAnyKind(teams, '')).toBeNull();
  });

  it('bỏ qua team đã lưu trữ', () => {
    expect(anyTeamChoices(teams)).toEqual(['Engineering', 'QC']);
  });
});

describe('resolveRelationType', () => {
  it('nhận các từ ngang hàng, gấp hoa/gạch/khoảng trắng về một dạng', () => {
    expect(resolveRelationType('Blocked By')).toBe(RelationType.BLOCKED_BY);
    expect(resolveRelationType('blocked_by')).toBe(RelationType.BLOCKED_BY);
    expect(resolveRelationType('duplicate')).toBe(RelationType.DUPLICATE_OF);
  });

  it('từ chối cha–con: quan hệ đó nằm ở parentId, không phải link', () => {
    expect(resolveRelationType('parent-of')).toBeNull();
    expect(resolveRelationType('sub-issue-of')).toBeNull();
  });

  it('danh sách gợi ý không còn nhắc tới cha–con', () => {
    expect(RELATION_TYPE_CHOICES).toEqual(['blocks', 'blocked-by', 'related-to', 'duplicate-of']);
  });
});

describe('hierarchyRole', () => {
  it('parent-of: đầu `from` là cha', () => {
    expect(hierarchyRole('parent-of')).toBe('parent');
    expect(hierarchyRole('Parent')).toBe('parent');
  });

  it('sub-issue-of và các biến thể: đầu `from` là con', () => {
    for (const w of ['sub-issue-of', 'sub_issue', 'subissue', 'Sub Task', 'child-of']) {
      expect(hierarchyRole(w)).toBe('child');
    }
  });

  it('từ ngang hàng hoặc rác thì không phải cha–con', () => {
    expect(hierarchyRole('blocks')).toBeNull();
    expect(hierarchyRole('xyzzy')).toBeNull();
    expect(hierarchyRole(undefined)).toBeNull();
  });
});
