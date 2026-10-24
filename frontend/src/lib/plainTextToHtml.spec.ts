import { describe, expect, it } from 'vitest';
import { htmlToBlocks, plainTextToHtml } from './editorjs';

/** RM item descriptions written over the API used to be stored as plain text,
 *  which the HTML renderer ran together onto one line. */
describe('plainTextToHtml', () => {
  it('turns each line into a paragraph and escapes markup characters', () => {
    expect(plainTextToHtml('Vấn đề: a < b\n\nMục tiêu')).toBe(
      '<p>Vấn đề: a &lt; b</p><p></p><p>Mục tiêu</p>',
    );
  });

  it('leaves rich HTML untouched', () => {
    const html = '<p>x</p><pre><code>y</code></pre>';
    expect(plainTextToHtml(html)).toBe(html);
  });

  it('opens a plain-text value in the editor one paragraph per line', () => {
    const texts = htmlToBlocks('Dòng 1\nDòng 2').map((b) => (b.data as { text?: string }).text);
    expect(texts).toEqual(['Dòng 1', 'Dòng 2']);
  });
});
