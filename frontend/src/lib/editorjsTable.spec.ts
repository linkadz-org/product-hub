import { describe, expect, it } from 'vitest';
import { blocksToHtml, htmlToBlocks } from './editorjs';

describe('table width round-trip', () => {
  const table = {
    type: 'table' as const,
    data: { withHeadings: false, content: [['a', 'b']], colWidths: [40, 60], tableWidth: 150 },
  };

  it('stores a widened table as the <table>’s own width, and reads it back', () => {
    const html = blocksToHtml([table]);
    expect(html).toContain('<table style="table-layout:fixed;width:150%">');
    expect(htmlToBlocks(html)[0]).toEqual(table);
  });

  it('writes a table that fits exactly as before', () => {
    const { tableWidth: _, ...data } = table.data;
    const html = blocksToHtml([{ type: 'table', data }]);
    expect(html).toContain('width:100%');
    expect(htmlToBlocks(html)[0].data).not.toHaveProperty('tableWidth');
  });
});
