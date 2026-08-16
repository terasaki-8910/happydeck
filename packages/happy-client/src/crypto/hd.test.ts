import { describe, expect, it } from 'vitest';
import { deriveKey, deriveSecretKeyTreeChild, deriveSecretKeyTreeRoot } from './hd';

// Ground truth: happy-app's sources/encryption/deriveKey.appspec.ts.
// If this file ever fails, our HD key derivation has diverged from Happy's
// and nothing downstream (content keypair, session keys, blob keys) will be
// able to talk to the real relay.

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

const seed = new TextEncoder().encode('test seed');
const usage = 'test usage';
const path = ['child1', 'child2'];

const expected = {
  rootKey: 'E6E55652456F9FE47D6FF46CA3614E85B499F77E7B340FBBB1553307CEDC1E74',
  rootChainCode: '81ECFD529E8EF95DD5C06CFE169158CF02B7C09A33746C527B4BD4D740B9CC5A',
  childKey: 'D5EAE039FB9143E9433BB1ADC104C2FF5D7FA6751E680B4B1CBC7ADF1AF65BF3',
  childChainCode: '8AA339189BAB38B51DD8770B1498682BCB03E42240E273041ACC7E3DF62FE868',
  finalKey: '1011C097D2105D27362B987A631496BBF68B836124D1D072E9D1613C6028CF75',
  finalChainCode: 'BE98EF894B1C62B8253B480DD415B6EB707028362F2FCECF2CB3871DB8B007F1',
};

describe('HD key derivation (Happy vector parity)', () => {
  it('produces the correct root key and chain code', () => {
    const root = deriveSecretKeyTreeRoot(seed, usage);
    expect(hex(root.key)).toBe(expected.rootKey);
    expect(hex(root.chainCode)).toBe(expected.rootChainCode);
  });

  it('produces the correct child key/chainCode at each step of the path', () => {
    const root = deriveSecretKeyTreeRoot(seed, usage);
    const child1 = deriveSecretKeyTreeChild(root.chainCode, path[0]);
    const child2 = deriveSecretKeyTreeChild(child1.chainCode, path[1]);
    expect(hex(child1.key)).toBe(expected.childKey);
    expect(hex(child1.chainCode)).toBe(expected.childChainCode);
    expect(hex(child2.key)).toBe(expected.finalKey);
    expect(hex(child2.chainCode)).toBe(expected.finalChainCode);
  });

  it('deriveKey walks the full path to the final key', () => {
    expect(hex(deriveKey(seed, usage, path))).toBe(expected.finalKey);
  });

  it('is deterministic', () => {
    expect(hex(deriveKey(seed, usage, path))).toBe(hex(deriveKey(seed, usage, path)));
  });

  it('produces different keys for different paths', () => {
    expect(hex(deriveKey(seed, usage, path))).not.toBe(hex(deriveKey(seed, usage, [...path, 'additional'])));
  });

  it('produces different keys for different usages', () => {
    expect(hex(deriveKey(seed, usage, path))).not.toBe(hex(deriveKey(seed, `${usage}different`, path)));
  });

  it('returns the root key for an empty path', () => {
    expect(hex(deriveKey(seed, usage, []))).toBe(expected.rootKey);
  });
});
