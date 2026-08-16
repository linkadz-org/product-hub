import { buildSearchText, normalizeSearchText, SEARCH_BODY_MAX } from '@module-shared/utils/search-text.util';
import { plainText } from '@module-shared/utils/plain-text.util';

/**
 * Các test này khoá lại *hình dạng* của từng field search. Chúng cố tình không
 * dựng repository thật (cần Mongo) — chúng khoá công thức, còn việc repository
 * gọi đúng công thức được bảo đảm bằng review + e2e ở Task 12.
 */
describe('công thức field search', () => {
  it('issue: title + shortId', () => {
    expect(buildSearchText('Đăng nhập bằng OTP', 'TSK-142')).toBe('dang nhap bang otp tsk-142');
  });

  it('doc: title + tags', () => {
    expect(buildSearchText('Kiến trúc', ['auth', 'v2'].join(' '))).toBe('kien truc auth v2');
  });

  it('doc page body: bóc HTML, cắt, rồi chuẩn hoá', () => {
    const html = `<p>Đăng nhập</p><p>${'x'.repeat(SEARCH_BODY_MAX)}</p>`;
    const body = normalizeSearchText(plainText(html).slice(0, SEARCH_BODY_MAX));
    expect(body.startsWith('dang nhap')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(SEARCH_BODY_MAX);
    expect(body).not.toContain('<');
  });

  it('report case: mỗi case một phần tử, shortId + area', () => {
    const cases = [
      { shortId: 'TC-A1', area: 'Đăng nhập' },
      { shortId: 'TC-B2', area: 'Quên mật khẩu' },
    ];
    expect(cases.map((c) => buildSearchText(c.shortId, c.area))).toEqual([
      'tc-a1 dang nhap',
      'tc-b2 quen mat khau',
    ]);
  });

  it('roadmap item: mỗi item một phần tử, title + shortId', () => {
    const items = [{ title: 'Đăng nhập MXH', shortId: 'RM-6HCUHKX' }];
    expect(items.map((i) => buildSearchText(i.title, i.shortId))).toEqual([
      'dang nhap mxh rm-6hcuhkx',
    ]);
  });
});
