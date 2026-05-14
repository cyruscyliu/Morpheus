import type { RunGraphEdge, RunGraphNode } from "@/src/types";

export type GraphLayoutPresetId = "compact" | "balanced" | "spacious";
export type GraphPortSide = "left" | "right" | "top" | "bottom";

export interface GraphPortSpec {
  id: string;
  kind: "artifact-in" | "artifact-out" | "sequence-in" | "sequence-out";
  label: string | null;
  title: string | null;
  side: GraphPortSide;
  x: number;
  y: number;
}

export interface PositionedGraphNode extends RunGraphNode {
  stepOrder: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  railWidth: number;
  centerX: number;
  centerY: number;
  ports: {
    inputs: GraphPortSpec[];
    outputs: GraphPortSpec[];
    sequenceIn: GraphPortSpec | null;
    sequenceOut: GraphPortSpec | null;
  };
}

export interface RoutedGraphEdge extends RunGraphEdge {
  sourceHandle: string | null;
  targetHandle: string | null;
  points: Array<{ x: number; y: number }>;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: PositionedGraphNode[];
  edges: RoutedGraphEdge[];
}

function stepDisplayName(node: RunGraphNode): string {
  return node.name && node.name.trim() ? node.name : node.id;
}

function formatGraphEdge(edge: RunGraphEdge): string | null {
  return edge.artifactPath || edge.label || null;
}

function artifactPortKey(edge: RunGraphEdge, direction: "in" | "out"): string {
  const value = formatGraphEdge(edge) || edge.label || edge.artifactPath || edge.id;
  const owner = direction === "out" ? edge.source : `${edge.source}->${edge.target}`;
  return encodeURIComponent(`${owner}:${value}`);
}

export function buildInitialGraphLayout(
  nodes: RunGraphNode[],
  edges: RunGraphEdge[],
): GraphLayout | null {
  if (nodes.length === 0) {
    return null;
  }

  const minNodeWidth = 340;
  const nodeOrderById = new Map(nodes.map((node, index) => [node.id, index + 1]));
  const incomingArtifactEdgesByNode = new Map<string, RunGraphEdge[]>();
  const outgoingArtifactEdgesByNode = new Map<string, RunGraphEdge[]>();
  const incomingSequenceEdgesByNode = new Map<string, RunGraphEdge[]>();
  const outgoingSequenceEdgesByNode = new Map<string, RunGraphEdge[]>();

  for (const node of nodes) {
    incomingArtifactEdgesByNode.set(node.id, []);
    outgoingArtifactEdgesByNode.set(node.id, []);
    incomingSequenceEdgesByNode.set(node.id, []);
    outgoingSequenceEdgesByNode.set(node.id, []);
  }

  for (const edge of edges) {
    if (edge.kind === "artifact") {
      outgoingArtifactEdgesByNode.get(edge.source)?.push(edge);
      incomingArtifactEdgesByNode.get(edge.target)?.push(edge);
    } else {
      outgoingSequenceEdgesByNode.get(edge.source)?.push(edge);
      incomingSequenceEdgesByNode.get(edge.target)?.push(edge);
    }
  }

  function artifactPortLabel(edge: RunGraphEdge): string {
    return formatGraphEdge(edge) || "artifact";
  }

  function groupedArtifactPorts(nodeId: string, direction: "in" | "out"): Array<{
    key: string;
    label: string;
    title: string | null;
  }> {
    const sourceEdges = direction === "in"
      ? (incomingArtifactEdgesByNode.get(nodeId) || [])
      : (outgoingArtifactEdgesByNode.get(nodeId) || []);
    const groups = new Map<string, { key: string; label: string; title: string | null }>();
    for (const edge of sourceEdges) {
      const key = artifactPortKey(edge, direction);
      if (groups.has(key)) {
        continue;
      }
      groups.set(key, {
        key,
        label: artifactPortLabel(edge),
        title: formatGraphEdge(edge) || edge.label || edge.artifactPath || null,
      });
    }
    return [...groups.values()];
  }

  function railWidthFor(node: RunGraphNode): number {
    const incomingLabels = groupedArtifactPorts(node.id, "in").map((entry) => entry.label);
    const outgoingLabels = groupedArtifactPorts(node.id, "out").map((entry) => entry.label);
    const longestRailLabel = Math.max(
      0,
      ...incomingLabels.map((label) => label.length),
      ...outgoingLabels.map((label) => label.length),
    );
    return Math.max(92, Math.min(180, longestRailLabel * 7 + 34));
  }

  function nodeWidthFor(node: RunGraphNode): number {
    const title = stepDisplayName(node);
    const parameterText = Array.isArray(node.parameters) ? node.parameters.join(" · ") : "";
    const centerWidth = Math.max(
      150,
      title.length * 9 + 56,
      parameterText.length > 0 ? parameterText.length * 7 + 32 : 0,
    );
    const railWidth = railWidthFor(node);
    return Math.max(minNodeWidth, centerWidth + railWidth * 2);
  }

  function nodeHeightFor(node: RunGraphNode, width: number): number {
    const nodeId = node.id;
    const inputCount = groupedArtifactPorts(nodeId, "in").length;
    const outputCount = groupedArtifactPorts(nodeId, "out").length;
    const sequenceCount = Math.max(
      (incomingSequenceEdgesByNode.get(nodeId)?.length || 0) > 0 ? 1 : 0,
      (outgoingSequenceEdgesByNode.get(nodeId)?.length || 0) > 0 ? 1 : 0,
    );
    const portRows = Math.max(inputCount, outputCount) + sequenceCount;
    const centerWidth = Math.max(140, width - 184);
    const title = stepDisplayName(node);
    const parameterText = Array.isArray(node.parameters) ? node.parameters.join(" · ") : "";
    const titleLines = Math.max(1, Math.ceil((title.length * 9) / centerWidth));
    const parameterLines = parameterText ? Math.max(1, Math.ceil((parameterText.length * 7) / centerWidth)) : 0;
    const headerHeight = 22 + titleLines * 20;
    const bodyHeight = parameterLines > 0 ? 20 + parameterLines * 18 : 18;
    const contentHeight = headerHeight + bodyHeight + 20;
    const railHeight = 50 + portRows * 24;
    return Math.max(96, contentHeight, railHeight);
  }

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, RunGraphEdge[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const levelById = new Map<string, number>();
  for (const node of nodes) {
    levelById.set(node.id, 0);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }
    const level = levelById.get(nodeId) || 0;
    for (const edge of outgoing.get(nodeId) || []) {
      levelById.set(edge.target, Math.max(levelById.get(edge.target) || 0, level + 1));
      indegree.set(edge.target, (indegree.get(edge.target) || 1) - 1);
      if ((indegree.get(edge.target) || 0) === 0) {
        queue.push(edge.target);
      }
    }
  }

  const nodesByLevel = new Map<number, RunGraphNode[]>();
  for (const node of nodes) {
    const level = levelById.get(node.id) || 0;
    const bucket = nodesByLevel.get(level) || [];
    bucket.push(node);
    nodesByLevel.set(level, bucket);
  }

  const sortedLevels = [...nodesByLevel.keys()].sort((left, right) => left - right);
  const columnWidths = new Map<number, number>();
  for (const level of sortedLevels) {
    const width = Math.max(...(nodesByLevel.get(level) || []).map((node) => nodeWidthFor(node)));
    columnWidths.set(level, width);
  }

  const columnX = new Map<number, number>();
  let currentX = 0;
  for (const level of sortedLevels) {
    columnX.set(level, currentX);
    currentX += (columnWidths.get(level) || minNodeWidth) + 140;
  }

  const positioned: PositionedGraphNode[] = [];
  for (const level of sortedLevels) {
    const columnNodes = (nodesByLevel.get(level) || [])
      .slice()
      .sort((left, right) => (nodeOrderById.get(left.id) || 0) - (nodeOrderById.get(right.id) || 0));
    let currentY = 0;
    for (const node of columnNodes) {
      const width = nodeWidthFor(node);
      const height = nodeHeightFor(node, width);
      const railWidth = railWidthFor(node);
      const inputGroups = groupedArtifactPorts(node.id, "in");
      const outputGroups = groupedArtifactPorts(node.id, "out");
      const sequenceInEdge = incomingSequenceEdgesByNode.get(node.id)?.[0] || null;
      const sequenceOutEdge = outgoingSequenceEdgesByNode.get(node.id)?.[0] || null;
      const x = columnX.get(level) || 0;
      const y = currentY;
      positioned.push({
        id: node.id,
        name: node.name ?? null,
        kind: node.kind ?? null,
        status: node.status ?? "unknown",
        artifactCount: node.artifactCount ?? 0,
        parameters: node.parameters,
        stepOrder: nodeOrderById.get(node.id) ?? null,
        x,
        y,
        width,
        height,
        railWidth,
        centerX: x + width / 2,
        centerY: y + height / 2,
        ports: {
          inputs: inputGroups.map((entry, index) => ({
            id: `artifact-in:${entry.key}`,
            kind: "artifact-in" as const,
            label: entry.label,
            title: entry.title,
            side: "left" as const,
            x: 0,
            y: inputGroups.length <= 1 ? 56 : 40 + index * 24,
          })),
          outputs: outputGroups.map((entry, index) => ({
            id: `artifact-out:${entry.key}`,
            kind: "artifact-out" as const,
            label: entry.label,
            title: entry.title,
            side: "right" as const,
            x: width,
            y: outputGroups.length <= 1 ? 56 : 40 + index * 24,
          })),
          sequenceIn: sequenceInEdge
            ? {
                id: `${sequenceInEdge.id}:sequence-in`,
                kind: "sequence-in" as const,
                label: null,
                title: formatGraphEdge(sequenceInEdge) || null,
                side: "top" as const,
                x: width / 2,
                y: 0,
              }
            : null,
          sequenceOut: sequenceOutEdge
            ? {
                id: `${sequenceOutEdge.id}:sequence-out`,
                kind: "sequence-out" as const,
                label: null,
                title: formatGraphEdge(sequenceOutEdge) || null,
                side: "bottom" as const,
                x: width / 2,
                y: height,
              }
            : null,
        },
      });
      currentY += height + 72;
    }
  }

  const byId = new Map(positioned.map((node) => [node.id, node]));
  const routedEdges: RoutedGraphEdge[] = edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      return [];
    }
    const sourceHandle = edge.kind === "artifact"
      ? `artifact-out:${artifactPortKey(edge, "out")}`
      : `${edge.id}:sequence-out`;
    const targetHandle = edge.kind === "artifact"
      ? `artifact-in:${artifactPortKey(edge, "in")}`
      : `${edge.id}:sequence-in`;
    const sourcePort = edge.kind === "artifact"
      ? source.ports.outputs.find((port) => port.id === sourceHandle) || null
      : source.ports.sequenceOut;
    const targetPort = edge.kind === "artifact"
      ? target.ports.inputs.find((port) => port.id === targetHandle) || null
      : target.ports.sequenceIn;
    const sourcePoint = sourcePort
      ? { x: source.x + sourcePort.x, y: source.y + sourcePort.y }
      : { x: source.x + source.width, y: source.y + source.height / 2 };
    const targetPoint = targetPort
      ? { x: target.x + targetPort.x, y: target.y + targetPort.y }
      : { x: target.x, y: target.y + target.height / 2 };
    const midX = Math.round((sourcePoint.x + targetPoint.x) / 2);
    return [{
      ...edge,
      sourceHandle,
      targetHandle,
      points: edge.kind === "artifact"
        ? [
            sourcePoint,
            { x: midX, y: sourcePoint.y },
            { x: midX, y: targetPoint.y },
            targetPoint,
          ]
        : [
            sourcePoint,
            { x: sourcePoint.x, y: sourcePoint.y + 28 },
            { x: targetPoint.x, y: sourcePoint.y + 28 },
            targetPoint,
          ],
    }];
  });

  return {
    width: positioned.length > 0 ? Math.max(...positioned.map((node) => node.x + node.width)) + 80 : 0,
    height: positioned.length > 0 ? Math.max(...positioned.map((node) => node.y + node.height)) + 80 : 0,
    nodes: positioned,
    edges: routedEdges,
  };
}
