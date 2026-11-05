import { plainSnippet, plainText, readableText } from './plain-text.util';

/**
 * readableText là cách MCP đọc một comment cho assistant: phải giữ đủ nội dung và
 * hình dạng (xuống dòng, gạch đầu dòng, link, ảnh/video), không cắt bớt.
 */
describe('readableText', () => {
  it('giữ xuống dòng và tách đoạn', () => {
    expect(readableText('<p>Dòng 1<br>Dòng 2</p><p>Đoạn 2</p>')).toBe('Dòng 1\nDòng 2\nĐoạn 2');
  });

  it('danh sách đọc thành "- …"', () => {
    expect(readableText('<ul><li>một</li><li>hai</li></ul>')).toBe('- một\n- hai');
  });

  it('ảnh và video hiện thành URL', () => {
    expect(
      readableText('<p>Xem</p><img src="https://e.com/a.png" alt=""><video src="https://e.com/b.mp4" controls></video>'),
    ).toBe('Xem\n\n[image: https://e.com/a.png]\n\n[video: https://e.com/b.mp4]');
  });

  it('link giữ cả chữ và URL; chữ trùng URL thì chỉ giữ URL', () => {
    expect(readableText('<a href="https://e.com">trang</a>')).toBe('trang (https://e.com)');
    expect(readableText('<a href="https://e.com">https://e.com</a>')).toBe('https://e.com');
  });

  it('mention và entity được làm sạch', () => {
    expect(readableText('<span class="rte-mention">@Ada</span>&nbsp;a &amp;&lt;b&gt;')).toBe('@Ada a &<b>');
  });

  it('không cắt nội dung dài', () => {
    const long = 'x'.repeat(50_000);
    expect(readableText(`<p>${long}</p>`)).toBe(long);
  });

  it('rỗng trả về rỗng', () => {
    expect(readableText('')).toBe('');
  });
});

describe('plainText / plainSnippet — giữ nguyên hành vi cũ', () => {
  it('gộp thành một dòng', () => {
    expect(plainText('<p>a<br>b</p><p>c</p>')).toBe('a b c');
  });

  it('cắt và thêm dấu …', () => {
    expect(plainSnippet('<p>abcdef</p>', 3)).toBe('abc…');
  });
});
