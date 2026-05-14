"use client";

import { useEffect, useMemo, type CSSProperties } from "react";
import {
  Background,
  Controls,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";

import type { GraphLayout, PositionedGraphNode, RoutedGraphEdge } from "@/src/lib/graph-layout";

interface WorkflowFlowNodeData extends Record<string, unknown> {
  node: PositionedGraphNode;
  onSelect: (stepId: string) => void;
}

type WorkflowFlowNodeType = Node<WorkflowFlowNodeData, "workflow">;
type WorkflowFlowEdgeType = Edge<{
  edge: RoutedGraphEdge;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
}, "workflowEdge">;

function stepDisplayName(node: PositionedGraphNode): string {
  return node.name && node.name.trim() ? node.name : node.id;
}

function WorkflowFlowNode({ data, selected }: NodeProps<WorkflowFlowNodeType>) {
  const { node, onSelect } = data;
  return (
    <button
      className={`workflow-flow-node is-${node.status}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(node.id)}
      type="button"
      style={{
        ["--rail-width" as any]: `${node.railWidth}px`,
      } as CSSProperties}
    >
      <div className="workflow-flow-node-ports is-left">
        {node.ports.sequenceIn ? (
          <Handle
            className="workflow-flow-handle is-sequence is-hidden"
            id={node.ports.sequenceIn.id}
            position={Position.Left}
            style={{ top: `${node.ports.sequenceIn.y}px` }}
            type="target"
          />
        ) : null}
        {node.ports.inputs.map((port) => (
          <div
            className="workflow-flow-node-port is-input"
            key={port.id}
            style={{ top: `${port.y}px` }}
            title={port.title || undefined}
          >
            <span className="workflow-flow-node-port-label">{port.label || "input"}</span>
            <Handle
              className="workflow-flow-handle"
              id={port.id}
              position={Position.Left}
              style={{ top: "50%", transform: "translateY(-50%)" }}
              type="target"
            />
          </div>
        ))}
      </div>
      <div className="workflow-flow-node-main">
        <div className="workflow-flow-node-header">
          <div className="workflow-flow-node-header-title">
            {node.stepOrder != null ? <span className="workflow-flow-node-order">{node.stepOrder}</span> : null}
            <strong>{stepDisplayName(node)}</strong>
          </div>
        </div>
        <div className="workflow-flow-node-body">
          {Array.isArray(node.parameters) && node.parameters.length > 0 ? (
            <span className="workflow-graph-node-param">{node.parameters.join(" · ")}</span>
          ) : null}
          <span className={`workflow-status-text is-${node.status}`}>{node.status}</span>
        </div>
      </div>
      <div className="workflow-flow-node-ports is-right">
        {node.ports.outputs.map((port) => (
          <div
            className="workflow-flow-node-port is-output"
            key={port.id}
            style={{ top: `${port.y}px` }}
            title={port.title || undefined}
          >
            <Handle
              className="workflow-flow-handle"
              id={port.id}
              position={Position.Right}
              style={{ top: "50%", transform: "translateY(-50%)" }}
              type="source"
            />
            <span className="workflow-flow-node-port-label">{port.label || "output"}</span>
          </div>
        ))}
        {node.ports.sequenceOut ? (
          <Handle
            className="workflow-flow-handle is-sequence is-hidden"
            id={node.ports.sequenceOut.id}
            position={Position.Right}
            style={{ top: `${node.ports.sequenceOut.y}px` }}
            type="source"
          />
        ) : null}
      </div>
    </button>
  );
}

const workflowFlowNodeTypes = {
  workflow: WorkflowFlowNode,
} satisfies NodeTypes;

function polylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function WorkflowFlowEdge({ data, markerEnd }: EdgeProps<WorkflowFlowEdgeType>) {
  const edge = data?.edge;
  const path = polylinePath(edge?.points || []);
  if (!path) {
    return null;
  }
  return (
    <BaseEdge
      markerEnd={markerEnd}
      path={path}
      style={{
        stroke: data?.stroke,
        strokeWidth: data?.strokeWidth,
        strokeDasharray: data?.strokeDasharray,
        opacity: data?.opacity,
      }}
    />
  );
}

const workflowFlowEdgeTypes = {
  workflowEdge: WorkflowFlowEdge,
};

export function WorkflowInteractiveGraph({
  graphLayout,
  renderSequenceEdges,
  selectedStepId,
  onPaneReset,
  onSelectStep,
  onReady,
}: {
  graphLayout: GraphLayout;
  renderSequenceEdges: boolean;
  selectedStepId: string | null;
  onPaneReset: () => void;
  onSelectStep: (stepId: string) => void;
  onReady?: () => void;
}) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  const flowNodes = useMemo<WorkflowFlowNodeType[]>(
    () => (
      graphLayout.nodes.map((node) => ({
        id: node.id,
        type: "workflow",
        position: { x: node.x, y: node.y },
        selected: selectedStepId === node.id,
        zIndex: 1,
        draggable: false,
        style: { width: node.width, height: node.height },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { node, onSelect: onSelectStep },
      }))
    ),
    [graphLayout.nodes, onSelectStep, selectedStepId],
  );

  const flowEdges = useMemo<WorkflowFlowEdgeType[]>(
    () => (
      graphLayout.edges
        .filter((edge) => edge.kind === "artifact" || (renderSequenceEdges && edge.kind === "sequence"))
        .map((edge) => {
          const isArtifact = edge.kind === "artifact";
          const prominentSequence = renderSequenceEdges && edge.kind === "sequence";
          const stroke = isArtifact ? "#0f766e" : prominentSequence ? "#6f6558" : "#9a8d7a";
          const strokeWidth = isArtifact ? 2.5 : prominentSequence ? 2.25 : 1.75;
          const strokeDasharray = isArtifact ? undefined : prominentSequence ? "10 6" : "7 6";
          const opacity = edge.inferred
            ? (prominentSequence ? 0.9 : 0.5)
            : isArtifact
              ? 0.92
              : prominentSequence
                ? 0.9
                : 0.75;
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle || undefined,
            targetHandle: edge.targetHandle || undefined,
            type: "workflowEdge",
            zIndex: 0,
            data: { edge, stroke, strokeWidth, strokeDasharray, opacity },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: stroke,
            },
          };
        })
    ),
    [graphLayout.edges, renderSequenceEdges],
  );

  return (
    <ReactFlow<WorkflowFlowNodeType, WorkflowFlowEdgeType>
      className="workflow-graph-flow"
      colorMode="light"
      defaultEdgeOptions={{ type: "workflowEdge" }}
      edgeTypes={workflowFlowEdgeTypes}
      edges={flowEdges}
      fitView
      fitViewOptions={{ padding: 0.12, includeHiddenNodes: false, minZoom: 0.45 }}
      maxZoom={1.5}
      minZoom={0.45}
      nodeTypes={workflowFlowNodeTypes}
      nodes={flowNodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodesFocusable={false}
      onPaneClick={onPaneReset}
      panOnDrag
      panOnScroll
      selectionOnDrag={false}
      zoomOnDoubleClick={false}
    >
      <Background gap={26} size={1} />
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
}
