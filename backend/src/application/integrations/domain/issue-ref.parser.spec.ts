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

  it('matches a ref whatever case the developer typed it in', () => {
    // Requiring upper case was tried and reversed. A spurious match costs one
    // lookup that finds nothing; a lower-case ref that never matches silently
    // drops the link — the expensive half of the trade, and the failure this
    // feature exists to prevent.
    expect(refs('tsk-6hcuhkx done')).toEqual(['TSK-6HCUHKX']);
    expect(refs('TSK-6hcuhkx done')).toEqual(['TSK-6HCUHKX']);
    expect(refs('closes eng-14')).toEqual(['ENG-14']);
    expect(refs('feature/bug-3-retry')).toEqual(['BUG-3']);
  });

  it('canonicalises the matched ref to upper case', () => {
    expect(refs('TSK-6HCUHKX done')).toEqual(['TSK-6HCUHKX']);
    // Case-insensitive matching must not leak into what is stored or looked up.
    expect(refs('eng-14 and ENG-14')).toEqual(['ENG-14']);
  });

  it('classifies a lower-case backlog ref as a roadmap item', () => {
    // The subject split reads the *canonical* prefix, so it survives the flag.
    expect(parseRefs('groundwork for rm-4')).toEqual([
      { ref: 'RM-4', subjectType: CodeLinkSubject.ROADMAP_ITEM },
    ]);
  });

  it('finds a ref in a branch name, including a slashed one', () => {
    // The trailing slug (`fix-login`) also matches now that case is ignored —
    // it is shaped exactly like a ref and no rule can tell them apart. It costs a
    // lookup that finds nothing; what matters is that the real ref is in the list.
    expect(refs('feature/TSK-6HCUHKX-fix-login')).toContain('TSK-6HCUHKX');
  });

  it('finds a ref followed by an underscore, which \\b would refuse', () => {
    expect(refs('TSK-6HCUHKX_v2')).toEqual(['TSK-6HCUHKX']);
  });

  it('accepts legacy sequential refs, with or without the hyphen', () => {
    expect(refs('BUG-12 and TSK7 both fixed')).toEqual(['BUG-12', 'TSK-7']);
  });

  it('keeps every digit of a no-hyphen legacy ref with the number, not the prefix', () => {
    // A shared prefix class would greedily eat the first digits — `TSK42` read as
    // prefix `TSK4`, issue 2 — producing a confidently wrong ref that resolves to
    // nothing. Sequential ids past 9 are the norm, so this is the common case.
    expect(refs('fixed TSK42 today')).toEqual(['TSK-42']);
    expect(refs('TSK12')).toEqual(['TSK-12']);
    expect(refs('closes BUG1234')).toEqual(['BUG-1234']);
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
    // One commit must produce one link, not two.
    const found = refs('TSK-6HCUHKX fix login', 'TSK-6HCUHKX-fix-login');
    expect(found.filter((r) => r === 'TSK-6HCUHKX')).toEqual(['TSK-6HCUHKX']);
  });

  it('does not read a ref out of an ordinary word', () => {
    // The no-hyphen branch needs a digit run, so no plain word can reach it —
    // this holds in either case.
    expect(refs('bugfixes for the tasks page')).toEqual([]);
    expect(refs('BUGFIXES landed')).toEqual([]);
  });

  it('reads a glued-on prefix as a prefix of its own, not as the ref inside it', () => {
    // `mytsk-7` used to match nothing. Case-insensitively `MYTSK` is a perfectly
    // legal 5-character team prefix, so it now parses as `MYTSK-7` — a lookup that
    // finds nothing. What must never happen is it resolving to the real `TSK-7`:
    // the lookbehind still refuses to start matching mid-word.
    expect(refs('mytsk-7 is not a ref')).toEqual(['MYTSK-7']);
    expect(refs('mytsk-7 is not a ref')).not.toContain('TSK-7');
  });

  it('keeps the no-hyphen branch narrow even case-insensitively', () => {
    // The two-branch shape is what stops `TSK42` being read as prefix `TSK4`,
    // issue 2. Opening the flag must not merge the branches.
    expect(refs('fixed tsk42 today')).toEqual(['TSK-42']);
    expect(refs('closes bug1234')).toEqual(['BUG-1234']);
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

  it('accepts that an ordinary hyphenated word can look like a ref', () => {
    // `well-known`, `UTF-8`, `ISO-8601`: with prefixes minted at runtime there is
    // no way to exclude these without also excluding real team refs. Each costs
    // one lookup that resolves to nothing and links nothing — invisible, unlike a
    // dropped link.
    expect(refs('this is a well-known problem')).toEqual(['WELL-KNOWN']);
    expect(refs('encode as UTF-8')).toEqual(['UTF-8']);
  });

  it('ignores an empty or missing text', () => {
    expect(refs(undefined, '')).toEqual([]);
  });
});
