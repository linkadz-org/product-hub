import { describe, expect, it } from 'vitest';
import { resizeColumnPx } from './ResizableTableTool';

const opts = { fit: 600, max: 3000, min: 30 };

describe('resizeColumnPx', () => {
  it('widening a column grows the table instead of squeezing its neighbour', () => {
    expect(resizeColumnPx([100, 300, 200], 2, 250, opts)).toEqual([100, 300, 450]);
    expect(resizeColumnPx([100, 300, 200], 0, 50, opts)).toEqual([150, 300, 200]);
  });

  it('narrowing a wide table shrinks it, down to the page', () => {
    expect(resizeColumnPx([100, 300, 450], 2, -100, opts)).toEqual([100, 300, 350]);
    // Past the page edge the next column takes up the slack.
    expect(resizeColumnPx([100, 300, 200], 0, -40, opts)).toEqual([60, 340, 200]);
    // The last column has no next one, so the column before it grows.
    expect(resizeColumnPx([100, 300, 200], 2, -50, opts)).toEqual([100, 350, 150]);
  });

  it('never goes under the minimum or over the maximum', () => {
    expect(resizeColumnPx([100, 300, 200], 0, -500, opts)[0]).toBe(30);
    expect(resizeColumnPx([100, 300, 200], 2, 10_000, opts)).toEqual([100, 300, 2600]);
  });
});
