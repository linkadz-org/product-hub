import { pageOf, paginate } from './mcp-paging';

/**
 * Trả lời dài không bị cắt bớt nữa mà chia trang: ghép lại các trang phải ra
 * đúng nguyên văn, và mỗi trang nằm trong giới hạn.
 */
describe('paginate', () => {
  it('ngắn thì một trang, giữ nguyên', () => {
    expect(paginate('abc', 10)).toEqual(['abc']);
  });

  it('chia giữa các dòng, ghép lại ra nguyên văn, mỗi trang không vượt giới hạn', () => {
    const body = Array.from({ length: 50 }, (_, i) => `dòng ${i}`).join('\n');
    const pages = paginate(body, 40);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.length <= 40)).toBe(true);
    expect(pages.join('\n')).toBe(body);
  });

  it('một dòng dài hơn cả trang thì bị chia theo độ dài, không mất ký tự nào', () => {
    const line = 'x'.repeat(95);
    const pages = paginate(`đầu\n${line}\ncuối`, 40);
    expect(pages.every((p) => p.length <= 40)).toBe(true);
    expect(pages.join('')).toContain('x'.repeat(40));
    expect(pages.join('').replace(/\n/g, '').length).toBe('đầu'.length + 95 + 'cuối'.length);
  });
});

describe('pageOf', () => {
  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');

  it('trả lời một trang thì không thêm chân trang', () => {
    expect(pageOf('short', 'get_issue')).toBe('short');
  });

  it('trang đầu chỉ cách lấy trang sau', () => {
    expect(pageOf(body, 'get_issue', 1, 50)).toMatch(
      /Page 1 of \d+\. Call get_issue again with page: 2 for the rest\./,
    );
  });

  it('trang cuối ghi (end)', () => {
    const n = paginate(body, 50).length;
    expect(pageOf(body, 'get_issue', n, 50)).toContain(`Page ${n} of ${n} (end)`);
  });

  it('trang không tồn tại thì nói rõ có bao nhiêu trang', () => {
    expect(pageOf('short', 'get_issue', 3)).toBe('There is no page 3 — this reply has 1 page(s).');
  });
});
