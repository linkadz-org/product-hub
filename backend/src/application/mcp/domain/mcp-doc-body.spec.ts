import { docBodyToHtml } from './mcp-doc-body';

/**
 * Bảng và đường kẻ ngang — hai cú pháp Markdown phổ thông mà bộ chuyển đổi
 * trước đây không nhận, nên chúng rơi xuống nhánh đoạn văn và bị gộp thành một
 * cục chữ đầy dấu `|`. Mọi báo cáo có bảng đều hỏng vì lỗi này.
 */
describe('docBodyToHtml — bảng', () => {
  it('dựng bảng có thead và tbody', () => {
    const html = docBodyToHtml(['| Chỉ số | Giá trị |', '|---|---|', '| Đã xong | 70 |'].join('\n'));
    expect(html).toBe(
      '<table><thead><tr><th>Chỉ số</th><th>Giá trị</th></tr></thead>' +
        '<tbody><tr><td>Đã xong</td><td>70</td></tr></tbody></table>',
    );
  });

  it('nhận dấu căn lề trong dòng phân cách', () => {
    const html = docBodyToHtml(['| a | b | c |', '| :--- | :---: | ---: |', '| 1 | 2 | 3 |'].join('\n'));
    expect(html).toContain('<th>a</th><th>b</th><th>c</th>');
    expect(html).toContain('<td>1</td><td>2</td><td>3</td>');
  });

  it('vẫn xử lý định dạng trong ô', () => {
    const html = docBodyToHtml(['| Tên | Ghi chú |', '|---|---|', '| **Lucas** | `code` |'].join('\n'));
    expect(html).toContain('<td><b>Lucas</b></td>');
    expect(html).toContain('<td><code>code</code></td>');
  });

  it('đệm ô rỗng cho hàng thiếu, cắt bớt hàng thừa', () => {
    const html = docBodyToHtml(
      ['| a | b | c |', '|---|---|---|', '| 1 |', '| 1 | 2 | 3 | 4 |'].join('\n'),
    );
    expect(html).toContain('<tr><td>1</td><td></td><td></td></tr>');
    expect(html).toContain('<tr><td>1</td><td>2</td><td>3</td></tr>');
    expect(html).not.toContain('<td>4</td>');
  });

  it('KHÔNG coi là bảng khi thiếu dòng phân cách', () => {
    const html = docBodyToHtml('| chỉ là chữ có dấu gạch đứng |');
    expect(html).toBe('<p>| chỉ là chữ có dấu gạch đứng |</p>');
  });

  it('bảng kết thúc ở dòng trống, đoạn sau vẫn là đoạn riêng', () => {
    const html = docBodyToHtml(['| a |', '|---|', '| 1 |', '', 'Đoạn sau.'].join('\n'));
    expect(html).toBe(
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>' +
        '<p>Đoạn sau.</p>',
    );
  });

  it('bảng ngay sau đoạn văn không bị nuốt vào đoạn đó', () => {
    const html = docBodyToHtml(['Số liệu:', '| a |', '|---|', '| 1 |'].join('\n'));
    expect(html).toMatch(/^<p>Số liệu:<\/p><table>/);
  });
});

describe('docBodyToHtml — đường kẻ ngang', () => {
  it.each(['---', '***', '___', '-----'])('chuyển %s thành <hr/>', (rule) => {
    expect(docBodyToHtml(`Trên\n\n${rule}\n\nDưới`)).toBe('<p>Trên</p><hr/><p>Dưới</p>');
  });

  it('không nhầm gạch đầu dòng thành kẻ ngang', () => {
    expect(docBodyToHtml('- một mục')).toBe('<ul><li>một mục</li></ul>');
  });

  it('kẻ ngang ngay sau đoạn văn vẫn tách ra', () => {
    expect(docBodyToHtml('Đoạn.\n---\nSau.')).toBe('<p>Đoạn.</p><hr/><p>Sau.</p>');
  });
});

describe('docBodyToHtml — không phá thứ đang chạy', () => {
  it('giữ nguyên tiêu đề, danh sách, trích dẫn', () => {
    const html = docBodyToHtml(['## Tiêu đề', '', '- một', '- hai', '', '> trích'].join('\n'));
    expect(html).toBe(
      '<h2>Tiêu đề</h2><ul><li>một</li><li>hai</li></ul><blockquote>trích</blockquote>',
    );
  });

  it('dấu gạch đứng trong khối mã không bị đọc thành bảng', () => {
    const html = docBodyToHtml(['```', '| a | b |', '|---|---|', '```'].join('\n'));
    expect(html).toContain('<pre>');
    expect(html).not.toContain('<table>');
  });

  it('HTML truyền vào vẫn giữ nguyên, không bị chuyển đổi lại', () => {
    const html = docBodyToHtml('<p>Đã là HTML</p>');
    expect(html).toBe('<p>Đã là HTML</p>');
  });
});

/**
 * Hand-pasted mermaid.
 *
 * The app stores a diagram as `<figure class="mermaid-block"><pre
 * class="mermaid-source">`, and that form is passed through untouched. What a
 * person pastes is the other form — mermaid's own `<pre class="mermaid">` — and
 * it arrives with the two things HTML always does to code: newlines as `<br/>`
 * and quotes as `&quot;`. Losing either breaks the diagram rather than the page,
 * so it comes back as an error message where the picture should be.
 */
describe('docBodyToHtml — hand-pasted mermaid', () => {
  const sourceOf = (html: string): string => {
    const match = html.match(/<pre class="mermaid-source"><code>([\s\S]*?)<\/code><\/pre>/);
    return match ? match[1] : '';
  };

  it('keeps the line breaks a <br/> stood for', () => {
    const html = docBodyToHtml('<pre class="mermaid">graph TD;<br/>A--&gt;B<br/>B--&gt;C</pre>');
    // Folded onto one line the source does not parse — mermaid is line-oriented.
    expect(sourceOf(html)).toBe('graph TD;\nA--&gt;B\nB--&gt;C');
  });

  it('decodes &quot; instead of printing it', () => {
    const html = docBodyToHtml('<pre class="mermaid">graph TD;<br/>C[&quot;q&quot;]</pre>');
    const source = sourceOf(html);
    // The escape survived `unescapeHtml`, then the `&` in it was escaped again —
    // so the label rendered as the six characters `&quot;` on the diagram.
    expect(source).not.toContain('&amp;quot;');
    expect(source).toContain('C["q"]');
  });

  it('handles &apos;, &#39; and numeric references too', () => {
    const html = docBodyToHtml(
      '<pre class="mermaid">graph TD;<br/>A[&apos;x&apos;]--&gt;B[&#39;y&#39;]--&gt;C[&#x27;z&#x27;]</pre>',
    );
    expect(sourceOf(html)).toBe("graph TD;\nA['x']--&gt;B['y']--&gt;C['z']");
  });

  it('does not eat an author’s literal &quot; — &amp;quot; decodes one level only', () => {
    const html = docBodyToHtml('<pre class="mermaid">graph TD;<br/>A[&amp;quot;]</pre>');
    // They wrote the *text* `&quot;`, so that is what the diagram should show.
    expect(sourceOf(html)).toBe('graph TD;\nA[&amp;quot;]');
  });

  it('becomes the figure the editor draws from', () => {
    const html = docBodyToHtml('<pre class="mermaid">graph TD;<br/>A--&gt;B</pre>');
    expect(html).toContain('<figure class="mermaid-block">');
    expect(html).toContain('<pre class="mermaid-source"><code>');
  });

  it('leaves the app’s own storage form exactly as it is', () => {
    const stored =
      '<figure class="mermaid-block"><pre class="mermaid-source"><code>graph TD;\nA--&gt;B</code></pre></figure>';
    // A second pass must not re-promote (and so re-escape) what is already a
    // diagram — that is what read → write-back does on every edit.
    expect(docBodyToHtml(stored)).toBe(stored);
  });

  it('leaves a code block that is not mermaid alone', () => {
    const code = '<pre><code class="language-ts">const a = 1;</code></pre><p>x</p>';
    expect(docBodyToHtml(code)).toBe(code);
  });
});
