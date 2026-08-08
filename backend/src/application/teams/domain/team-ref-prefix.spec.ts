import {
  RESERVED_REF_PREFIXES,
  REF_PREFIX_INVALID,
  REF_PREFIX_RESERVED,
  deriveRefPrefix,
  validateRefPrefix,
} from './team-ref-prefix';

describe('validateRefPrefix', () => {
  it('accepts a plain 2-6 character prefix', () => {
    expect(validateRefPrefix('ENG')).toBeNull();
    expect(validateRefPrefix('QC')).toBeNull();
    expect(validateRefPrefix('WEB2')).toBeNull();
    expect(validateRefPrefix('ABCDEF')).toBeNull();
  });

  it('rejects the wrong length', () => {
    expect(validateRefPrefix('E')).toBe(REF_PREFIX_INVALID);
    expect(validateRefPrefix('ABCDEFG')).toBe(REF_PREFIX_INVALID);
    expect(validateRefPrefix('')).toBe(REF_PREFIX_INVALID);
  });

  it('rejects lowercase, punctuation and a leading digit', () => {
    expect(validateRefPrefix('eng')).toBe(REF_PREFIX_INVALID);
    expect(validateRefPrefix('EN-G')).toBe(REF_PREFIX_INVALID);
    expect(validateRefPrefix('2ND')).toBe(REF_PREFIX_INVALID);
  });

  it('rejects the prefixes owned by the workspace-wide sequences', () => {
    // These share CounterService's `<tenantId>:<prefix>` key with the doc,
    // roadmap-item and personal-task counters — a team using one would mint
    // refs that duplicate theirs.
    expect(RESERVED_REF_PREFIXES).toEqual(
      expect.arrayContaining(['DOC', 'RM', 'TSK', 'BUG']),
    );
    for (const reserved of RESERVED_REF_PREFIXES) {
      expect(validateRefPrefix(reserved)).toBe(REF_PREFIX_RESERVED);
    }
  });
});

describe('deriveRefPrefix', () => {
  it('takes the first three letters of the name, uppercased', () => {
    expect(deriveRefPrefix('Engineering', new Set())).toBe('ENG');
    expect(deriveRefPrefix('Product Design', new Set())).toBe('PRO');
  });

  it('keeps a short name whole', () => {
    expect(deriveRefPrefix('QC', new Set())).toBe('QC');
  });

  it('pads a one-letter name to the two-character minimum', () => {
    expect(deriveRefPrefix('X', new Set())).toBe('XT');
  });

  it('appends a digit when the derived prefix is taken', () => {
    expect(deriveRefPrefix('Engineering', new Set(['ENG']))).toBe('ENG2');
    expect(deriveRefPrefix('Engineering', new Set(['ENG', 'ENG2']))).toBe('ENG3');
  });

  it('never derives a reserved prefix', () => {
    // "Bug Triage" would otherwise yield BUG, which owns the personal-bug sequence.
    expect(deriveRefPrefix('Bug Triage', new Set())).toBe('BUG2');
    expect(deriveRefPrefix('Documentation', new Set())).toBe('DOC2');
  });

  it('falls back to TM for a name with no Latin letters', () => {
    expect(deriveRefPrefix('品質管理', new Set())).toBe('TM');
    expect(deriveRefPrefix('品質管理', new Set(['TM']))).toBe('TM2');
  });

  it('always returns something that passes validation', () => {
    for (const name of ['Engineering', 'QC', 'X', '品質管理', 'Bug Triage', '123']) {
      expect(validateRefPrefix(deriveRefPrefix(name, new Set()))).toBeNull();
    }
  });
});
