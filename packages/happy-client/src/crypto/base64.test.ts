import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64';

// Ground truth: happy-app's sources/encryption/base64.appspec.ts.

const key32 = new Uint8Array([
  25, 98, 84, 190, 50, 194, 51, 115, 197, 46, 112, 77, 155, 180, 158, 245, 129, 17, 92, 203, 118,
  244, 18, 70, 144, 34, 83, 84, 123, 21, 151, 61,
]);

describe('base64 (standard, padded)', () => {
  it('round-trips the empty array as an empty string', () => {
    expect(encodeBase64(new Uint8Array([]))).toBe('');
    expect(decodeBase64('')).toEqual(new Uint8Array([]));
  });

  it('pads a single byte', () => {
    expect(encodeBase64(new Uint8Array([72]))).toBe('SA==');
  });

  it('encodes "Hello" and "Hello, World!"', () => {
    expect(encodeBase64(new Uint8Array([72, 101, 108, 108, 111]))).toBe('SGVsbG8=');
    expect(encodeBase64(new Uint8Array([72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 33]))).toBe(
      'SGVsbG8sIFdvcmxkIQ==',
    );
  });

  it('handles every padding case', () => {
    expect(encodeBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(encodeBase64(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA==');
    expect(encodeBase64(new Uint8Array([1, 2, 3, 4, 5]))).toBe('AQIDBAU=');
  });

  it('encodes the 32-byte key vector', () => {
    expect(encodeBase64(key32)).toBe('GWJUvjLCM3PFLnBNm7Se9YERXMt29BJGkCJTVHsVlz0=');
    expect(decodeBase64('GWJUvjLCM3PFLnBNm7Se9YERXMt29BJGkCJTVHsVlz0=')).toEqual(key32);
  });

  it('handles max byte values', () => {
    expect(encodeBase64(new Uint8Array([255, 255, 255, 255]))).toBe('/////w==');
  });

  it('round-trips arbitrary binary data', () => {
    const input = new Uint8Array([0, 1, 2, 3, 252, 253, 254, 255]);
    expect(decodeBase64(encodeBase64(input))).toEqual(input);
  });
});

describe('base64url (unpadded, URL-safe)', () => {
  it('uses - and _ instead of + and /, with no padding', () => {
    expect(encodeBase64(new Uint8Array([62, 63, 62, 63]), 'base64url')).toBe('Pj8-Pw');
    expect(encodeBase64(new Uint8Array([252, 253, 254, 255]), 'base64url')).toBe('_P3-_w');
  });

  it('strips padding in every case', () => {
    expect(encodeBase64(new Uint8Array([1, 2, 3]), 'base64url')).toBe('AQID');
    expect(encodeBase64(new Uint8Array([1, 2, 3, 4]), 'base64url')).toBe('AQIDBA');
    expect(encodeBase64(new Uint8Array([1, 2, 3, 4, 5]), 'base64url')).toBe('AQIDBAU');
  });

  it('encodes the 32-byte key vector without padding', () => {
    expect(encodeBase64(key32, 'base64url')).toBe('GWJUvjLCM3PFLnBNm7Se9YERXMt29BJGkCJTVHsVlz0');
    expect(decodeBase64('GWJUvjLCM3PFLnBNm7Se9YERXMt29BJGkCJTVHsVlz0', 'base64url')).toEqual(key32);
  });

  it('round-trips and never emits +, / or =', () => {
    const input = new Uint8Array(100);
    for (let i = 0; i < input.length; i++) input[i] = (i * 37) % 256;
    const encoded = encodeBase64(input, 'base64url');
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeBase64(encoded, 'base64url')).toEqual(input);
  });
});

describe('cross-format', () => {
  it('a value encoded as base64 decodes correctly when re-encoded as base64url', () => {
    const input = new Uint8Array([251, 255]); // produces '/' in standard base64
    const std = encodeBase64(input);
    expect(std).toContain('/');
    const url = encodeBase64(input, 'base64url');
    expect(url).toContain('_');
    expect(url).not.toContain('/');
    expect(decodeBase64(std)).toEqual(input);
    expect(decodeBase64(url, 'base64url')).toEqual(input);
  });
});
