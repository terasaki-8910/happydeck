import { create } from 'zustand';
import {
  CLAUDE_DOCTOR_COMMAND,
  CLAUDE_NPM_LS_COMMAND,
  CLAUDE_NPM_PACKAGE,
  CLAUDE_VERSION_COMMAND,
  HAPPY_NPM_LS_COMMAND,
  HAPPY_NPM_PACKAGE,
  HAPPY_VERSION_COMMAND,
  type InstallMethod,
  buildUpdateScript,
  claudeUpdateCommand,
  fetchLatestNpmVersion,
  happyUpdateCommand,
  parseClaudeDoctor,
  parseClaudeVersion,
  parseHappyVersion,
  parseNpmLsVersion,
  parseUpdateLog,
} from '../lib/machineVersions';
import { MOCK_ENABLED } from '../lib/mockData';
import { useHappyStore } from './happyStore';

export type Tool = 'happy' | 'claude';

export interface ToolState {
  /** Version on the machine's disk right now, or null when the tool couldn't be run at all. */
  installed: string | null;
  /** Non-null only for claude — happy reports no install method of its own (see machineVersions.ts). */
  method: InstallMethod | null;
  /** The command that would update it, or null when we can't name one we're sure of. */
  updateCommand: string | null;
}

/** Why an update launch or its watch stopped — rendered through i18n, so a key rather than a sentence. */
export type UpdateFailure = 'launchFailed' | 'pollTimeout' | 'noScratchDir';

export interface UpdateRun {
  tool: Tool;
  command: string;
  /** Accumulated stdout+stderr as the install writes it. */
  output: string;
  /** null while still running. */
  exitCode: number | null;
  failure: UpdateFailure | null;
  /** Detail for a launch failure — the RPC's own message, not localizable. */
  detail: string | null;
}

export interface MachineVersionEntry {
  status: 'loading' | 'ready' | 'error';
  happy: ToolState | null;
  claude: ToolState | null;
  /** Set only when NOTHING answered — i.e. the probes themselves couldn't reach the machine. */
  unreachable: boolean;
  checkedAt: number | null;
  update: UpdateRun | null;
}

interface LatestState {
  happy: string | null;
  claude: string | null;
  unreachable: boolean;
  fetchedAt: number | null;
  loading: boolean;
}

export interface MachineProbeTarget {
  machineId: string;
  platform: string;
  /** The CLI's own ~/.happy on that machine — the scratch dir an update's script and log go in. */
  happyHomeDir: string | null;
}

interface MachineVersionStoreState {
  byMachine: Record<string, MachineVersionEntry>;
  latest: LatestState;
  /**
   * Probe a machine if it hasn't been probed yet this app session, and
   * fetch the registry's latest versions if they're stale. Safe to call on
   * every hover — that is the point of it existing separately from refresh.
   */
  ensure: (machineId: string) => void;
  /** Re-probe unconditionally (the popover's "check again" button). */
  refresh: (machineId: string) => Promise<void>;
  /** Launch the update for one tool and stream its output into `update`. */
  runUpdate: (target: MachineProbeTarget, tool: Tool) => Promise<void>;
  /** Clear a finished update's output panel. */
  dismissUpdate: (machineId: string) => void;
}

// The registry's answer is the same for every machine, so it is fetched
// once and shared. An hour is far longer than anyone goes between hovers
// and still short enough that a release published mid-session shows up
// without restarting the app.
const LATEST_TTL_MS = 60 * 60 * 1000;

// Poll cadence while an update runs. npm is silent for long stretches
// mid-download, so this is about keeping the "still going" signal honest,
// not about catching every line the instant it is written.
const UPDATE_POLL_INTERVAL_MS = 1500;
// How long to keep watching before giving up on the log. The install is
// NOT killed by this — it is detached, so a timeout means "stopped
// watching", which is what the popover then says.
const UPDATE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

// VITE_HAPPYDECK_MOCK=1 fixtures. Two deliberately different shapes, same
// reasoning as usageStore's MOCK_WINDOWS: the degraded states are the ones
// that are awkward to reach on purpose against real machines, so the mock
// is where they stay inspectable. mock-machine-mac is the ordinary
// "everything answered, Claude Code is behind" case; every other machine
// (i.e. mock-machine-win) gets the one where an update command can't be
// named — Claude Code installed by something that is neither npm nor its
// own installer, and a happy that didn't answer at all.
const MOCK_ENTRIES: Record<string, Omit<MachineVersionEntry, 'checkedAt' | 'update'>> = {
  'mock-machine-mac': {
    status: 'ready',
    happy: { installed: '1.2.5', method: null, updateCommand: `npm install -g ${HAPPY_NPM_PACKAGE}@latest` },
    claude: { installed: '2.1.283', method: 'npm-global', updateCommand: `npm install -g ${CLAUDE_NPM_PACKAGE}@latest` },
    unreachable: false,
  },
  default: {
    status: 'ready',
    happy: null,
    claude: { installed: '2.1.280', method: 'homebrew', updateCommand: null },
    unreachable: false,
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one probe command and hands back its stdout, or null if it couldn't
 * run. Probes fail independently on purpose: a machine with no `npm` on
 * the daemon's PATH should still report its Claude Code version.
 */
async function probe(machineId: string, command: string): Promise<string | null> {
  try {
    const result = await useHappyStore.getState().runMachineBash(machineId, command);
    return result.success ? result.stdout : null;
  } catch {
    return null;
  }
}

function patch(machineId: string, changes: Partial<MachineVersionEntry>): void {
  useMachineVersionStore.setState((state) => {
    const current = state.byMachine[machineId];
    if (!current) return state;
    return { byMachine: { ...state.byMachine, [machineId]: { ...current, ...changes } } };
  });
}

function patchUpdate(machineId: string, command: string, changes: Partial<UpdateRun>): boolean {
  const live = useMachineVersionStore.getState().byMachine[machineId]?.update;
  // The panel was dismissed, or a different update replaced this one —
  // stop rather than overwrite whatever the user is now looking at.
  if (!live || live.command !== command) return false;
  patch(machineId, { update: { ...live, ...changes } });
  return true;
}

export const useMachineVersionStore = create<MachineVersionStoreState>()((set, get) => ({
  byMachine: {},
  latest: { happy: null, claude: null, unreachable: false, fetchedAt: null, loading: false },

  ensure(machineId) {
    void fetchLatest();
    if (get().byMachine[machineId]) return;
    void get().refresh(machineId);
  },

  async refresh(machineId) {
    if (MOCK_ENABLED) {
      const fixture = MOCK_ENTRIES[machineId] ?? MOCK_ENTRIES.default;
      set((state) => ({ byMachine: { ...state.byMachine, [machineId]: { ...fixture, checkedAt: Date.now(), update: state.byMachine[machineId]?.update ?? null } } }));
      return;
    }
    const previous = get().byMachine[machineId];
    set((state) => ({
      byMachine: {
        ...state.byMachine,
        [machineId]: {
          status: 'loading',
          happy: previous?.happy ?? null,
          claude: previous?.claude ?? null,
          unreachable: false,
          checkedAt: previous?.checkedAt ?? null,
          // A finished or running update survives a re-probe — re-probing
          // is exactly what someone does to check whether it landed.
          update: previous?.update ?? null,
        },
      },
    }));

    // `claude doctor` and `happy --version` run the tools themselves, so
    // they are the authority on what is on PATH; the two npm lookups exist
    // only to answer "is this the npm-global copy", which is what decides
    // whether the update button can act. All four are independent, so one
    // round of parallel RPCs rather than four sequential ones.
    const [doctorOut, happyOut, claudeNpmOut, happyNpmOut] = await Promise.all([
      probe(machineId, CLAUDE_DOCTOR_COMMAND),
      probe(machineId, HAPPY_VERSION_COMMAND),
      probe(machineId, CLAUDE_NPM_LS_COMMAND),
      probe(machineId, HAPPY_NPM_LS_COMMAND),
    ]);

    const claudeFromNpm = claudeNpmOut ? parseNpmLsVersion(claudeNpmOut, CLAUDE_NPM_PACKAGE) : null;
    let claudeProbe = doctorOut ? parseClaudeDoctor(doctorOut) : null;
    if (!claudeProbe) {
      // doctor missing or reshaped — fall back to the plain version flag,
      // then to npm's own record.
      const versionOut = await probe(machineId, CLAUDE_VERSION_COMMAND);
      const fromVersionFlag = versionOut ? parseClaudeVersion(versionOut) : null;
      if (fromVersionFlag || claudeFromNpm) {
        claudeProbe = { version: fromVersionFlag ?? claudeFromNpm, method: claudeFromNpm ? 'npm-global' : 'unknown' };
      }
    }

    const happyFromNpm = happyNpmOut ? parseNpmLsVersion(happyNpmOut, HAPPY_NPM_PACKAGE) : null;
    const happyInstalled = (happyOut ? parseHappyVersion(happyOut) : null) ?? happyFromNpm;
    const happyCommand = happyUpdateCommand(happyFromNpm !== null);
    const claudeCommand = claudeProbe ? claudeUpdateCommand(claudeProbe.method) : null;

    const nothingAnswered = claudeProbe === null && happyInstalled === null;
    patch(machineId, {
      status: nothingAnswered ? 'error' : 'ready',
      unreachable: nothingAnswered,
      checkedAt: Date.now(),
      happy: happyInstalled === null ? null : { installed: happyInstalled, method: null, updateCommand: happyCommand },
      claude: claudeProbe === null ? null : { installed: claudeProbe.version, method: claudeProbe.method, updateCommand: claudeCommand },
    });
  },

  async runUpdate(target, tool) {
    const { machineId, platform, happyHomeDir } = target;
    const entry = get().byMachine[machineId];
    const command = (tool === 'happy' ? entry?.happy : entry?.claude)?.updateCommand;
    if (!entry || !command) return;

    patch(machineId, { update: { tool, command, output: '', exitCode: null, failure: null, detail: null } });

    if (MOCK_ENABLED) {
      await sleep(600);
      patchUpdate(machineId, command, { output: `+ ${command}\nadded 1 package in 4s`, exitCode: 0 });
      return;
    }

    if (!happyHomeDir) {
      patchUpdate(machineId, command, { failure: 'noScratchDir' });
      return;
    }

    const script = buildUpdateScript(platform, happyHomeDir, crypto.randomUUID(), command);
    const { runMachineBash, writeMachineFile } = useHappyStore.getState();

    try {
      const written = await writeMachineFile(machineId, script.scriptPath, script.body);
      if (!written.success) throw new Error(written.error);
      // This RPC returns as soon as the detached child exists, so a
      // failure here is a failure to START — the install never ran.
      const launched = await runMachineBash(machineId, script.launchCommand);
      if (!launched.success) throw new Error(launched.error);
    } catch (error) {
      patchUpdate(machineId, command, { failure: 'launchFailed', detail: error instanceof Error ? error.message : String(error) });
      return;
    }

    const startedAt = Date.now();
    for (;;) {
      await sleep(UPDATE_POLL_INTERVAL_MS);
      if (get().byMachine[machineId]?.update?.command !== command) return;

      let log: string | null = null;
      try {
        const read = await runMachineBash(machineId, script.readLogCommand);
        if (read.success) log = read.stdout;
      } catch {
        // Ignored: a single dropped read says nothing about the install,
        // which is detached and still going. Keep polling to the deadline.
      }

      const state = log === null ? null : parseUpdateLog(log);
      if (state === null || state.exitCode === null) {
        if (Date.now() - startedAt > UPDATE_POLL_TIMEOUT_MS) {
          patchUpdate(machineId, command, { output: state?.output ?? '', failure: 'pollTimeout' });
          return;
        }
        if (state) patchUpdate(machineId, command, { output: state.output });
        continue;
      }

      if (!patchUpdate(machineId, command, { output: state.output, exitCode: state.exitCode })) return;
      await runMachineBash(machineId, script.cleanupCommand).catch(() => {});
      // Re-probe so the versions on screen become the post-update ones
      // rather than the stale numbers that prompted the update.
      void get().refresh(machineId);
      return;
    }
  },

  dismissUpdate(machineId) {
    patch(machineId, { update: null });
  },
}));

/** Shared across machines — see LATEST_TTL_MS. Never throws; a failed fetch surfaces as `latest.unreachable`. */
async function fetchLatest(): Promise<void> {
  const { latest } = useMachineVersionStore.getState();
  if (latest.loading) return;
  if (latest.fetchedAt !== null && Date.now() - latest.fetchedAt < LATEST_TTL_MS) return;

  if (MOCK_ENABLED) {
    useMachineVersionStore.setState({ latest: { happy: '1.2.6', claude: '2.1.288', unreachable: false, fetchedAt: Date.now(), loading: false } });
    return;
  }

  useMachineVersionStore.setState((state) => ({ latest: { ...state.latest, loading: true } }));
  const [happy, claude] = await Promise.all([
    fetchLatestNpmVersion(HAPPY_NPM_PACKAGE).catch(() => null),
    fetchLatestNpmVersion(CLAUDE_NPM_PACKAGE).catch(() => null),
  ]);
  const bothFailed = happy === null && claude === null;
  useMachineVersionStore.setState({
    latest: {
      happy,
      claude,
      unreachable: bothFailed,
      // Only a run that learned something counts as fetched — otherwise an
      // offline launch would pin the failure in place for the next hour.
      fetchedAt: bothFailed ? null : Date.now(),
      loading: false,
    },
  });
}
