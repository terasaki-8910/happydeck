import { describe, expect, it } from 'vitest';
import { alwaysAllowGrant, describePendingRequest } from './permissionRequest';
import type { PendingPermissionRequest } from '../store/happyStore';

function bashRequest(command: string): PendingPermissionRequest {
  return { tool: 'Bash', arguments: { command } };
}

describe('alwaysAllowGrant', () => {
  it('builds a Bash(<first token>:*) pattern from a plain command', () => {
    expect(alwaysAllowGrant(bashRequest('git status --short'), 'en')).toEqual({
      allowedTools: ['Bash(git:*)'],
      scopeDescription: 'Allows every future "git ..." command for the rest of this session, without asking again.',
    });
  });

  it('skips a leading single env-var assignment', () => {
    expect(alwaysAllowGrant(bashRequest('FOO=bar git status'), 'en')?.allowedTools).toEqual(['Bash(git:*)']);
  });

  it('skips multiple leading env-var assignments', () => {
    expect(alwaysAllowGrant(bashRequest('A=1 B=2 npm install'), 'en')?.allowedTools).toEqual(['Bash(npm:*)']);
  });

  it('returns null for a command that is only an env-var assignment (nothing to run)', () => {
    expect(alwaysAllowGrant(bashRequest('FOO=bar'), 'en')).toBeNull();
  });

  it('returns null when the command is missing entirely', () => {
    expect(alwaysAllowGrant({ tool: 'Bash', arguments: {} }, 'en')).toBeNull();
    expect(alwaysAllowGrant({ tool: 'Bash', arguments: undefined }, 'en')).toBeNull();
  });

  it('does not treat a bare "Bash" grant as valid on its own -- always builds a command-scoped pattern', () => {
    const grant = alwaysAllowGrant(bashRequest('git log'), 'en');
    expect(grant?.allowedTools).not.toContain('Bash');
  });

  it('uses the bare tool name for a non-Bash tool', () => {
    expect(alwaysAllowGrant({ tool: 'Edit', arguments: { file_path: '/a.ts' } }, 'en')).toEqual({
      allowedTools: ['Edit'],
      scopeDescription: 'Allows every future Edit request for the rest of this session, without asking again.',
    });
  });

  it('localizes the scope description to Japanese', () => {
    expect(alwaysAllowGrant(bashRequest('git status'), 'ja')?.scopeDescription).toBe('今後「git」で始まるコマンドは、このセッション中は確認なしで許可します。');
    expect(alwaysAllowGrant({ tool: 'Edit', arguments: {} }, 'ja')?.scopeDescription).toBe('今後のEditのリクエストは、このセッション中は確認なしで許可します。');
  });
});

describe('describePendingRequest', () => {
  it('shows the full command for Bash', () => {
    expect(describePendingRequest(bashRequest('git status --short'))).toBe('git status --short');
  });

  it('falls back to a common argument field name for other tools', () => {
    expect(describePendingRequest({ tool: 'Edit', arguments: { file_path: '/a.ts' } })).toBe('/a.ts');
    expect(describePendingRequest({ tool: 'WebFetch', arguments: { url: 'https://example.com' } })).toBe('https://example.com');
  });

  it('returns null when nothing recognizable is present', () => {
    expect(describePendingRequest({ tool: 'SomeFutureTool', arguments: { obscureField: 1 } })).toBeNull();
    expect(describePendingRequest({ tool: 'Bash', arguments: {} })).toBeNull();
  });
});
