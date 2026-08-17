import type { DecryptedMachine } from 'happy-client';
import type { LiveSession } from '../store/happyStore';

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
      metadata: { path: '/Users/dev/project/happydeck', host: 'MacBook-Air.local', permissionMode: 'default', modelMode: 'default', effortLevel: 'medium' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: true,
      messages: [
        titleMsg('m1-0', 1, now - 500000, 'Fix the sidebar collapse animation'),
        textMsg('m1-1', 2, 'user', 'Can you explain what changed in the last refactor? Use a table if it helps.', now - 400000),
        toolCallMsg('m1-2', 3, now - 390000, 'Read', 'Read', { file_path: 'src/App.tsx' }),
        textMsg(
          'm1-3',
          4,
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
      metadata: { path: 'D:\\gta5-modding', host: 'omen6', permissionMode: 'plan' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: false,
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
      metadata: { path: '/Users/dev/project/terasaki-8910.github.io', host: 'MacBook-Air.local' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: false,
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
      metadata: { path: '/Users/dev/project/multiMonitor', host: 'MacBook-Air.local' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataKey: null,
      thinking: false,
      messages: [titleMsg('m4-0', 1, now - 40000, 'Second pane for testing splits'), textMsg('m4-1', 2, 'agent', 'Ready.', now - 30000)],
    },
  ];
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
