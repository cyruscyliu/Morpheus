const STATUS_ORDER = ["drifting", "stale", "active", "recent", "quiet", "aligned", "behind", "ahead-only", "unavailable", "n/a", "unknown"];

export function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRelativeDays(days) {
  if (days === null || days === undefined) {
    return "Unknown";
  }
  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  return `${days} days ago`;
}

export function statusOptions(snapshot) {
  const values = new Set(snapshot.repos.map((repo) => repo.status));
  return [...values].sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b));
}

export function driftLabel(repo) {
  if (!repo.isFork) {
    return "n/a";
  }
  const drift = repo.drift;
  if (!drift || !drift.available) {
    return "unavailable";
  }
  return `-${drift.behindBy}/+${drift.aheadBy}`;
}

export function sortRepos(repos, mode) {
  const items = [...repos];
  if (mode === "name") {
    return items.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  if (mode === "status") {
    return items.sort((a, b) => {
      const diff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return diff || a.fullName.localeCompare(b.fullName);
    });
  }
  if (mode === "drift") {
    return items.sort((a, b) => {
      const aDrift = a.drift?.behindBy ?? -1;
      const bDrift = b.drift?.behindBy ?? -1;
      return bDrift - aDrift || a.fullName.localeCompare(b.fullName);
    });
  }
  return items.sort((a, b) => {
    const aDays = a.activityDays ?? Number.MAX_SAFE_INTEGER;
    const bDays = b.activityDays ?? Number.MAX_SAFE_INTEGER;
    return aDays - bDays || a.fullName.localeCompare(b.fullName);
  });
}

export function filterRepos(repos, filters) {
  return repos.filter((repo) => {
    if (filters.status !== "all" && repo.status !== filters.status) {
      return false;
    }
    if (filters.type === "fork" && !repo.isFork) {
      return false;
    }
    if (filters.type === "repo" && repo.isFork) {
      return false;
    }
    return true;
  });
}

export function getSelectedRepo(snapshot, hash) {
  const repoId = decodeURIComponent((hash || "").replace(/^#repo=/, ""));
  if (!repoId) {
    return snapshot.repos[0] || null;
  }
  return snapshot.repos.find((repo) => repo.id === repoId) || snapshot.repos[0] || null;
}

export function renderOverview(snapshot) {
  const cards = [
    ["Tracked repos", snapshot.overview.tracked],
    ["Forks", snapshot.overview.forks],
    ["Active", snapshot.overview.active],
    ["Stale", snapshot.overview.stale],
    ["Drifting", snapshot.overview.drifting],
  ];
  return cards
    .map(([label, value]) => `<article class="card"><span class="muted">${label}</span><strong>${value}</strong></article>`)
    .join("");
}

export function renderTable(repos, selectedId) {
  return repos
    .map((repo) => {
      const latest = repo.latestCommit ? `${repo.latestCommit.shortSha} ${repo.latestCommit.message}` : "No commits available";
      const rowClass = repo.id === selectedId ? "is-selected" : "";
      return `
        <tr data-repo-id="${repo.id}" class="${rowClass}">
          <td>
            <a class="repo-link" href="#repo=${encodeURIComponent(repo.id)}">${repo.fullName}</a>
          </td>
          <td>${repo.isFork ? "Fork" : "Repo"}</td>
          <td><span class="status-pill" data-tone="${repo.status}">${repo.status}</span></td>
          <td>${formatRelativeDays(repo.activityDays)}</td>
          <td>${latest}</td>
          <td>${driftLabel(repo)}</td>
        </tr>
      `;
    })
    .join("");
}

export function renderDetail(repo) {
  if (!repo) {
    return `<p class="empty-state">No repository data is available.</p>`;
  }

  const driftMarkup = repo.isFork
    ? `
      <div class="detail-block">
        <h3>Fork drift</h3>
        <p>${driftLabel(repo)}</p>
        <p class="muted">${repo.drift?.parent ? `Parent: ${repo.drift.parent}` : "Parent unavailable"}</p>
      </div>
    `
    : `
      <div class="detail-block">
        <h3>Fork drift</h3>
        <p>Not a fork</p>
      </div>
    `;

  const commits = repo.recentCommits.length
    ? repo.recentCommits
        .map(
          (commit) => `
            <li>
              <a href="${commit.url}" target="_blank" rel="noreferrer">${commit.shortSha}</a>
              ${commit.message}
              <span class="muted">by ${commit.author} on ${formatTimestamp(commit.date)}</span>
            </li>
          `
        )
        .join("")
    : `<li>No commits available.</li>`;

  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h3>${repo.fullName}</h3>
        <p>${repo.description || "No description provided."}</p>
        <p><a href="${repo.url}" target="_blank" rel="noreferrer">Open on GitHub</a></p>
      </div>
      <div class="detail-block">
        <h3>Status</h3>
        <p><span class="status-pill" data-tone="${repo.status}">${repo.status}</span></p>
        <p class="muted">Last push ${formatTimestamp(repo.pushedAt)}</p>
      </div>
      <div class="detail-block">
        <h3>Repository</h3>
        <p>${repo.isFork ? "Fork" : "Repo"} on branch ${repo.defaultBranch}</p>
        <p class="muted">${repo.stars} stars · ${repo.forks} forks · ${repo.openIssues} open issues</p>
      </div>
      ${driftMarkup}
    </div>
    <div class="detail-block">
      <h3>Recent commits</h3>
      <ol class="commit-list">${commits}</ol>
    </div>
  `;
}

async function loadSnapshot() {
  const response = await fetch("./snapshot.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Snapshot request failed with status ${response.status}`);
  }
  return response.json();
}

function installAutoReload() {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return;
  }
  const source = new EventSource("/__reload");
  source.onmessage = (event) => {
    if (event.data === "reload") {
      window.location.reload();
    }
  };
  source.onerror = () => {
    source.close();
    window.setTimeout(installAutoReload, 1000);
  };
}

function populateStatusFilter(snapshot, select) {
  const options = statusOptions(snapshot);
  const markup = [`<option value="all">All</option>`]
    .concat(options.map((status) => `<option value="${status}">${status}</option>`))
    .join("");
  select.innerHTML = markup;
}

function installTableSelection(snapshot, state, tbody, detailNode) {
  tbody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-repo-id]");
    if (!row) {
      return;
    }
    window.location.hash = `repo=${encodeURIComponent(row.dataset.repoId)}`;
    const selected = getSelectedRepo(snapshot, window.location.hash);
    detailNode.innerHTML = renderDetail(selected);
    state.selectedId = selected?.id ?? null;
    refreshTable(snapshot, state);
  });
}

function refreshTable(snapshot, state) {
  const filtered = filterRepos(snapshot.repos, state.filters);
  const sorted = sortRepos(filtered, state.sort);
  const selected = getSelectedRepo({ repos: sorted }, `#repo=${encodeURIComponent(state.selectedId || "")}`);

  state.selectedId = selected?.id ?? null;
  document.querySelector("#repo-table-body").innerHTML = renderTable(sorted, state.selectedId);
  document.querySelector("#repo-detail").innerHTML = renderDetail(getSelectedRepo(snapshot, `#repo=${encodeURIComponent(state.selectedId || "")}`));
  document.querySelector("#empty-state").hidden = sorted.length > 0;
}

function bootstrap(snapshot) {
  const state = {
    filters: { status: "all", type: "all" },
    sort: "activity",
    selectedId: getSelectedRepo(snapshot, window.location.hash)?.id ?? null,
  };

  document.querySelector("#generated-at").textContent = formatTimestamp(snapshot.generatedAt);

  const statusFilter = document.querySelector("#status-filter");
  const typeFilter = document.querySelector("#type-filter");
  const sortSelect = document.querySelector("#sort-select");
  populateStatusFilter(snapshot, statusFilter);

  const tableBody = document.querySelector("#repo-table-body");
  const detailNode = document.querySelector("#repo-detail");
  installTableSelection(snapshot, state, tableBody, detailNode);

  statusFilter.addEventListener("change", () => {
    state.filters.status = statusFilter.value;
    refreshTable(snapshot, state);
  });
  typeFilter.addEventListener("change", () => {
    state.filters.type = typeFilter.value;
    refreshTable(snapshot, state);
  });
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    refreshTable(snapshot, state);
  });
  window.addEventListener("hashchange", () => {
    state.selectedId = getSelectedRepo(snapshot, window.location.hash)?.id ?? null;
    refreshTable(snapshot, state);
  });

  refreshTable(snapshot, state);
}

async function main() {
  try {
    const snapshot = await loadSnapshot();
    bootstrap(snapshot);
  } catch (error) {
    document.querySelector("#generated-at").textContent = "Unavailable";
    document.querySelector("#repo-detail").innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
}

if (typeof window !== "undefined") {
  installAutoReload();
  main();
}
