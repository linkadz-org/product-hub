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

  it('requires upper case, because the prefix is no longer a fixed list', () => {
    // This used to match case-insensitively. Once the prefix opened up to any
    // upper-case run — team prefixes are minted at runtime — the `i` flag would
    // have read `well-known` as the ref `WELL-KNOWN`. Refs are stored and shown
    // upper-case, so requiring upper case is the trade we take.
    expect(refs('tsk-6hcuhkx done')).toEqual([]);
    expect(refs('TSK-6hcuhkx done')).toEqual([]);
  });

  it('canonicalises the matched ref to upper case', () => {
    expect(refs('TSK-6HCUHKX done')).toEqual(['TSK-6HCUHKX']);
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

  it('matches a team-scoped ref minted after this code shipped', () => {
    // Team prefixes are created at runtime, so the parser cannot hold a fixed
    // list. A ref that resolves to nothing costs one lookup; a ref that never
    // matches silently drops the link the developer was trying to make.
    expect(refs('ship the redesign (ENG-14)')).toEqual(['ENG-14']);
    expect(refs('fix WEB2-7 and QC-103')).toEqual(['WEB2-7', 'QC-103']);
  });

  it('still classifies RM as a roadmap item and everything else as an issue', () => {
    const parsed = parseRefs('RM-4 blocks ENG-9');
    expect(parsed).toEqual([
      { ref: 'RM-4', subjectType: CodeLinkSubject.ROADMAP_ITEM },
      { ref: 'ENG-9', subjectType: CodeLinkSubject.ISSUE },
    ]);
  });

  it('does not treat an ordinary hyphenated word as a ref', () => {
    expect(refs('this is a well-known problem')).toEqual([]);
    expect(refs('BUGFIXES landed')).toEqual([]);
  });

  it('ignores an empty or missing text', () => {
    expect(refs(undefined, '')).toEqual([]);
  });
});
