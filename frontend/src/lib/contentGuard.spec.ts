import { describe, expect, it } from 'vitest';
import { htmlToPlainText, replacedRatio } from './contentGuard';

describe('htmlToPlainText', () => {
  it('drops markup and normalises whitespace', () => {
    expect(htmlToPlainText('<h2>Repro</h2>\n<p>Open the <b>board</b></p>')).toBe(
      'Repro Open the board',
    );
  });

  it('decodes the entities the editor writes', () => {
    expect(htmlToPlainText('<p>Tom&nbsp;&amp;&nbsp;Jerry</p>')).toBe('Tom & Jerry');
  });
});

describe('replacedRatio', () => {
  const EN = 'Steps to reproduce the crash on the roadmap board';

  it('is 0 when nothing was written before', () => {
    expect(replacedRatio('', 'anything at all')).toBe(0);
  });

  it('is ~0 for an ordinary edit', () => {
    expect(replacedRatio(EN, `${EN} in Safari`)).toBe(0);
    expect(replacedRatio(EN, 'Steps to reproduce the crash on the roadmap page')).toBeLessThan(0.2);
  });

  it('does not count additions — a pasted section is not a rewrite', () => {
    expect(replacedRatio(EN, `${EN} ${'more text '.repeat(50)}`)).toBe(0);
  });

  it('is ~1 when the text is translated away', () => {
    expect(replacedRatio(EN, '로드맵 보드에서 충돌을 재현하는 단계')).toBeGreaterThan(0.9);
  });

  it('is 1 when the text is cleared', () => {
    expect(replacedRatio(EN, '')).toBe(1);
  });

  it('ignores case and markup differences', () => {
    expect(replacedRatio(EN, EN.toUpperCase())).toBe(0);
  });
});
