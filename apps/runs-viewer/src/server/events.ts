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

function getState(): EventState {
  const globalState = globalThis as typeof globalThis & {
    __morpheusRunsViewerEvents?: EventState;
  };
  if (!globalState.__morpheusRunsViewerEvents) {
    globalState.__morpheusRunsViewerEvents = {
      watcher: null,
      clients: new Set<Client>(),
    };
  }
  return globalState.__morpheusRunsViewerEvents;
}

function ensureWatcher(): EventState {
  const state = getState();
  if (state.watcher) {
    return state;
  }
  const { runRoot } = resolveViewerContext();
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

export function subscribeRunsEvents(client: Client): () => void {
  const state = ensureWatcher();
  state.clients.add(client);
  client.write("runs-changed", { updatedAt: new Date().toISOString() });
  return () => {
    state.clients.delete(client);
    client.close();
  };
}
