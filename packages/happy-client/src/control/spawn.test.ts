import { describe, expect, it } from 'vitest';
import { wireModel, wirePermissionMode } from './spawn';

/**
 * These two mappings exist only because happy-cli's daemon drops
 * `permissionMode === 'default'` on the floor and then falls back to yolo —
 * see spawn.ts for the full trace with bundle line numbers. Getting
 * `wirePermissionMode` wrong silently produces a fully bypassed agent while
 * every UI in the stack labels it "default", so it's worth pinning down.
 */
describe('wirePermissionMode', () => {
  it("never lets a literal 'default' reach the wire — that is the bug", () => {
    expect(wirePermissionMode('default')).not.toBe('default');
  });

  it("maps 'default' to safe-yolo, which the CLI maps back to default", () => {
    expect(wirePermissionMode('default')).toBe('safe-yolo');
  });

  it('passes every other mode through untouched', () => {
    for (const mode of ['plan', 'acceptEdits', 'bypassPermissions', 'yolo', 'safe-yolo', 'read-only']) {
      expect(wirePermissionMode(mode)).toBe(mode);
    }
  });

  it('leaves undefined alone, so "unspecified" stays unspecified', () => {
    expect(wirePermissionMode(undefined)).toBeUndefined();
  });
});

describe('wireModel', () => {
  it("drops 'default' rather than sending a literal --model default", () => {
    expect(wireModel('default')).toBeUndefined();
  });

  it('passes real model ids through untouched', () => {
    for (const model of ['opus', 'sonnet', 'opusplan', 'claude-opus-5']) {
      expect(wireModel(model)).toBe(model);
    }
  });

  it('leaves undefined alone', () => {
    expect(wireModel(undefined)).toBeUndefined();
  });
});
