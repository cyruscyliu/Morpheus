import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";

import { debounce } from "./debounce";
import { resolveViewerContext } from "./context";

interface Client {
  write: (event: string, data?: unknown) => void;
  close: () => void;
}

interface EventState {
  watcher: FSWatcher | null;
  clients: Set<Client>;
}

function getState(key: string): EventState {
  const globalState = globalThis as typeof globalThis & {
    __morpheusRunsViewerEvents?: Map<string, EventState>;
  };
  if (!globalState.__morpheusRunsViewerEvents) {
    globalState.__morpheusRunsViewerEvents = new Map<string, EventState>();
  }
  const existing = globalState.__morpheusRunsViewerEvents.get(key);
  if (existing) {
    return existing;
  }
  const created: EventState = {
    watcher: null,
    clients: new Set<Client>(),
  };
  globalState.__morpheusRunsViewerEvents.set(key, created);
  return created;
}

function ensureWatcher(configPath: string | null): EventState {
  const key = configPath || "default";
  const state = getState(key);
  if (state.watcher) {
    return state;
  }
  const { runRoot } = resolveViewerContext(configPath);
  const broadcast = debounce(() => {
    for (const client of state.clients) {
      client.write("runs-changed", { updatedAt: new Date().toISOString() });
    }
  }, 75);
  const watcher = chokidar.watch(runRoot, {
    ignoreInitial: true,
    depth: 5,
  });
  watcher.on("add", broadcast);
  watcher.on("change", broadcast);
  watcher.on("unlink", broadcast);
  watcher.on("addDir", broadcast);
  watcher.on("unlinkDir", broadcast);
  state.watcher = watcher;
  return state;
}

export function subscribeRunsEvents(configPath: string | null, client: Client): () => void {
  const state = ensureWatcher(configPath);
  state.clients.add(client);
  client.write("runs-changed", { updatedAt: new Date().toISOString() });
  return () => {
    state.clients.delete(client);
    client.close();
  };
}
