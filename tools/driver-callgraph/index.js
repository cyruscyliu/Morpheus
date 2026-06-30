#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const repeatable = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      if (repeatable.has(key)) {
        flags[key].push(next);
      } else if (Object.prototype.hasOwnProperty.call(flags, key)) {
        flags[key] = [flags[key], next].flat();
        repeatable.add(key);
      } else {
        flags[key] = next;
      }
      index += 1;
      continue;
    }
    flags[key] = true;
  }
  return { positionals, flags };
}

function usage() {
  return [
    "Usage:",
    "  driver-callgraph compose --llcg-dot FILE --output-dir DIR [--title TEXT]",
    "                           [--result-file FILE]",
    "",
    "This tool composes a driver lifecycle skeleton with a scoped llcg DOT.",
  ].join("\n");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stableLocation(baseDir, filePath) {
  const relative = path.relative(baseDir, filePath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative || ".";
  }
  return filePath;
}

function parseDot(text) {
  const nodes = new Set();
  const edges = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const edgeMatch = line.match(/^"([^"]+)"\s*->\s*"([^"]+)"/);
    if (edgeMatch) {
      const src = edgeMatch[1];
      const dst = edgeMatch[2];
      nodes.add(src);
      nodes.add(dst);
      edges.push({ src, dst });
      continue;
    }
    const nodeMatch = line.match(/^"([^"]+)"(?:\s*\[.*\])?;$/);
    if (nodeMatch) {
      nodes.add(nodeMatch[1]);
    }
  }
  return { nodes, edges };
}

function dotQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderNode(id, attrs = {}) {
  const parts = Object.entries(attrs).map(([key, value]) => {
    if (typeof value === "number") {
      return `${key}=${value}`;
    }
    return `${key}=${dotQuote(value)}`;
  });
  return `  ${id}${parts.length ? ` [${parts.join(", ")}]` : ""};`;
}

function renderEdge(src, dst, attrs = {}) {
  const parts = Object.entries(attrs).map(([key, value]) => {
    if (typeof value === "number") {
      return `${key}=${value}`;
    }
    return `${key}=${dotQuote(value)}`;
  });
  return `  ${src} -> ${dst}${parts.length ? ` [${parts.join(", ")}]` : ""};`;
}

function renderSimpleDot(title, graph) {
  const lines = [
    "digraph driver_callgraph_debug {",
    "  graph [",
    `    label=${dotQuote(title)},`,
    '    labelloc="t",',
    '    labeljust="l"',
    "  ];",
    '  node [shape="box"];',
  ];
  for (const node of graph.nodes || []) {
    lines.push(renderNode(dotQuote(node), { label: node }));
  }
  for (const edge of graph.edges || []) {
    lines.push(renderEdge(dotQuote(edge.src), dotQuote(edge.dst)));
  }
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function summarizeGroups(groups, llcgNodes, sliceNodes, collapsedNodes) {
  const llcgNodeSet = llcgNodes instanceof Set ? llcgNodes : new Set(llcgNodes);
  const sliceNodeSet = sliceNodes instanceof Set ? sliceNodes : new Set(sliceNodes);
  const collapsedNodeSet = collapsedNodes instanceof Set
    ? collapsedNodes
    : new Set(collapsedNodes);
  return groups.map((group) => {
    const llcgMembers = group.members.filter((member) => llcgNodeSet.has(member));
    const sliceMembers = group.members.filter((member) => sliceNodeSet.has(member));
    const collapsedMembers = group.members.filter((member) => collapsedNodeSet.has(member));
    return {
      label: group.label,
      tags: group.tags || [],
      declared_members: group.members,
      llcg_members: llcgMembers,
      slice_members: sliceMembers,
      collapsed_members: collapsedMembers,
    };
  });
}

function stableUnique(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = String(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}

function loadPrefixGraph(filePath) {
  if (!filePath) {
    return {};
  }
  const payload = readJson(filePath);
  if (!payload || typeof payload !== "object") {
    throw new Error(`invalid prefix file: ${filePath}`);
  }
  return payload;
}

function parseGroupsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  const groups = [];
  const groupsByLabel = new Map();
  let current = null;

  function flushCurrent() {
    if (!current || current.members.length === 0) {
      current = null;
      return;
    }
    const modifying = current.members.some((member) => member.startsWith("+") || member.startsWith("-"));
    const existing = groupsByLabel.get(current.label);
    if (modifying && existing) {
      for (const member of current.members) {
        const op = member[0];
        const name = member.slice(1).trim();
        if (!name) {
          continue;
        }
        if (op === "+") {
          if (!existing.members.includes(name)) {
            existing.members.push(name);
          }
        } else if (op === "-") {
          existing.members = existing.members.filter((entry) => entry !== name);
        }
      }
      current = null;
      return;
    }
    if (modifying && !existing) {
      current.members = current.members
        .filter((member) => !member.startsWith("-"))
        .map((member) => member.startsWith("+") ? member.slice(1).trim() : member);
    }
    if (existing) {
      for (const member of current.members) {
        if (!existing.members.includes(member)) {
          existing.members.push(member);
        }
      }
      current = null;
      return;
    }
    groups.push(current);
    groupsByLabel.set(current.label, current);
    current = null;
  }

  for (const rawLine of readText(filePath).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      if (!line) {
        flushCurrent();
      }
      continue;
    }
    if (!current) {
      const tags = [];
      const tagPattern = /^\[([^\]]+)\]/g;
      let match = tagPattern.exec(line);
      while (match) {
        tags.push(match[1]);
        match = tagPattern.exec(line);
      }
      current = {
        label: line.replace(/^(\[[^\]]+\])+/, "").trim(),
        members: [],
        tags,
      };
      continue;
    }
    const parts = line.split(":");
    const member = (parts.length > 1 ? parts.slice(1).join(":") : parts[0]).trim();
    if (member) {
      current.members.push(member);
    }
  }
  flushCurrent();
  return groups;
}

function collectReachableSliceFromRoots(graph, roots) {
  const selectedRoots = roots.filter((name) => graph.nodes.has(name));

  const adjacency = new Map();
  for (const { src, dst } of graph.edges) {
    if (!adjacency.has(src)) {
      adjacency.set(src, []);
    }
    adjacency.get(src).push(dst);
  }

  const queue = [...selectedRoots];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    const nextNodes = adjacency.get(current) || [];
    for (const next of nextNodes) {
      if (visited.has(next)) {
        continue;
      }
      if (/_remove$/.test(next) || /unregister/.test(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  const nodes = [...visited].sort();
  const nodeSet = new Set(nodes);
  const edges = graph.edges.filter(
    ({ src, dst }) => nodeSet.has(src) && nodeSet.has(dst),
  );

  return {
    roots,
    selected_roots: selectedRoots,
    nodes,
    edges,
  };
}

function selectLifecycleRoots(graph, groups, prefix = {}) {
  const prefixRoots = stableUnique(Array.isArray(prefix.roots) ? prefix.roots : []);
  if (prefixRoots.length > 0) {
    return prefixRoots;
  }
  return stableUnique(
    groups
      .filter((group) => Array.isArray(group.tags) && group.tags.includes("entry_point"))
      .flatMap((group) => group.members)
      .filter((name) => graph.nodes.has(name)),
  );
}

function buildAdjacency(edges) {
  const forward = new Map();
  const reverse = new Map();
  for (const { src, dst } of edges) {
    if (!forward.has(src)) {
      forward.set(src, []);
    }
    if (!reverse.has(dst)) {
      reverse.set(dst, []);
    }
    forward.get(src).push(dst);
    reverse.get(dst).push(src);
  }
  return { forward, reverse };
}

function bfsReachable(seeds, adjacency) {
  const queue = [...seeds];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    const nextNodes = adjacency.get(current) || [];
    for (const next of nextNodes) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function bfsReachableWithGroupGuard(seeds, adjacency, memberToGroup, allowedGroups) {
  const queue = [...seeds];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    const nextNodes = adjacency.get(current) || [];
    for (const next of nextNodes) {
      if (visited.has(next)) {
        continue;
      }
      const nextGroup = memberToGroup.get(next);
      if (nextGroup && !allowedGroups.has(nextGroup)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function pruneByGroupPaths(graph, groups, availableNodes = graph.nodes) {
  const availableNodeSet = availableNodes instanceof Set
    ? availableNodes
    : new Set(availableNodes);
  const visibleGroups = groups
    .map((group) => ({
      label: group.label,
      members: group.members.filter((member) => availableNodeSet.has(member)),
    }))
    .filter((group) => group.members.length > 0);

  if (visibleGroups.length < 2) {
    return graph;
  }

  const { forward } = buildAdjacency(graph.edges);
  const terminals = [...new Set(visibleGroups.flatMap((group) => group.members))];
  const groupedMembers = new Set(terminals);
  const memberToGroup = new Map();
  for (const group of visibleGroups) {
    for (const member of group.members) {
      memberToGroup.set(member, group.label);
    }
  }
  const valid = new Set();
  const activeGroups = new Set();
  const collapsedEdges = [];
  const edgeSeen = new Set();

  for (const srcGroup of visibleGroups) {
    for (const dstGroup of visibleGroups) {
      if (srcGroup.label === dstGroup.label) {
        continue;
      }
      const allowedGroups = new Set([srcGroup.label, dstGroup.label]);
      for (const srcMember of srcGroup.members) {
        const reachable = bfsReachableWithGroupGuard(
          [srcMember],
          forward,
          memberToGroup,
          allowedGroups,
        );
        for (const dstMember of dstGroup.members) {
          if (srcMember === dstMember) {
            continue;
          }
          if (!reachable.has(dstMember)) {
            continue;
          }
          valid.add(srcMember);
          valid.add(dstMember);
          activeGroups.add(srcGroup.label);
          activeGroups.add(dstGroup.label);
          const edgeKey = `${srcMember} -> ${dstMember}`;
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            collapsedEdges.push({ src: srcMember, dst: dstMember });
          }
        }
      }
    }
  }

  if (valid.size === 0) {
    return graph;
  }

  const nodes = visibleGroups
    .filter((group) => activeGroups.has(group.label))
    .flatMap((group) => group.members)
    .filter((node, index, array) => array.indexOf(node) === index)
    .filter((node) => groupedMembers.has(node))
    .sort();
  const nodeSet = new Set(nodes);
  const edges = collapsedEdges.filter(
    ({ src, dst }) => nodeSet.has(src) && nodeSet.has(dst),
  );
  return {
    roots: graph.roots,
    nodes,
    edges,
  };
}

function renderGraph(title, llcgDotPath, groupsFilePath, prefixFilePath, mode = "node") {
  const graph = parseDot(readText(llcgDotPath));
  const prefix = loadPrefixGraph(prefixFilePath);
  const groups = parseGroupsFile(groupsFilePath);
  const lifecycleRoots = selectLifecycleRoots(graph, groups, prefix);
  const lifecycle = collectReachableSliceFromRoots(graph, lifecycleRoots);
  const collapsed = pruneByGroupPaths(lifecycle, groups, graph.nodes);
  const graphConfig = prefix.graph || {};
  const rankdir = mode === "projected"
    ? String(graphConfig.display_rankdir || graphConfig.rankdir || "LR")
    : String(graphConfig.raw_rankdir || graphConfig.rankdir || "TB");
  const splines = mode === "projected"
    ? String(graphConfig.display_splines || graphConfig.splines || "polyline")
    : String(graphConfig.raw_splines || graphConfig.splines || "ortho");
  const nodesep = mode === "projected"
    ? String(graphConfig.display_nodesep || graphConfig.nodesep || "0.9")
    : String(graphConfig.raw_nodesep || graphConfig.nodesep || "0.55");
  const ranksep = mode === "projected"
    ? String(graphConfig.display_ranksep || graphConfig.ranksep || "1.3")
    : String(graphConfig.raw_ranksep || graphConfig.ranksep || "0.8");
  const groupedMembers = new Set();
  const memberToGroup = new Map();
  const groupRepresentatives = new Map();
  const groupClusterNames = new Map();
  const projectedEdgeSeen = new Set();
  const projectedMinlenIndex = new Map();

  function nextProjectedMinlen(groupLabel) {
    const index = projectedMinlenIndex.get(groupLabel) || 0;
    projectedMinlenIndex.set(groupLabel, index + 1);
    return 1 + (index % 3);
  }

  const lines = [
    "digraph driver_callgraph {",
    "  graph [",
    `    rankdir=${dotQuote(rankdir)},`,
    `    compound=${dotQuote(String(graphConfig.compound ?? true))},`,
    `    concentrate=${dotQuote(String(graphConfig.concentrate ?? false))},`,
    `    splines=${dotQuote(splines)},`,
    `    nodesep=${dotQuote(nodesep)},`,
    `    ranksep=${dotQuote(ranksep)},`,
    `    labelloc=${dotQuote(String(graphConfig.labelloc || "t"))},`,
    `    labeljust=${dotQuote(String(graphConfig.labeljust || "l"))},`,
    `    fontsize=${dotQuote(String(graphConfig.fontsize || "18"))},`,
    `    fontname=${dotQuote(String(graphConfig.fontname || "Helvetica"))},`,
    `    label=${dotQuote(title)}`,
    "  ];",
    "",
    "  node [",
    `    shape=${dotQuote(String(prefix.node_defaults?.shape || "box"))},`,
    `    style=${dotQuote(String(prefix.node_defaults?.style || "rounded,filled"))},`,
    `    fontname=${dotQuote(String(prefix.node_defaults?.fontname || "Helvetica"))},`,
    `    fontsize=${dotQuote(String(prefix.node_defaults?.fontsize || "12"))},`,
    `    color=${dotQuote(String(prefix.node_defaults?.color || "#3b342f"))},`,
    `    penwidth=${dotQuote(String(prefix.node_defaults?.penwidth || "1.4"))}`,
    "  ];",
    "",
    "  edge [",
    `    color=${dotQuote(String(prefix.edge_defaults?.color || "#4a443e"))},`,
    `    penwidth=${dotQuote(String(prefix.edge_defaults?.penwidth || "1.5"))},`,
    `    arrowsize=${dotQuote(String(prefix.edge_defaults?.arrowsize || "0.8"))},`,
    `    fontname=${dotQuote(String(prefix.edge_defaults?.fontname || "Helvetica"))},`,
    `    fontsize=${dotQuote(String(prefix.edge_defaults?.fontsize || "11"))}`,
    "  ];",
    "",
  ];

  for (const cluster of prefix.clusters || []) {
    lines.push(`  subgraph ${cluster.name} {`);
    const attrs = cluster.attrs || {};
    for (const [key, value] of Object.entries(attrs)) {
      lines.push(`    ${key}=${dotQuote(String(value))};`);
    }
    for (const node of cluster.nodes || []) {
      lines.push(renderNode(node.id, node.attrs || {}));
    }
    lines.push("  }");
    lines.push("");
  }

  const llcgNodeSet = new Set(collapsed.nodes);
  let clusterIndex = 0;
  for (const group of groups) {
    const visibleMembers = group.members.filter((member) => llcgNodeSet.has(member));
    if (visibleMembers.length === 0) {
      continue;
    }
    const clusterName = `cluster_group_${clusterIndex}`;
    lines.push("");
    lines.push(`  subgraph ${clusterName} {`);
    clusterIndex += 1;
    groupClusterNames.set(group.label, clusterName);
    lines.push(`    label=${dotQuote(group.label)};`);
    lines.push('    color="#8a1c00";');
    lines.push('    style="rounded,filled,dashed";');
    lines.push('    fillcolor="#ffd6a5";');
    lines.push('    penwidth="2.0";');
    groupRepresentatives.set(group.label, visibleMembers[0]);
    for (const member of visibleMembers) {
      groupedMembers.add(member);
      memberToGroup.set(member, group.label);
      lines.push(renderNode(dotQuote(member), {
        label: member,
        fillcolor: "#edf3fb",
      }));
    }
    lines.push("  }");
  }

  for (const node of collapsed.nodes) {
    if (groupedMembers.has(node)) {
      continue;
    }
    lines.push(renderNode(dotQuote(node), {
      label: node,
      fillcolor: "#edf3fb",
    }));
  }
  for (const edge of collapsed.edges) {
    if (mode === "projected") {
      const srcGroup = memberToGroup.get(edge.src) || "";
      const dstGroup = memberToGroup.get(edge.dst) || "";
      const srcCluster = srcGroup ? groupClusterNames.get(srcGroup) : "";
      if (srcGroup && dstGroup && srcGroup !== dstGroup) {
        const representative = groupRepresentatives.get(dstGroup);
        const clusterName = groupClusterNames.get(dstGroup);
        if (representative && clusterName) {
          const edgeKey = `${srcGroup} -> ${dstGroup}`;
          if (projectedEdgeSeen.has(edgeKey)) {
            continue;
          }
          projectedEdgeSeen.add(edgeKey);
          const attrs = {
            color: "#3c5d7d",
            penwidth: "1.6",
            lhead: clusterName,
            minlen: nextProjectedMinlen(dstGroup),
          };
          if (srcCluster) {
            attrs.ltail = srcCluster;
          }
          lines.push(renderEdge(dotQuote(edge.src), dotQuote(representative), attrs));
          continue;
        }
      }
    }
    const attrs = {
      color: "#3c5d7d",
      penwidth: "1.6",
    };
    if (mode === "projected") {
      const srcGroup = memberToGroup.get(edge.src) || "";
      const dstGroup = memberToGroup.get(edge.dst) || "";
      const srcCluster = srcGroup ? groupClusterNames.get(srcGroup) : "";
      const dstCluster = dstGroup ? groupClusterNames.get(dstGroup) : "";
      if (srcCluster) {
        attrs.ltail = srcCluster;
      }
      if (dstCluster) {
        attrs.lhead = dstCluster;
        attrs.minlen = nextProjectedMinlen(dstGroup);
      }
    }
    lines.push(renderEdge(dotQuote(edge.src), dotQuote(edge.dst), attrs));
  }
  lines.push("");

  for (const edge of prefix.edges || []) {
    lines.push(renderEdge(edge.src, edge.dst, edge.attrs || {}));
  }
  lines.push("");

  const connectorSpecs = [];
  for (const [src, dst] of connectorSpecs) {
    if (!llcgNodeSet.has(dst)) {
      continue;
    }
    const attrs = {
      color: "#8f5b00",
      style: "dotted",
      penwidth: "1.5",
      arrowsize: "0.75",
    };
    if (mode === "projected") {
      const dstGroup = memberToGroup.get(dst) || "";
      const dstCluster = dstGroup ? groupClusterNames.get(dstGroup) : "";
      if (dstCluster) {
        attrs.lhead = dstCluster;
        attrs.minlen = nextProjectedMinlen(dstGroup);
      }
    }
    lines.push(renderEdge(src, dotQuote(dst), attrs));
  }

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function renderGraphviz(dotPath) {
  const dotBin = cp.spawnSync("which", ["dot"], { encoding: "utf8" }).stdout.trim();
  if (!dotBin) {
    return { svgPath: "", pdfPath: "" };
  }
  const svgPath = dotPath.replace(/\.dot$/, ".svg");
  const pdfPath = dotPath.replace(/\.dot$/, ".pdf");
  const svg = cp.spawnSync(dotBin, ["-Tsvg", dotPath, "-o", svgPath], {
    encoding: "utf8",
  });
  if (svg.status !== 0) {
    throw new Error(svg.stderr || "failed to render svg");
  }
  const pdf = cp.spawnSync(dotBin, ["-Tpdf", dotPath, "-o", pdfPath], {
    encoding: "utf8",
  });
  if (pdf.status !== 0) {
    throw new Error(pdf.stderr || "failed to render pdf");
  }
  return { svgPath, pdfPath };
}

function writeResult(resultFile, value) {
  if (!resultFile) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  writeJson(resultFile, value);
}

function commandCompose(flags) {
  const llcgDot = flags["llcg-dot"] ? path.resolve(String(flags["llcg-dot"])) : "";
  const groupsFile = flags["groups-file"]
    ? path.resolve(String(flags["groups-file"]))
    : "";
  const prefixFile = flags["prefix-file"]
    ? path.resolve(String(flags["prefix-file"]))
    : "";
  const outputDir = flags["output-dir"]
    ? path.resolve(String(flags["output-dir"]))
    : "";
  const title = String(
    flags.title || "HyperArm Driver Init / Deinit Base Graph",
  );
  const resultFile = flags["result-file"]
    ? path.resolve(String(flags["result-file"]))
    : "";

  if (!llcgDot || !fs.existsSync(llcgDot)) {
    throw new Error("compose requires an existing --llcg-dot FILE");
  }
  if (!outputDir) {
    throw new Error("compose requires --output-dir DIR");
  }
  if (prefixFile && !fs.existsSync(prefixFile)) {
    throw new Error("compose requires an existing --prefix-file FILE");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const nodeDotPath = path.join(outputDir, "driver-callgraph-raw.dot");
  const dotPath = path.join(outputDir, "driver-callgraph-display.dot");
  const llcgInputDotPath = path.join(outputDir, "driver-callgraph-llcg-input.dot");
  const sliceDotPath = path.join(outputDir, "driver-callgraph-slice.dot");
  const collapsedDotPath = path.join(outputDir, "driver-callgraph-collapsed.dot");
  const debugJsonPath = path.join(outputDir, "driver-callgraph-debug.json");
  const rootsJsonPath = path.join(outputDir, "driver-callgraph-roots.json");
  const groupsJsonPath = path.join(outputDir, "driver-callgraph-groups.json");
  const manifestPath = path.join(outputDir, "driver-callgraph-manifest.json");
  const logPath = path.join(outputDir, "build.log");
  const parsedGraph = parseDot(readText(llcgDot));
  const groups = parseGroupsFile(groupsFile);
  const prefix = loadPrefixGraph(prefixFile);
  const lifecycleRoots = selectLifecycleRoots(parsedGraph, groups, prefix);
  if (lifecycleRoots.length === 0) {
    throw new Error(
      "compose requires lifecycle roots from prefix.roots or [entry_point] groups",
    );
  }
  const runtimeRoots = prefixFile ? [] : lifecycleRoots;
  const lifecycle = collectReachableSliceFromRoots(parsedGraph, lifecycleRoots);
  const collapsed = pruneByGroupPaths(lifecycle, groups, parsedGraph.nodes);
  const groupSummary = summarizeGroups(
    groups,
    parsedGraph.nodes,
    lifecycle.nodes,
    collapsed.nodes,
  );
  const nodeDotText = renderGraph(title, llcgDot, groupsFile, prefixFile, "node");
  const dotText = renderGraph(title, llcgDot, groupsFile, prefixFile, "projected");
  fs.writeFileSync(llcgInputDotPath, readText(llcgDot), "utf8");
  fs.writeFileSync(sliceDotPath, renderSimpleDot(`${title} Slice`, lifecycle), "utf8");
  fs.writeFileSync(
    collapsedDotPath,
    renderSimpleDot(`${title} Collapsed`, collapsed),
    "utf8",
  );
  writeJson(rootsJsonPath, {
    runtime_roots: runtimeRoots,
    lifecycle_roots: lifecycle.roots || [],
    lifecycle_selected_roots: lifecycle.selected_roots || [],
    missing_lifecycle_roots: (lifecycle.roots || []).filter(
      (root) => !(lifecycle.selected_roots || []).includes(root),
    ),
  });
  writeJson(groupsJsonPath, {
    groups: groupSummary,
  });
  writeJson(debugJsonPath, {
    llcg_dot: llcgDot,
    groups_file: groupsFile,
    prefix_file: prefixFile,
    runtime_roots: runtimeRoots,
    lifecycle_roots: lifecycle.roots || [],
    lifecycle_selected_roots: lifecycle.selected_roots || [],
    missing_lifecycle_roots: (lifecycle.roots || []).filter(
      (root) => !(lifecycle.selected_roots || []).includes(root),
    ),
    llcg_node_count: parsedGraph.nodes.size,
    llcg_edge_count: parsedGraph.edges.length,
    slice_node_count: lifecycle.nodes.length,
    slice_edge_count: lifecycle.edges.length,
    collapsed_node_count: collapsed.nodes.length,
    collapsed_edge_count: collapsed.edges.length,
    groups_total: groups.length,
    groups_visible_in_llcg: groupSummary.filter((group) => group.llcg_members.length > 0).length,
    groups_visible_in_slice: groupSummary.filter((group) => group.slice_members.length > 0).length,
    groups_visible_in_collapsed: groupSummary.filter(
      (group) => group.collapsed_members.length > 0,
    ).length,
    roots_json: rootsJsonPath,
    groups_json: groupsJsonPath,
  });
  fs.writeFileSync(nodeDotPath, nodeDotText, "utf8");
  fs.writeFileSync(dotPath, dotText, "utf8");
  const { svgPath: nodeSvgPath, pdfPath: nodePdfPath } = renderGraphviz(nodeDotPath);
  const { svgPath, pdfPath } = renderGraphviz(dotPath);

  const manifest = {
    command: "build",
    status: "success",
    summary: "composed driver lifecycle graph from llcg dot",
    details: {
      title,
      llcg_dot: llcgDot,
      groups_file: groupsFile,
      prefix_file: prefixFile,
      llcg_input_dot: llcgInputDotPath,
      slice_dot: sliceDotPath,
      collapsed_dot: collapsedDotPath,
      debug_json: debugJsonPath,
      roots_json: rootsJsonPath,
      groups_json: groupsJsonPath,
      graph_node_dot: nodeDotPath,
      graph_node_svg: nodeSvgPath,
      graph_node_pdf: nodePdfPath,
      graph_dot: dotPath,
      graph_svg: svgPath,
      graph_pdf: pdfPath,
    },
  };
  writeJson(manifestPath, manifest);
  fs.writeFileSync(
    logPath,
    [
      `title=${title}`,
      `llcg_dot=${llcgDot}`,
      `roots_json=${rootsJsonPath}`,
      `groups_json=${groupsJsonPath}`,
      `graph_dot=${dotPath}`,
      `graph_svg=${svgPath}`,
      `graph_pdf=${pdfPath}`,
    ].join("\n") + "\n",
    "utf8",
  );

  const result = {
    summary: "composed driver lifecycle graph from llcg dot",
    details: {
      output: outputDir,
      llcg_dot: llcgDot,
      prefix_file: prefixFile,
      llcg_input_dot: llcgInputDotPath,
      slice_dot: sliceDotPath,
      collapsed_dot: collapsedDotPath,
      debug_json: debugJsonPath,
      roots_json: rootsJsonPath,
      groups_json: groupsJsonPath,
      node_dot: nodeDotPath,
      node_svg: nodeSvgPath,
      node_pdf: nodePdfPath,
      dot: dotPath,
      svg: svgPath,
      pdf: pdfPath,
      manifest: manifestPath,
      log: logPath,
    },
    artifacts: [
      { path: "output-dir", location: outputDir },
      { path: "manifest", location: manifestPath },
      { path: "graph-llcg-input-dot", location: llcgInputDotPath },
      { path: "graph-slice-dot", location: sliceDotPath },
      { path: "graph-collapsed-dot", location: collapsedDotPath },
      { path: "debug-json", location: debugJsonPath },
      { path: "roots-json", location: rootsJsonPath },
      { path: "groups-json", location: groupsJsonPath },
      { path: "graph-raw-dot", location: nodeDotPath },
      { path: "graph-raw-svg", location: nodeSvgPath },
      { path: "graph-raw-pdf", location: nodePdfPath },
      { path: "graph-display-dot", location: dotPath },
      { path: "graph-display-svg", location: svgPath },
      { path: "graph-display-pdf", location: pdfPath },
      { path: "build-log", location: logPath },
    ],
  };
  writeResult(resultFile, result);
  if (!resultFile) {
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "success",
      summary: result.summary,
      details: {
        output: stableLocation(outputDir, outputDir),
        dot: stableLocation(outputDir, dotPath),
      },
    })}\n`,
  );
}

function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command || flags.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(command ? 0 : 1);
  }
  if (command !== "compose") {
    throw new Error(`unsupported command: ${command}`);
  }
  commandCompose(flags);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
