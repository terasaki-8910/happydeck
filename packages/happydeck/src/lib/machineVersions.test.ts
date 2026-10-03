import { describe, expect, it } from 'vitest';
import {
  UPDATE_EXIT_SENTINEL,
  buildUpdateScript,
  claudeUpdateCommand,
  compareVersions,
  happyUpdateCommand,
  parseClaudeDoctor,
  parseClaudeVersion,
  parseHappyVersion,
  parseNpmLsVersion,
  parseUpdateLog,
} from './machineVersions';

/** Verbatim `claude doctor` output, Claude Code 2.1.283 on macOS (npm global install under Homebrew's node prefix). */
const DOCTOR_OUTPUT = `Claude Code doctor

Running: npm-global (2.1.283)
Commit: 4631ccd7cfe4
Platform: darwin-arm64
Path: /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
Config install method: global
Search: OK (bundled)
Auto-updates: enabled

No installation issues found.
`;

describe('parseClaudeDoctor', () => {
  it('reads version and install method off the Running: line', () => {
    expect(parseClaudeDoctor(DOCTOR_OUTPUT)).toEqual({ version: '2.1.283', method: 'npm-global' });
  });

  it('keeps the version but degrades the method when doctor names one we do not know', () => {
    // An install method added by a future Claude Code must not be guessed
    // at — 'unknown' is what turns the update button off.
    expect(parseClaudeDoctor('Running: snap (3.0.1)')).toEqual({ version: '3.0.1', method: 'unknown' });
  });

  it('recognizes the native installer, which updates with a different command entirely', () => {
    expect(parseClaudeDoctor('Running: native (2.1.283)')).toEqual({ version: '2.1.283', method: 'native' });
  });

  it('returns null when the line is absent, so the caller falls back instead of inventing a version', () => {
    expect(parseClaudeDoctor('Claude Code doctor\n\nNo installation issues found.\n')).toBeNull();
  });
});

describe('parseClaudeVersion', () => {
  it('reads `claude --version`', () => {
    expect(parseClaudeVersion('2.1.283 (Claude Code)\n')).toBe('2.1.283');
  });

  it('is null for output with no version in it at all', () => {
    expect(parseClaudeVersion('command not found: claude\n')).toBeNull();
  });
});

describe('parseHappyVersion', () => {
  it('reads happy\'s own line and ignores the Claude Code line it prints after it', () => {
    expect(parseHappyVersion('happy version: 1.2.5\nUsing Claude Code v2.1.283 from Homebrew\n')).toBe('1.2.5');
  });
});

describe('parseNpmLsVersion', () => {
  it('reads the installed version out of `npm ls -g --json`', () => {
    const json = '{"name":"lib","dependencies":{"happy":{"version":"1.2.5","overridden":false}}}';
    expect(parseNpmLsVersion(json, 'happy')).toBe('1.2.5');
  });

  it('is null when the package is simply not installed globally — npm still exits 0 and prints this', () => {
    expect(parseNpmLsVersion('{"name":"lib"}', 'happy')).toBeNull();
  });

  it('handles the scoped name as the key it actually appears under', () => {
    const json = '{"name":"lib","dependencies":{"@anthropic-ai/claude-code":{"version":"2.1.283"}}}';
    expect(parseNpmLsVersion(json, '@anthropic-ai/claude-code')).toBe('2.1.283');
  });

  it('is null rather than throwing when npm printed something that is not JSON', () => {
    expect(parseNpmLsVersion('npm ERR! code ENOENT', 'happy')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('spots a patch-level gap', () => {
    expect(compareVersions('2.1.283', '2.1.288')).toBe('behind');
  });

  it('compares segments numerically, not as strings', () => {
    // The whole point: '2.1.9' > '2.1.10' lexically, and that would hide a
    // real update behind a "you're current".
    expect(compareVersions('2.1.9', '2.1.10')).toBe('behind');
  });

  it('treats a missing trailing segment as zero', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe('current');
  });

  it('reports equal versions as current', () => {
    expect(compareVersions('1.2.5', '1.2.5')).toBe('current');
  });

  it('reports a locally newer build as ahead rather than claiming it is behind', () => {
    expect(compareVersions('1.3.0', '1.2.5')).toBe('ahead');
  });

  it('is unknown when either side is missing or unparseable', () => {
    expect(compareVersions(null, '1.2.5')).toBe('unknown');
    expect(compareVersions('1.2.5', null)).toBe('unknown');
    expect(compareVersions('nightly', '1.2.5')).toBe('unknown');
  });
});

describe('update commands', () => {
  it('uses npm for an npm-global Claude Code', () => {
    expect(claudeUpdateCommand('npm-global')).toBe('npm install -g @anthropic-ai/claude-code@latest');
  });

  it("uses Claude Code's own installer for a native install", () => {
    expect(claudeUpdateCommand('native')).toBe('claude install latest');
  });

  it('names no command for an install it cannot be sure of — running the wrong one leaves two copies on the machine', () => {
    expect(claudeUpdateCommand('homebrew')).toBeNull();
    expect(claudeUpdateCommand('unknown')).toBeNull();
    expect(claudeUpdateCommand('development')).toBeNull();
  });

  it('updates happy only when npm is known to own it', () => {
    expect(happyUpdateCommand(true)).toBe('npm install -g happy@latest');
    expect(happyUpdateCommand(false)).toBeNull();
  });
});

describe('buildUpdateScript (posix)', () => {
  const script = buildUpdateScript('darwin', '/Users/dev/.happy', 'abc', 'npm install -g happy@latest');

  it('puts both the script and its log in the machine\'s own happy home dir', () => {
    expect(script.scriptPath).toBe('/Users/dev/.happy/happydeck-update-abc.sh');
    expect(script.logPath).toBe('/Users/dev/.happy/happydeck-update-abc.log');
  });

  it('writes the exit sentinel after the command, which is the only way a poller can tell "finished" from "still downloading"', () => {
    expect(script.body).toBe(["#!/bin/sh", "npm install -g happy@latest > '/Users/dev/.happy/happydeck-update-abc.log' 2>&1", `echo ${UPDATE_EXIT_SENTINEL}$? >> '/Users/dev/.happy/happydeck-update-abc.log'`, ''].join('\n'));
  });

  it('detaches the launch from every stream the RPC holds, or exec() would block for the whole install', () => {
    expect(script.launchCommand).toBe("nohup sh '/Users/dev/.happy/happydeck-update-abc.sh' > /dev/null 2>&1 < /dev/null &");
  });

  it('never fails the read RPC just because the log does not exist yet', () => {
    expect(script.readLogCommand).toBe("cat '/Users/dev/.happy/happydeck-update-abc.log' 2>/dev/null || true");
  });

  it('quotes a home directory containing a space', () => {
    const spaced = buildUpdateScript('linux', '/home/some one/.happy', 'x', 'npm install -g happy@latest');
    expect(spaced.launchCommand).toContain("'/home/some one/.happy/happydeck-update-x.sh'");
  });
});

describe('buildUpdateScript (win32)', () => {
  const script = buildUpdateScript('win32', 'C:\\Users\\dev\\.happy', 'abc', 'npm install -g happy@latest');

  it('writes a .cmd next to a .log, using the backslash separator of the path it was given', () => {
    expect(script.scriptPath).toBe('C:\\Users\\dev\\.happy\\happydeck-update-abc.cmd');
    expect(script.logPath).toBe('C:\\Users\\dev\\.happy\\happydeck-update-abc.log');
  });

  it('uses CRLF and a late-expanded errorlevel, which is what a batch file needs to report the exit code of the line before', () => {
    expect(script.body).toBe(['@echo off', 'npm install -g happy@latest > "C:\\Users\\dev\\.happy\\happydeck-update-abc.log" 2>&1', `echo ${UPDATE_EXIT_SENTINEL}%errorlevel%>> "C:\\Users\\dev\\.happy\\happydeck-update-abc.log"`, ''].join('\r\n'));
  });

  it('launches through `start /b` so the RPC returns before the install does', () => {
    expect(script.launchCommand).toBe('start "" /b cmd /c "C:\\Users\\dev\\.happy\\happydeck-update-abc.cmd"');
  });
});

describe('parseUpdateLog', () => {
  it('reports no exit code while the command is still running', () => {
    expect(parseUpdateLog('npm warn deprecated foo@1.0.0\n')).toEqual({ output: 'npm warn deprecated foo@1.0.0', exitCode: null });
  });

  it('strips the sentinel out of the output it shows', () => {
    expect(parseUpdateLog(`added 1 package in 4s\n${UPDATE_EXIT_SENTINEL}0\n`)).toEqual({ output: 'added 1 package in 4s', exitCode: 0 });
  });

  it('carries a non-zero exit through, so a failed install is not reported as a success', () => {
    expect(parseUpdateLog(`npm error code EACCES\n${UPDATE_EXIT_SENTINEL}243\n`)).toEqual({ output: 'npm error code EACCES', exitCode: 243 });
  });

  it('handles an empty log from a command that printed nothing at all', () => {
    expect(parseUpdateLog(`${UPDATE_EXIT_SENTINEL}0\n`)).toEqual({ output: '', exitCode: 0 });
  });
});
