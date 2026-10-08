/**
 * SDG extraction: the auditable ruleset.
 *
 * Output sections (one row per item; the collector sorts by section and
 * key for the deterministic byte-level output):
 *   sources     classified reads
 *   sinks       fired sink contracts
 *   self_edges  boundary conditions on a single node
 *   cross_edges preconditions between two nodes
 *   heads       head-model coverage
 *   predicates  predicate-model coverage
 *   rules       assembled rules
 *
 * The query is the main implementation; tests/fixtures pin the expected
 * behavior per scenario.
 */

import cpp
import SdgModel
import SdgSurfaces
import SdgSinks
import SdgSources
import SdgSelfEdges
import SdgEdges

// Per-head and per-predicate-kind instance counts for the coverage sections.
predicate headInstance(string head, string instanceKey) {
  exists(string sePred | sdgSelfEdgeRow(_, head, sePred, _) |
    exists(string nid | sdgSelfEdgeRow(nid, head, sePred, _) |
      instanceKey = nid + "|" + sePred))
  or
  exists(SdgCrossEdge e | e.getHead() = head and
    instanceKey = e.getSrcId() + "->" + e.getDstId())
}

predicate predicateKindInstance(string kind, string instanceKey) {
  exists(string nid, string head, string sePred |
    sdgSelfEdgeRow(nid, head, sePred, _) and
    predicateKind(sePred) = kind |
    instanceKey = nid + "|" + sePred)
  or
  exists(SdgCrossEdge e | predicateKind(e.getPred()) = kind and
    instanceKey = e.getSrcId() + "->" + e.getDstId())
  or
  exists(string rid, string tp | sdgRuleRow(_, rid, tp, _) |
    predicateKind(tp) = kind and instanceKey = rid)
}

from string section, string key, string json
where
  // sources: classified reads.
  (section = "sources" and
   exists(SdgSourceNode n | key = n.getId() and json = n.getAuditJSON()))
  or
  // sinks: fired sink contracts.
  (section = "sinks" and
   exists(SdgSink s | key = s.getContractName() + "@" +
     jsonLocation(s).replaceAll("\"", "") and json = s.getAuditJSON()))
  or
  // self_edges: boundary conditions on a single node.
  (section = "self_edges" and
   exists(string nid, string seHead, string sePred |
     sdgSelfEdgeRow(nid, seHead, sePred, json) |
     key = nid + "|" + seHead + "|" + sePred))
  or
  // cross_edges: preconditions between two nodes.
  (section = "cross_edges" and
   exists(SdgCrossEdge e | key = e.getSrcId() + "->" + e.getDstId() and
     json = e.getAuditJSON()))
  or
  // heads: head-model coverage with instance counts.
  (section = "heads" and sdgHead(key) and
   json = "{\"count\":" + count(string ik | headInstance(key, ik)).toString() + "}")
  or
  // predicates: predicate-model coverage with instance counts.
  (section = "predicates" and sdgPredicateKind(key) and
   json = "{\"count\":" + count(string ik | predicateKindInstance(key, ik)).toString() + "}")
  or
  // rules: assembled rules.
  (section = "rules" and sdgRuleRow(_, key, _, json))
select section, key, json
