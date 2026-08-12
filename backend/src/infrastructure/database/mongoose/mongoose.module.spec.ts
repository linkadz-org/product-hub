import { Logger } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { reportSearchTextBackfillHazard } from './mongoose.module';

function fakeConnection(exec: jest.Mock): Connection {
  return {
    models: {
      Issue: { countDocuments: () => ({ maxTimeMS: () => ({ exec }) }) },
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

  /**
   * Ca quan trọng nhất: đây chính là regression bản re-review bắt được. Query
   * lỗi (mất kết nối, replica-set election, collection bị khoá — đúng lúc
   * đang deploy) KHÔNG được phép làm hỏng boot. `main.ts` gọi `bootstrap()`
   * trần, không `.catch()`, nên một promise reject ở đây từng chặn
   * `app.listen()` không bao giờ chạy tới.
   */
  it('KHÔNG throw khi countDocuments reject — chỉ log lỗi rồi trả về, không chặn boot', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const exec = jest.fn().mockRejectedValue(new Error('connection lost'));
    await expect(reportSearchTextBackfillHazard(fakeConnection(exec))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to run'),
      expect.stringContaining('connection lost'),
    );
    errorSpy.mockRestore();
  });
});
