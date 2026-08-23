import type { CreateDirectoryResult, DecryptedMachine, ListDirectoryResult } from 'happy-client';
import type { LiveSession } from '../store/happyStore';
import { parentPath } from './paths';

/**
 * Static fixture data for local UI development, so verifying a UI change
 * doesn't require going through the real macOS Keychain grant (which,
 * unlike a signed release build, re-prompts on effectively every dev
 * rebuild since the unsigned binary's hash changes each time) or touching
 * the real account/relay/machines at all.
 *
 * Enabled by running with VITE_HAPPYDECK_MOCK=1, e.g.:
 *   VITE_HAPPYDECK_MOCK=1 pnpm exec tauri dev
 * Never wired into the default `pnpm dev`/`tauri dev` path — the user's
 * own normal dev workflow is completely unaffected.
 */
export const MOCK_ENABLED = import.meta.env.VITE_HAPPYDECK_MOCK === '1';

function textMsg(id: string, seq: number, role: 'user' | 'agent', text: string, createdAt: number) {
  return { id, seq, createdAt, content: { role, content: { type: 'text', text } } };
}

/** Text typed directly into the CLI's own terminal — mirrored via the session-protocol envelope, not a plain role:'user' message. */
function terminalTextMsg(id: string, seq: number, text: string, createdAt: number) {
  return {
    id,
    seq,
    createdAt,
    content: { role: 'session', content: { role: 'user', ev: { t: 'text', text } } },
  };
}

/** A session-protocol file event (happy-wire's sessionFileEventSchema) — an image pasted into the terminal, uploaded via Happy's own blob protocol. `ref` doesn't need to resolve to anything real: downloadAttachment's mock branch ignores it and returns a fixed placeholder PNG. */
function fileMsg(id: string, seq: number, createdAt: number, name: string, size: number, mimeType: string) {
  return {
    id,
    seq,
    createdAt,
    content: { role: 'session', content: { role: 'user', ev: { t: 'file', ref: `mock-ref-${id}`, name, size, mimeType } } },
  };
}

function toolCallMsg(id: string, seq: number, createdAt: number, name: string, title: string, args: Record<string, unknown>) {
  return {
    id,
    seq,
    createdAt,
    content: { role: 'session', content: { ev: { t: 'tool-call-start', call: id, name, title, description: '', args } } },
  };
}

function titleMsg(id: string, seq: number, createdAt: number, title: string) {
  return {
    id,
    seq,
    createdAt,
    content: { role: 'session', content: { ev: { t: 'tool-call-start', call: id, name: 'mcp__happy__change_title', title: 'change_title', description: '', args: { title } } } },
  };
}

const now = 1786800000000;

export function mockSessions(): LiveSession[] {
  return [
    {
      id: 'mock-1-markdown',
      seq: 10,
      active: true,
      activeAt: now,
      createdAt: now - 600000,
      updatedAt: now,
      metadata: {
        path: '/Users/dev/project/happydeck',
        host: 'MacBook-Air.local',
        machineId: 'mock-machine-mac',
        permissionMode: 'default',
        modelMode: 'default',
        effortLevel: 'medium',
        slashCommands: ['compact', 'clear', 'review', 'model', 'mcp'],
        mcpServers: [
          { name: 'happy', status: 'connected' },
          { name: 'playwright', status: 'connected' },
        ],
      },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: true,
      hasMoreMessages: true,
      messagesError: null,
      messages: [
        titleMsg('m1-0', 1, now - 500000, 'Fix the sidebar collapse animation'),
        textMsg('m1-1', 2, 'user', 'Can you explain what changed in the last refactor? Use a table if it helps.', now - 400000),
        toolCallMsg('m1-2', 3, now - 390000, 'Read', 'Read', { file_path: 'src/App.tsx' }),
        toolCallMsg('m1-2a', 3.1, now - 385000, 'Bash', 'Bash', { command: 'grep -n Panel src/App.tsx' }),
        toolCallMsg('m1-2b2', 3.2, now - 380000, 'Edit', 'Edit', { file_path: 'src/App.css' }),
        terminalTextMsg('m1-2b', 4, 'actually also check the sidebar CSS while you\'re in there', now - 350000),
        fileMsg('m1-2c', 4.1, now - 340000, 'screenshot-2026-08-19.png', 284672, 'image/png'),
        fileMsg('m1-2d', 4.2, now - 335000, 'notes.pdf', 1048576, 'application/pdf'),
        textMsg(
          'm1-3',
          5,
          'agent',
          '## Summary\n\nHere is what changed:\n\n| Area | Before | After |\n|---|---|---|\n| Layout | fixed width | resizable |\n| Sidebar | CSS toggle | Panel API |\n\n**Key point:** the `Panel` component must be a *direct* child of `Group` — see `src/App.tsx`.\n\n```ts\nconst ref = useRef<PanelImperativeHandle>(null)\n```\n\nLet me know if you want more detail.',
          now - 300000,
        ),
      ],
    },
    {
      id: 'mock-2-offline',
      seq: 40,
      active: false,
      activeAt: now - 3600000,
      createdAt: now - 7200000,
      updatedAt: now - 3600000,
      metadata: { path: 'D:\\gta5-modding', host: 'omen6', machineId: 'mock-machine-win', permissionMode: 'plan' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: false,
      hasMoreMessages: false,
      messagesError: null,
      messages: [
        titleMsg('m2-0', 1, now - 7100000, 'GTA5 mod load order cleanup'),
        textMsg('m2-1', 2, 'user', 'Sort my mod load order.', now - 7000000),
        toolCallMsg('m2-2', 3, now - 6900000, 'Bash', 'Bash', { command: 'ls "D:\\gta5-modding\\mods" | sort' }),
        textMsg('m2-3', 4, 'agent', 'Done — sorted alphabetically, conflicts flagged in `conflicts.txt`.', now - 6800000),
      ],
    },
    {
      id: 'mock-3-no-title',
      seq: 5,
      active: true,
      activeAt: now,
      createdAt: now - 100000,
      updatedAt: now,
      metadata: { path: '/Users/dev/project/terasaki-8910.github.io', host: 'MacBook-Air.local', machineId: 'mock-machine-mac' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: false,
      hasMoreMessages: false,
      messagesError: null,
      messages: [
        textMsg('m3-1', 1, 'user', 'Find where the tag mapping is defined.', now - 90000),
        toolCallMsg('m3-2', 2, now - 80000, 'Grep', 'Grep', { pattern: 'tag-map', path: 'public' }),
        toolCallMsg('m3-3', 3, now - 70000, 'Bash', 'Bash', { command: 'curl -s "https://danbooru.donmai.us/posts.json?tags=ellen_joe" | python3 -m json.tool | head -60' }),
      ],
    },
    {
      id: 'mock-4-second',
      seq: 8,
      active: true,
      activeAt: now,
      createdAt: now - 50000,
      updatedAt: now,
      metadata: { path: '/Users/dev/project/multiMonitor', host: 'MacBook-Air.local', machineId: 'mock-machine-mac' },
      metadataVersion: 1,
      // A pending AskUserQuestion — exercises the AskUserQuestionCard UI in
      // mock mode. Same shape a real Claude Code session sends (confirmed
      // against happy-cli's permissionHandler.ts and happy-app's own
      // AskUserQuestionView): an ordinary agentState.requests entry, not a
      // separate protocol concept.
      agentState: {
        requests: {
          'mock-ask-1': {
            tool: 'AskUserQuestion',
            createdAt: now,
            arguments: {
              questions: [
                {
                  question: 'Which package manager should this project use?',
                  header: 'Package manager',
                  multiSelect: false,
                  options: [
                    { label: 'pnpm', description: 'Fast, disk-space efficient — already used elsewhere in this monorepo.' },
                    { label: 'npm', description: 'Ships with Node, no extra install.' },
                    { label: 'yarn', description: 'Workspaces support, widely used.' },
                  ],
                },
                {
                  question: 'Which test types should the CI workflow run?',
                  header: 'CI scope',
                  multiSelect: true,
                  options: [
                    { label: 'Unit tests', description: 'Fast, run on every push.' },
                    { label: 'Integration tests', description: 'Slower, hits a real database.' },
                    { label: 'E2E tests', description: 'Slowest, spins up a full browser.' },
                  ],
                },
              ],
            },
          },
        },
      },
      agentStateVersion: 1,
      dataKey: null,
      thinking: false,
      hasMoreMessages: false,
      messagesError: null,
      messages: [titleMsg('m4-0', 1, now - 40000, 'Second pane for testing splits'), textMsg('m4-1', 2, 'agent', 'Ready.', now - 30000)],
    },
  ];
}

// A tiny fake filesystem for the SpawnPanel's directory browser in mock
// mode — keyed by absolute path, each entry a list of subdirectory names.
const MOCK_FILESYSTEM: Record<string, string[]> = {
  '/Users/dev': ['project', 'Downloads', 'Documents'],
  '/Users/dev/project': ['happydeck', 'multiMonitor', 'terasaki-8910.github.io'],
  '/Users/dev/project/happydeck': ['packages', 'src'],
  '/Users/dev/Downloads': [],
  '/Users/dev/Documents': ['notes'],
  'C:\\Users\\dev': ['project', 'Downloads'],
  'C:\\Users\\dev\\project': ['gta5-modding'],
  'C:\\Users\\dev\\Downloads': [],
};

export function mockListDirectory(path: string): ListDirectoryResult {
  const children = MOCK_FILESYSTEM[path];
  if (!children) {
    return { success: false, error: `(mock) no such directory: ${path}` };
  }
  return {
    success: true,
    entries: children.map((name) => ({ name, type: 'directory', size: 0, modified: now })),
  };
}

let mockSpawnCounter = 0;

/** Builds a fresh LiveSession for the mock "start" flow — lets SpawnPanel's real success path (auto-focus the new session) be exercised in mock mode instead of just throwing "Unknown machine". */
export function buildMockSession(machineId: string, host: string, directory: string): LiveSession {
  mockSpawnCounter += 1;
  const id = `mock-spawned-${mockSpawnCounter}`;
  return {
    id,
    seq: 1,
    active: true,
    activeAt: now,
    createdAt: now,
    updatedAt: now,
    metadata: { path: directory, host, machineId },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 1,
    dataKey: null,
    thinking: false,
    hasMoreMessages: false,
    messagesError: null,
    messages: [],
  };
}

// Mirrors the real machine RPC, which always shells out to `mkdir -p` (see
// happy-client's machineCreateDirectory) — creates any missing ancestors
// too, not just the immediate parent. A strict superset of plain mkdir: when
// the parent already exists (the DirectoryBrowser's "new folder" case) this
// behaves identically to before.
export function mockCreateDirectory(path: string): CreateDirectoryResult {
  if (MOCK_FILESYSTEM[path]) return { success: true };
  const missingAncestors: string[] = [];
  let current = path;
  while (!MOCK_FILESYSTEM[current]) {
    missingAncestors.push(current);
    const parent = parentPath(current);
    if (parent === current) break;
    current = parent;
  }
  for (let i = missingAncestors.length - 1; i >= 0; i--) {
    const dir = missingAncestors[i];
    const parent = parentPath(dir);
    const name = dir.slice(parent.length).replace(/^[/\\]+/, '');
    MOCK_FILESYSTEM[parent] = [...(MOCK_FILESYSTEM[parent] ?? []), name];
    MOCK_FILESYSTEM[dir] = [];
  }
  return { success: true };
}

export function mockMachines(): DecryptedMachine[] {
  return [
    {
      id: 'mock-machine-mac',
      active: true,
      activeAt: now,
      createdAt: now - 1000000,
      updatedAt: now,
      metadata: { host: 'MacBook-Air.local', platform: 'darwin', homeDir: '/Users/dev' },
      daemonState: null,
      dataKey: null,
    },
    {
      id: 'mock-machine-win',
      active: true,
      activeAt: now,
      createdAt: now - 1000000,
      updatedAt: now,
      metadata: { host: 'omen6', platform: 'win32', homeDir: 'C:\\Users\\dev' },
      daemonState: null,
      dataKey: null,
    },
  ];
}
