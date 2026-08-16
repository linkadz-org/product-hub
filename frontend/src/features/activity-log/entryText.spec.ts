import { describe, expect, it } from 'vitest';
import { describeEntry } from './entryText';

const base = {
  id: 'a1',
  entity: 'issue',
  entityId: 'i1',
  entityRef: 'QC-10',
  actorType: 'user',
  actorId: 'u1',
  actorName: 'Felix',
  automated: false,
  createdAt: new Date().toISOString(),
  relationLabel: '',
};

describe('describeEntry', () => {
  it('renders a short field change with both values', () => {
    const r = describeEntry({ ...base, field: 'status', oldValue: 'Backlog', newValue: 'Done' } as never);
    expect(r.subject).toBe('Felix');
    expect(r.from).toBe('Backlog');
    expect(r.to).toBe('Done');
    expect(r.noValue).toBe(false);
  });

  it('renders long text as edited, with no values', () => {
    const r = describeEntry({ ...base, field: 'description', oldValue: '', newValue: '' } as never);
    expect(r.noValue).toBe(true);
    expect(r.from).toBe('');
    expect(r.to).toBe('');
    expect(r.verb).toContain('edited');
  });

  it('renders creation', () => {
    const r = describeEntry({ ...base, field: 'created', oldValue: '', newValue: '' } as never);
    expect(r.verb).toContain('created');
  });

  it('marks an empty old value as unset rather than blank', () => {
    const r = describeEntry({ ...base, field: 'assignees', oldValue: '', newValue: 'Felix' } as never);
    expect(r.from).not.toBe('');
  });

  it('never throws on a field it does not know', () => {
    const r = describeEntry({ ...base, field: 'somethingNew', oldValue: 'a', newValue: 'b' } as never);
    expect(r.subject).toBe('Felix');
  });

  // FIX 1: the subject must never carry "(API key)" — that's the badge's job
  // (ActivityEntry.tsx). Their absence here is exactly why every API-key row
  // shipped reading "qa-runner (API key) [API key]".
  it('renders a bare actor name for an API-key actor — no parenthetical', () => {
    const r = describeEntry({
      ...base,
      actorType: 'api',
      actorName: 'qa-runner',
      field: 'status',
      oldValue: 'Backlog',
      newValue: 'Done',
    } as never);
    expect(r.subject).toBe('qa-runner');
    expect(r.subject).not.toContain('API key');
  });

  it('renders the system actor label for a system actor', () => {
    const r = describeEntry({
      ...base,
      actorType: 'system',
      actorName: '',
      field: 'status',
      oldValue: 'Backlog',
      newValue: 'Done',
    } as never);
    expect(r.subject).not.toBe('');
    expect(r.subject).not.toContain('API key');
  });

  // FIX 4: raw ids with no display form read as "changed X", no arrow of ids.
  it('renders cycleId/parentId/projectId as value-less, using the "changed" verb', () => {
    for (const field of ['cycleId', 'parentId', 'projectId']) {
      const r = describeEntry({ ...base, field, oldValue: '', newValue: '' } as never);
      expect(r.noValue).toBe(true);
      expect(r.from).toBe('');
      expect(r.to).toBe('');
      expect(r.verb).toContain('changed');
    }
  });

  it('renders roadmapItemId/caseId as an ordinary value pair (already a label, not an id)', () => {
    const r = describeEntry({
      ...base,
      field: 'roadmapItemId',
      oldValue: '',
      newValue: 'Search v2',
    } as never);
    expect(r.noValue).toBe(false);
    expect(r.to).toBe('Search v2');
  });

  it('exposes the locale word order for the component to render values before or after the verb', () => {
    const r = describeEntry({ ...base, field: 'status', oldValue: 'Backlog', newValue: 'Done' } as never);
    expect(typeof r.valuesBeforeVerb).toBe('boolean');
  });
});
