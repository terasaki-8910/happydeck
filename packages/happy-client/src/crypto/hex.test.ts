import { describe, expect, it } from 'vitest';
import { encodeHex } from './hex';

describe('encodeHex', () => {
  it('encodes bytes as lowercase hex', () => {
    expect(encodeHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });

  it('matches Node Buffer hex encoding (cross-check against the Node-only path used in tests elsewhere)', () => {
    const bytes = new Uint8Array(32).map((_, i) => (i * 7) % 256);
    expect(encodeHex(bytes)).toBe(Buffer.from(bytes).toString('hex'));
  });

  it('handles the empty array', () => {
    expect(encodeHex(new Uint8Array([]))).toBe('');
  });
});
