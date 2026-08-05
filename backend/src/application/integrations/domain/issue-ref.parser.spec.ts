import { parseRefs } from './issue-ref.parser';
import { CodeLinkSubject } from './github.types';

/** Just the refs, for the cases where the subject type isn't what's under test. */
const refs = (...texts: (string | undefined)[]): string[] =>
  parseRefs(...texts).map((r) => r.ref);

describe('parseRefs', () => {
  it('finds a current-format ref in a commit message', () => {
    expect(refs('TSK-6HCUHKX fix the login redirect')).toEqual(['TSK-6HCUHKX']);
  });

  it('finds a ref anywhere in the message, not just at the start', () => {
    expect(refs('fix the login redirect (BUG-WHHY3ZV)')).toEqual(['BUG-WHHY3ZV']);
  });

  it('reads refs out of the message body, not only the subject line', () => {
    expect(refs('fix login redirect\n\nFixes TSK-6HCUHKX')).toEqual(['TSK-6HCUHKX']);
  });

  it('is case-insensitive and canonicalises to upper case', () => {
    expect(refs('tsk-6hcuhkx done')).toEqual(['TSK-6HCUHKX']);
  });

  it('finds a ref in a branch name, including a slashed one', () => {
    expect(refs('feature/TSK-6HCUHKX-fix-login')).toEqual(['TSK-6HCUHKX']);
  });

  it('finds a ref followed by an underscore, which \\b would refuse', () => {
    expect(refs('TSK-6HCUHKX_v2')).toEqual(['TSK-6HCUHKX']);
  });

  it('accepts legacy sequential refs, with or without the hyphen', () => {
    expect(refs('BUG-12 and TSK7 both fixed')).toEqual(['BUG-12', 'TSK-7']);
  });

  it('accepts a backlog item ref and names it as one', () => {
    expect(parseRefs('RM-4KQP2XZ groundwork')).toEqual([
      { ref: 'RM-4KQP2XZ', subjectType: CodeLinkSubject.ROADMAP_ITEM },
    ]);
  });

  it('tells issue refs apart from backlog item refs in one message', () => {
    expect(parseRefs('TSK-6HCUHKX towards RM-4KQP2XZ')).toEqual([
      { ref: 'TSK-6HCUHKX', subjectType: CodeLinkSubject.ISSUE },
      { ref: 'RM-4KQP2XZ', subjectType: CodeLinkSubject.ROADMAP_ITEM },
    ]);
  });

  it('returns each ref once even when several texts mention it', () => {
    // The everyday case: a branch named for the issue, and a message naming it too.
    expect(refs('TSK-6HCUHKX fix login', 'TSK-6HCUHKX-fix-login')).toEqual(['TSK-6HCUHKX']);
  });

  it('does not read a ref out of an ordinary word', () => {
    expect(refs('bugfixes for the tasks page')).toEqual([]);
  });

  it('does not match a prefix glued to the end of another word', () => {
    expect(refs('mytsk-7 is not a ref')).toEqual([]);
  });

  it('ignores an empty or missing text', () => {
    expect(refs(undefined, '')).toEqual([]);
  });
});
