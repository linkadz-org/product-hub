import { CounterService, CounterDoc } from './counter.service';

/** Minimal in-memory stand-in for the Mongoose model the service injects. */
function fakeModel(store: Record<string, number>) {
  return {
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
