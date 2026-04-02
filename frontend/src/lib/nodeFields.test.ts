import { describe, expect, it } from 'vitest';

import { readNodeCollapsedField, readNodePositionFields, sanitizeNodeProperties } from '@/lib/nodeFields';

describe('nodeFields', () => {
  it('prefers canonical x/y and only falls back to legacy properties when missing', () => {
    expect(readNodePositionFields({
      x: 120.5,
      y: 240.25,
      properties: {
        x: 1,
        y: 2,
      },
    })).toEqual({ x: 120.5, y: 240.25 });

    expect(readNodePositionFields({
      properties: {
        x: 12,
        y: 34,
      },
    })).toEqual({ x: 12, y: 34 });
  });

  it('prefers canonical collapsed and falls back to legacy properties for compatibility', () => {
    expect(readNodeCollapsedField({
      collapsed: false,
      properties: {
        collapsed: true,
      },
    })).toBe(false);

    expect(readNodeCollapsedField({
      properties: {
        collapsed: true,
      },
    })).toBe(true);
  });

  it('strips reserved legacy keys from properties payload', () => {
    expect(sanitizeNodeProperties({
      x: 1,
      y: 2,
      collapsed: true,
      color: 'blue',
      shape: 'pill',
    })).toEqual({
      color: 'blue',
      shape: 'pill',
    });
  });
});
