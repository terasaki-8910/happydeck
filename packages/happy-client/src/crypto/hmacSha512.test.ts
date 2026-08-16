import { describe, expect, it } from 'vitest';
import { hmacSha512 } from './hmacSha512';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'hex'));
}

describe('hmacSha512', () => {
  // RFC 4231 Test Case 1
  it('matches RFC 4231 test case 1', () => {
    const key = new Uint8Array(20).fill(0x0b);
    const data = new TextEncoder().encode('Hi There');
    expect(hex(hmacSha512(key, data))).toBe(
      '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    );
  });

  // RFC 4231 Test Case 2 ("Jefe"/"what do ya want for nothing?")
  it('matches RFC 4231 test case 2', () => {
    const key = new TextEncoder().encode('Jefe');
    const data = new TextEncoder().encode('what do ya want for nothing?');
    expect(hex(hmacSha512(key, data))).toBe(
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    );
  });

  it('is sensitive to the key (used as the HD-tree separator)', () => {
    const data = new TextEncoder().encode('same message');
    const a = hmacSha512(fromHex('00'), data);
    const b = hmacSha512(fromHex('01'), data);
    expect(hex(a)).not.toBe(hex(b));
  });
});
