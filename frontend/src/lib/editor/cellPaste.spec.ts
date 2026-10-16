import { describe, expect, it } from 'vitest';
import { bindCellPaste, cellPasteHtml } from './cellPaste';

/** A clipboard holding exactly these types. */
function clipboard(types: Record<string, string>): DataTransfer {
  return {
    getData: (type: string) => types[type] ?? '',
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
}

describe('cellPasteHtml — plain text', () => {
  it('keeps every line in the cell, one <br> apart', () => {
    expect(cellPasteHtml(clipboard({ 'text/plain': 'one\ntwo\r\nthree\n' }))).toBe(
      'one<br>two<br>three',
    );
  });

  it('keeps a blank line the author left in', () => {
    expect(cellPasteHtml(clipboard({ 'text/plain': 'a\n\nb' }))).toBe('a<br><br>b');
  });

  it('escapes markup in text', () => {
    expect(cellPasteHtml(clipboard({ 'text/plain': '<b>x</b> & y' }))).toBe(
      '&lt;b&gt;x&lt;/b&gt; &amp; y',
    );
  });

  it('reads marked lines as the cell’s own list', () => {
    expect(cellPasteHtml(clipboard({ 'text/plain': 'Intro\n- Fix QCs\n- Research\nAfter' }))).toBe(
      'Intro<ul class="rte-list"><li>Fix QCs</li><li>Research</li></ul>After',
    );
    expect(cellPasteHtml(clipboard({ 'text/plain': '1. a\n2) b' }))).toBe(
      '<ol class="rte-list"><li>a</li><li>b</li></ol>',
    );
  });
});

describe('cellPasteHtml — rich text', () => {
  it('turns paragraphs into lines, with no leading or doubled breaks', () => {
    const html = '<meta charset="utf-8"><p>one</p>\n<p>two</p><div>three<br></div><div>four</div>';
    expect(cellPasteHtml(clipboard({ 'text/html': html }))).toBe('one<br>two<br>three<br>four');
  });

  it('keeps an empty paragraph as a blank line', () => {
    const html = '<p>a</p><p><br></p><p>b</p>';
    expect(cellPasteHtml(clipboard({ 'text/html': html }))).toBe('a<br><br>b');
  });

  it('keeps lists, with Google Docs’ paragraphs inside items flattened', () => {
    const html = '<ul><li><p>Fix QCs</p></li><li><p>Receive <b>handover</b></p></li></ul>';
    expect(cellPasteHtml(clipboard({ 'text/html': html }))).toBe(
      '<ul class="rte-list"><li>Fix QCs</li><li>Receive <b>handover</b></li></ul>',
    );
  });

  it('ignores Google Docs’ whole-clipboard <b style="font-weight:normal">', () => {
    const html =
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p><span>plain</span> <span style="font-weight:700">bold</span></p></b>';
    expect(cellPasteHtml(clipboard({ 'text/html': html }))).toBe('plain <b>bold</b>');
  });

  it('drops anything a cell may not hold, and unsafe links', () => {
    const html =
      '<p>a<script>alert(1)</script><img src="x" onerror="1"><a href="javascript:alert(1)">b</a> <a href="https://x.dev" onclick="1">c</a></p>';
    expect(cellPasteHtml(clipboard({ 'text/html': html }))).toBe(
      'ab <a href="https://x.dev">c</a>',
    );
  });

  it('keeps mention chips copied from another cell', () => {
    const html = '<span class="rte-mention" data-user-id="u1">@Felix</span> hi';
    expect(cellPasteHtml(clipboard({ 'text/html': html }))).toBe(
      '<span class="rte-mention" data-user-id="u1">@Felix</span> hi',
    );
  });

  it('falls back to plain text when the HTML says nothing', () => {
    expect(
      cellPasteHtml(clipboard({ 'text/html': '<img src="x">', 'text/plain': 'line 1\nline 2' })),
    ).toBe('line 1<br>line 2');
  });
});

describe('bindCellPaste', () => {
  function table() {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="tc-row"><div class="tc-cell" contenteditable="true">ab</div></div>';
    const holder = document.createElement('div');
    holder.appendChild(wrap);
    document.body.appendChild(holder);
    const cell = wrap.querySelector<HTMLElement>('.tc-cell')!;
    return { holder, wrap, cell };
  }

  function caretIn(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function paste(target: HTMLElement, text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: clipboard({ 'text/plain': text }) });
    target.dispatchEvent(event);
    return event;
  }

  it('puts a multi-line paste in the cell, at the caret, and keeps it from Editor.js', () => {
    const { holder, wrap, cell } = table();
    let changes = 0;
    let editorSaw = false;
    holder.addEventListener('paste', () => (editorSaw = true));
    bindCellPaste(wrap, { onChange: () => changes++ });
    caretIn(cell.firstChild!, 1);

    const event = paste(cell, 'x\ny');

    expect(cell.innerHTML).toBe('ax<br>yb');
    expect(event.defaultPrevented).toBe(true);
    expect(editorSaw).toBe(false);
    expect(changes).toBe(1);
    holder.remove();
  });

  it('continues a list the caret is already in, instead of nesting one', () => {
    const { holder, wrap, cell } = table();
    cell.innerHTML = '<ul class="rte-list"><li>first</li></ul>';
    bindCellPaste(wrap, { onChange: () => {} });
    caretIn(cell.querySelector('li')!.firstChild!, 5);

    paste(cell, '- second\n- third');

    expect(cell.innerHTML).toBe('<ul class="rte-list"><li>firstsecond</li><li>third</li></ul>');
    holder.remove();
  });

  it('leaves a paste outside any cell alone', () => {
    const { holder, wrap } = table();
    const outside = document.createElement('p');
    outside.textContent = 'x';
    wrap.appendChild(outside);
    bindCellPaste(wrap, { onChange: () => {} });
    caretIn(outside.firstChild!, 0);

    expect(paste(outside, 'a\nb').defaultPrevented).toBe(false);
    holder.remove();
  });
});
