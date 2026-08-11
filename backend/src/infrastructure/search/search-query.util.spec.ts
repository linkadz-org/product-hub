import { clampSearchLimit, escapeRegex, SEARCH_GROUP_LIMIT_MAX } from './search-query.util';

describe('escapeRegex', () => {
  it.each([
    ['a(b', 'a\\(b'],
    ['a)b', 'a\\)b'],
    ['a[b', 'a\\[b'],
    ['a]b', 'a\\]b'],
    ['a{b', 'a\\{b'],
    ['a}b', 'a\\}b'],
    ['a.b', 'a\\.b'],
    ['a*b', 'a\\*b'],
    ['a+b', 'a\\+b'],
    ['a?b', 'a\\?b'],
    ['a^b', 'a\\^b'],
    ['a$b', 'a\\$b'],
    ['a|b', 'a\\|b'],
    ['a\\b', 'a\\\\b'],
    ['plain text', 'plain text'],
  ])('escapes %s -> %s', (input, expected) => {
    expect(escapeRegex(input)).toBe(expected);
  });

  it('không escape "/" vì nó vô hại với constructor new RegExp(string)', () => {
    expect(escapeRegex('a/b')).toBe('a/b');
  });

  it('kết quả escape luôn compile được thành RegExp hợp lệ', () => {
    const dangerous = '(.*+?^${}()|[]\\';
    expect(() => new RegExp(escapeRegex(dangerous))).not.toThrow();
  });
});

describe('clampSearchLimit', () => {
  it('kẹp giá trị vượt trần về SEARCH_GROUP_LIMIT_MAX', () => {
    expect(clampSearchLimit(999)).toBe(SEARCH_GROUP_LIMIT_MAX);
  });

  it('giữ nguyên giá trị hợp lệ trong khoảng', () => {
    expect(clampSearchLimit(5)).toBe(5);
  });

  it('mặc định về trần khi limit không hợp lệ (0, âm, NaN)', () => {
    expect(clampSearchLimit(0)).toBe(SEARCH_GROUP_LIMIT_MAX);
    expect(clampSearchLimit(-3)).toBe(SEARCH_GROUP_LIMIT_MAX);
    expect(clampSearchLimit(Number.NaN)).toBe(SEARCH_GROUP_LIMIT_MAX);
  });
});
