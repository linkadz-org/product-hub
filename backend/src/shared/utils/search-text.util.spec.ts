import { buildSearchText, normalizeSearchText, SEARCH_BODY_MAX } from './search-text.util';

describe('normalizeSearchText', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(normalizeSearchText('Đăng nhập bằng OTP')).toBe('dang nhap bang otp');
  });

  it('xử lý đ/Đ — NFD không tách được chữ này', () => {
    expect(normalizeSearchText('Đường đi')).toBe('duong di');
  });

  it('giữ nguyên tiếng Hàn', () => {
    expect(normalizeSearchText('로그인 실패')).toBe('로그인 실패');
  });

  it('hạ chữ thường mã ref', () => {
    expect(normalizeSearchText('TSK-142')).toBe('tsk-142');
  });

  it('gộp khoảng trắng thừa', () => {
    expect(normalizeSearchText('  a   b  ')).toBe('a b');
  });

  it('chịu được đầu vào rỗng và null-ish', () => {
    expect(normalizeSearchText('')).toBe('');
    expect(normalizeSearchText(undefined as unknown as string)).toBe('');
  });

  it('không làm vỡ emoji', () => {
    expect(normalizeSearchText('Bug 🐛 nặng')).toBe('bug 🐛 nang');
  });
});

describe('buildSearchText', () => {
  it('nối các phần, bỏ phần rỗng', () => {
    expect(buildSearchText('Đăng nhập', undefined, 'TSK-142', '')).toBe('dang nhap tsk-142');
  });
});

describe('SEARCH_BODY_MAX', () => {
  it('là 5000 theo spec', () => {
    expect(SEARCH_BODY_MAX).toBe(5000);
  });
});
