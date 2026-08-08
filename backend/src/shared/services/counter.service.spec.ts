import { CounterService, CounterDoc } from './counter.service';

/** Minimal in-memory stand-in for the Mongoose model the service injects. */
function fakeModel(store: Record<string, number>, calls: { find: unknown[] } = { find: [] }) {
  return {
    find: (filter: unknown) => {
      calls.find.push(filter);
      const ids = (filter as { _id: { $in: string[] } })._id.$in;
      return {
        lean: () => ({
          exec: async (): Promise<CounterDoc[]> =>
            ids.filter((id) => id in store).map((id) => ({ _id: id, seq: store[id] })),
        }),
      };
    },
    findById: (id: string) => ({
      lean: () => ({
        exec: async (): Promise<CounterDoc | null> =>
          id in store ? { _id: id, seq: store[id] } : null,
      }),
    }),
    findByIdAndUpdate: (id: string) => ({
      lean: () => ({
        exec: async (): Promise<CounterDoc> => {
          store[id] = (store[id] ?? 0) + 1;
          return { _id: id, seq: store[id] };
        },
      }),
    }),
  };
}

describe('CounterService.current', () => {
  it('returns 0 for a sequence that was never drawn from', async () => {
    const service = new CounterService(fakeModel({}) as never);
    await expect(service.current('t1', 'ENG')).resolves.toBe(0);
  });

  it('returns the current value without consuming a number', async () => {
    const store = { 't1:ENG': 4 };
    const service = new CounterService(fakeModel(store) as never);

    await expect(service.current('t1', 'ENG')).resolves.toBe(4);
    await expect(service.current('t1', 'ENG')).resolves.toBe(4);
    expect(store['t1:ENG']).toBe(4);
  });

  it('is scoped per tenant and per prefix', async () => {
    const service = new CounterService(fakeModel({ 't1:ENG': 9 }) as never);

    await expect(service.current('t2', 'ENG')).resolves.toBe(0);
    await expect(service.current('t1', 'QC')).resolves.toBe(0);
  });
});

describe('CounterService.currentMany', () => {
  it('reads every prefix in a single query, keyed by prefix', async () => {
    const calls = { find: [] as unknown[] };
    const service = new CounterService(
      fakeModel({ 't1:ENG': 4, 't1:QC': 1 }, calls) as never,
    );

    const seqs = await service.currentMany('t1', ['ENG', 'QC']);

    expect(seqs.get('ENG')).toBe(4);
    expect(seqs.get('QC')).toBe(1);
    expect(calls.find).toEqual([{ _id: { $in: ['t1:ENG', 't1:QC'] } }]);
  });

  it('reads a prefix with no counter document as 0', async () => {
    // Same answer `current()` gives, so the two paths can never disagree about
    // whether a prefix is frozen.
    const service = new CounterService(fakeModel({ 't1:ENG': 4 }) as never);
    const seqs = await service.currentMany('t1', ['ENG', 'NEW']);
    expect(seqs.get('NEW')).toBe(0);
  });

  it('collapses duplicate prefixes into one key', async () => {
    const calls = { find: [] as unknown[] };
    const service = new CounterService(fakeModel({ 't1:ENG': 7 }, calls) as never);

    const seqs = await service.currentMany('t1', ['ENG', 'ENG', 'ENG']);

    expect(seqs.get('ENG')).toBe(7);
    expect(calls.find).toEqual([{ _id: { $in: ['t1:ENG'] } }]);
  });

  it('drops falsy prefixes rather than querying the meaningless "<tenantId>:" key', async () => {
    const calls = { find: [] as unknown[] };
    const service = new CounterService(fakeModel({ 't1:ENG': 2 }, calls) as never);

    const seqs = await service.currentMany('t1', ['', 'ENG']);

    expect(seqs.has('')).toBe(false);
    expect(calls.find).toEqual([{ _id: { $in: ['t1:ENG'] } }]);
  });

  it('does not query at all for an empty (or wholly empty) list', async () => {
    const calls = { find: [] as unknown[] };
    const service = new CounterService(fakeModel({}, calls) as never);

    await expect(service.currentMany('t1', [])).resolves.toEqual(new Map());
    await expect(service.currentMany('t1', ['', ''])).resolves.toEqual(new Map());
    expect(calls.find).toHaveLength(0);
  });

  it('is scoped to the tenant it was given', async () => {
    const service = new CounterService(fakeModel({ 't1:ENG': 9 }) as never);
    const seqs = await service.currentMany('t2', ['ENG']);
    expect(seqs.get('ENG')).toBe(0);
  });

  it('splits the id back into a prefix even when the prefix contains a dash', async () => {
    // Ids are `<tenantId>:<prefix>` — the split is on the tenant length, not on a
    // last-separator search, so nothing in the prefix can confuse it.
    const service = new CounterService(fakeModel({ 't-1:EN-G': 3 }) as never);
    const seqs = await service.currentMany('t-1', ['EN-G']);
    expect(seqs.get('EN-G')).toBe(3);
  });
});
