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
    expect(r.longText).toBe(false);
  });

  it('renders long text as edited, with no values', () => {
    const r = describeEntry({ ...base, field: 'description', oldValue: '', newValue: '' } as never);
    expect(r.longText).toBe(true);
    expect(r.from).toBe('');
    expect(r.to).toBe('');
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
});
