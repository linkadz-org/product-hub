import { computeSearchBody } from './search-body.util';
import { SEARCH_BODY_MAX } from './search-text.util';

describe('computeSearchBody', () => {
  it('bóc HTML rồi mới chuẩn hoá — không phải chuẩn hoá HTML thô', () => {
    expect(computeSearchBody('<p>Xin <b>chào</b></p>')).toBe('xin chao');
  });

  it('bỏ dấu và hạ chữ thường (đi qua normalizeSearchText)', () => {
    expect(computeSearchBody('<p>Đăng Nhập</p>')).toBe('dang nhap');
  });

  it('cắt ở SEARCH_BODY_MAX ký tự CỦA VĂN BẢN THUẦN, trước khi chuẩn hoá — không phải cắt HTML thô', () => {
    const longText = 'a'.repeat(SEARCH_BODY_MAX + 100);
    const html = `<p>${longText}</p>`;
    const body = computeSearchBody(html);
    expect(body.length).toBe(SEARCH_BODY_MAX);
  });

  it('chuỗi rỗng/không có nội dung → chuỗi rỗng', () => {
    expect(computeSearchBody('')).toBe('');
    expect(computeSearchBody('<p></p>')).toBe('');
  });
});
