import { describe, expect, it } from 'vitest';
import { decodeUTF8, encodeUTF8 } from './text';

describe('encodeUTF8 / decodeUTF8 direction', () => {
  it('encodeUTF8 converts a string to bytes', () => {
    const bytes = encodeUTF8('Hello, World!');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.slice(0, 5))).toEqual([72, 101, 108, 108, 111]);
  });

  it('decodeUTF8 converts bytes to a string', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(decodeUTF8(bytes)).toBe('Hello');
  });

  it('round-trips multi-byte UTF-8 (CJK + emoji)', () => {
    const text = 'Hello, 世界! 🌍';
    expect(decodeUTF8(encodeUTF8(text))).toBe(text);
  });
});
