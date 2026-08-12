import { Logger } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { reportSearchTextBackfillHazard } from './mongoose.module';

function fakeConnection(countDocuments: jest.Mock): Connection {
  return {
    models: {
      Issue: { countDocuments: () => ({ exec: countDocuments }) },
    },
  } as unknown as Connection;
}

describe('reportSearchTextBackfillHazard', () => {
  it('không log error khi không có issue nào thiếu searchText', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await reportSearchTextBackfillHazard(fakeConnection(jest.fn().mockResolvedValue(0)));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('log error kèm số lượng và tên script backfill khi có issue thiếu searchText', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await reportSearchTextBackfillHazard(fakeConnection(jest.fn().mockResolvedValue(42)));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('backfill-search-text'));
    errorSpy.mockRestore();
  });

  it('bỏ qua an toàn khi connection không có model Issue đăng ký (vd. process khác)', async () => {
    const conn = { models: {} } as unknown as Connection;
    await expect(reportSearchTextBackfillHazard(conn)).resolves.toBeUndefined();
  });
});
