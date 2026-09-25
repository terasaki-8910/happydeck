import { describe, expect, it, vi } from 'vitest';
import type { ListDirectoryResult, ReadFileResult } from 'happy-client';
import { joinRegistryPath, pickBridgeSessionId, registryOs, remoteControlSessionUrl, resolveRemoteControlUrl, sessionRegistryDir } from './remoteControl';

const CLAUDE_SESSION_ID = '9fbebceb-d689-4c3b-9189-d45ce760161a';

/** Verbatim shape of a real `~/.claude/sessions/<pid>.json`, trimmed to the fields this module reads. */
function registryEntry(fields: Record<string, unknown>): string {
  return JSON.stringify({ pid: 37856, cwd: '/x', kind: 'interactive', status: 'idle', ...fields });
}

function directory(names: string[]): ListDirectoryResult {
  return { success: true, entries: names.map((name) => ({ name, type: 'file' as const, size: 656, modified: 0 })) };
}

describe('remoteControlSessionUrl', () => {
  it('uses a stored compat id verbatim', () => {
    expect(remoteControlSessionUrl('session_01KXiVA3Km34YdScoQY4HJQx')).toBe('https://claude.ai/code/session_01KXiVA3Km34YdScoQY4HJQx');
  });

  // The registry stores the compat form today, but the transcript and
  // ~/.claude.json both carry the cse_ form — so a future CLI storing that
  // instead must still produce a URL claude.ai accepts.
  it('rewrites a raw cse_ infra id to the session_ form the URL needs', () => {
    expect(remoteControlSessionUrl('cse_01KXiVA3Km34YdScoQY4HJQx')).toBe('https://claude.ai/code/session_01KXiVA3Km34YdScoQY4HJQx');
  });
});

describe('sessionRegistryDir / joinRegistryPath', () => {
  it('uses POSIX separators off a POSIX home', () => {
    expect(sessionRegistryDir('/Users/masa669', 'darwin')).toBe('/Users/masa669/.claude/sessions');
    expect(joinRegistryPath('/Users/masa669/.claude/sessions', '37856.json', 'darwin')).toBe('/Users/masa669/.claude/sessions/37856.json');
  });

  it('uses backslashes on win32, where homeDir is a drive path', () => {
    expect(sessionRegistryDir('C:\\Users\\e8910', 'win32')).toBe('C:\\Users\\e8910\\.claude\\sessions');
    expect(joinRegistryPath('C:\\Users\\e8910\\.claude\\sessions', '16984.json', 'win32')).toBe('C:\\Users\\e8910\\.claude\\sessions\\16984.json');
  });

  // A row that never recorded `os` must not get POSIX separators handed to a
  // Windows daemon — the home path itself says which it is.
  it('still separates a Windows path correctly with no os recorded', () => {
    expect(sessionRegistryDir('C:\\Users\\e8910', undefined)).toBe('C:\\Users\\e8910\\.claude\\sessions');
    expect(sessionRegistryDir('/home/masa669a', undefined)).toBe('/home/masa669a/.claude/sessions');
  });

  it('trusts a recorded non-win32 os over the path shape', () => {
    expect(registryOs('darwin', '/Users/masa669')).toBe('posix');
    expect(registryOs('linux', '/home/masa669a')).toBe('posix');
    expect(registryOs(undefined, 'C:\\Users\\e8910')).toBe('win32');
  });
});

describe('pickBridgeSessionId', () => {
  it('finds the entry for this session and ignores the other live sessions', () => {
    const contents = [
      registryEntry({ sessionId: 'other-uuid', bridgeSessionId: 'session_OTHER' }),
      registryEntry({ sessionId: CLAUDE_SESSION_ID, bridgeSessionId: 'session_MINE', updatedAt: 10 }),
    ];
    expect(pickBridgeSessionId(contents, CLAUDE_SESSION_ID)).toEqual({ found: true, bridgeSessionId: 'session_MINE' });
  });

  it('reports the session as present but unbridged when Remote Control was never turned on', () => {
    const contents = [registryEntry({ sessionId: CLAUDE_SESSION_ID, updatedAt: 10 })];
    expect(pickBridgeSessionId(contents, CLAUDE_SESSION_ID)).toEqual({ found: true, bridgeSessionId: null });
  });

  // A session resumed after its previous process died without cleaning up
  // leaves two files under the same sessionId; the stale one's bridge is
  // already archived server-side, so newest-updatedAt has to win.
  it('prefers the most recently updated of two entries for the same session', () => {
    const contents = [
      registryEntry({ sessionId: CLAUDE_SESSION_ID, bridgeSessionId: 'session_STALE', updatedAt: 100 }),
      registryEntry({ sessionId: CLAUDE_SESSION_ID, bridgeSessionId: 'session_FRESH', updatedAt: 200 }),
    ];
    expect(pickBridgeSessionId(contents, CLAUDE_SESSION_ID).bridgeSessionId).toBe('session_FRESH');
  });

  it('skips a file caught mid-rewrite instead of losing the answer in the others', () => {
    const contents = ['{"pid":1,"sessi', registryEntry({ sessionId: CLAUDE_SESSION_ID, bridgeSessionId: 'session_MINE' })];
    expect(pickBridgeSessionId(contents, CLAUDE_SESSION_ID).bridgeSessionId).toBe('session_MINE');
  });

  it('reports nothing found when no entry carries this session id', () => {
    expect(pickBridgeSessionId([registryEntry({ sessionId: 'other-uuid' })], CLAUDE_SESSION_ID)).toEqual({ found: false, bridgeSessionId: null });
  });
});

describe('resolveRemoteControlUrl', () => {
  const target = { machineId: 'm1', homeDir: '/Users/masa669', os: 'darwin', claudeSessionId: CLAUDE_SESSION_ID };

  function deps(listed: ListDirectoryResult, files: Record<string, ReadFileResult>) {
    return {
      listMachineDirectory: vi.fn(async () => listed),
      readMachineFile: vi.fn(async (_machineId: string, path: string) => files[path] ?? { success: false as const, error: 'ENOENT' }),
    };
  }

  it('returns the session URL, reading only the registry directory', async () => {
    const d = deps(directory(['37856.json', '72328.json']), {
      '/Users/masa669/.claude/sessions/37856.json': { success: true, content: registryEntry({ sessionId: CLAUDE_SESSION_ID, bridgeSessionId: 'session_MINE' }) },
      '/Users/masa669/.claude/sessions/72328.json': { success: true, content: registryEntry({ sessionId: 'other-uuid' }) },
    });
    await expect(resolveRemoteControlUrl(d, target)).resolves.toEqual({ kind: 'url', url: 'https://claude.ai/code/session_MINE' });
    expect(d.listMachineDirectory).toHaveBeenCalledWith('m1', '/Users/masa669/.claude/sessions');
  });

  it('distinguishes "Remote Control is off" from "the session is gone"', async () => {
    const off = deps(directory(['37856.json']), {
      '/Users/masa669/.claude/sessions/37856.json': { success: true, content: registryEntry({ sessionId: CLAUDE_SESSION_ID }) },
    });
    await expect(resolveRemoteControlUrl(off, target)).resolves.toEqual({ kind: 'not-connected' });

    const gone = deps(directory(['72328.json']), {
      '/Users/masa669/.claude/sessions/72328.json': { success: true, content: registryEntry({ sessionId: 'other-uuid' }) },
    });
    await expect(resolveRemoteControlUrl(gone, target)).resolves.toEqual({ kind: 'no-entry' });
  });

  it('treats an empty registry directory as "the session is gone", not as a failure', async () => {
    await expect(resolveRemoteControlUrl(deps(directory([]), {}), target)).resolves.toEqual({ kind: 'no-entry' });
  });

  it('reports a machine it could not reach rather than throwing at the caller', async () => {
    const listFailed = deps({ success: false, error: 'socket has been disconnected' }, {});
    await expect(resolveRemoteControlUrl(listFailed, target)).resolves.toEqual({ kind: 'unreachable', detail: 'socket has been disconnected' });

    const threw = {
      listMachineDirectory: vi.fn(async () => {
        throw new Error('Unknown machine m1');
      }),
      readMachineFile: vi.fn(async () => ({ success: false as const, error: 'unused' })),
    };
    await expect(resolveRemoteControlUrl(threw, target)).resolves.toEqual({ kind: 'unreachable', detail: 'Unknown machine m1' });
  });

  it('ignores non-json entries in the registry directory', async () => {
    const listed: ListDirectoryResult = {
      success: true,
      entries: [
        { name: '37856.abc123.key', type: 'file', size: 200, modified: 0 },
        { name: 'subdir', type: 'directory', size: 0, modified: 0 },
        { name: '37856.json', type: 'file', size: 656, modified: 0 },
      ],
    };
    const d = deps(listed, {
      '/Users/masa669/.claude/sessions/37856.json': { success: true, content: registryEntry({ sessionId: CLAUDE_SESSION_ID, bridgeSessionId: 'session_MINE' }) },
    });
    await expect(resolveRemoteControlUrl(d, target)).resolves.toEqual({ kind: 'url', url: 'https://claude.ai/code/session_MINE' });
    expect(d.readMachineFile).toHaveBeenCalledTimes(1);
  });
});
