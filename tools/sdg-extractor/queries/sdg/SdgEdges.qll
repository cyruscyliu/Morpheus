/**
 * Self-edges, cross-edges, and rules (grammar-extraction.md sections 3, 4).
 *
 * Self-edge heads: head_guard for a comparison that is a real guard
 * condition, head_bound for clamp and capacity bounds, head_offset for
 * loop-counter facts. Cross-edge heads: head_dataflow links an
 * internal-state value to its physical origin.
 *
 * The guard/head distinction uses the CodeQL dominance machinery: a
 * comparison is a guard when the IR guard analysis makes it one.
 */

import cpp
import semmle.code.cpp.dataflow.new.DataFlow
import semmle.code.cpp.controlflow.Guards
import SdgModel
import SdgSurfaces
import SdgSinks
import SdgSources
import SdgSelfEdges

//===----------------------------------------------------------------------===//
// Guard analysis
//===----------------------------------------------------------------------===//

/** Holds if the expression `e` is a real guard condition (it determines a
    branch), per the IR guard analysis. */
predicate exprIsGuard(Expr e) {
  exists(GuardCondition g | g = e and g.controls(_, _))
  or
  exists(GuardCondition g, BinaryLogicalOperation op |
    g = op and g.controls(_, _) and
    (op.getLeftOperand().getFullyConverted() = e or
     op.getRightOperand().getFullyConverted() = e)
  )
}

/** Holds if the comparison `cmp` is a real guard condition. */
predicate comparisonIsGuard(ComparisonOperation cmp) { exprIsGuard(cmp) }

/** The predicate text of `cmp` oriented on its surface-derived operand. */
bindingset[cmp]
string derivedOrientationOf(ComparisonOperation cmp) {
  exists(Expr varOperand, SdgSourceNode read |
    comparisonPredicate(cmp, varOperand, result) and
    read = definingReadOf(varOperand)
  )
}

//===----------------------------------------------------------------------===//
// Static capacity of destination buffers
//===----------------------------------------------------------------------===//

/**
 * The base expression of `e` with casts stripped.
 */
Expr stripCastsOf(Expr e) {
  e instanceof Cast and result = stripCastsOf(e.(Cast).getExpr())
  or
  not e instanceof Cast and result = e
}

/**
 * The static byte capacity of the destination expression `dest`: the size
 * of a fixed-size array member or variable; for a flexible-array member
 * destination, the size of a fixed-size array overlapping the FAM's byte
 * offset in the same union scope (the trailing storage overlapping the
 * FAM).
 */
int destCapacityOf(Expr dest) {
  exists(VariableAccess access, MemberVariable mv, ArrayType at |
    stripCastsOf(dest) = access and
    access.getTarget() = mv and
    mv.getType() = at |
    result = at.getSize()
  )
  or
  exists(LocalScopeVariable v, ArrayType at |
    stripCastsOf(dest) = v.getAnAccess() and
    v.getType() = at |
    result = at.getSize()
  )
  or
  // `&vi->fam[0]` where fam is a flexible array member: the capacity is the
  // size of a fixed-size array at the same byte offset in the same union
  // scope.
  exists(AddressOfExpr addr, ArrayExpr arr, VariableAccess access, Field fam,
         int famOff, Type scope, Field overlap, Field nested, ArrayType at |
    stripCastsOf(dest) = addr and
    addr.getAnOperand() = arr and
    stripCastsOf(arr.getArrayBase()) = access and
    access.getTarget() = fam and
    famOff = fam.getByteOffset() and
    overlap.getType() = at and
    overlap.getByteOffset() = famOff and
    nested.getType() = overlap.getDeclaringType() and
    nested.getDeclaringType() = scope and
    exists(Field famHolder |
      famHolder.getType() = fam.getDeclaringType() and
      famHolder.getDeclaringType() = scope
    ) |
    result = at.getSize()
  )
}

/**
 * The destination-buffer expression the sink's contracted operand is
 * bounded by: the actual the destination formal receives at a callsite of
 * the sink's function, or the destination argument itself when it is not
 * a formal.
 */
Expr destActualOf(SdgSink s) {
  exists(Function f, Call c, int i |
    f = s.getEnclosingFunction() and
    f.getParameter(i) = s.getArgument(s.getDestArg()).(VariableAccess).getTarget() and
    c.getTarget() = f |
    result = c.getArgument(i)
  )
  or
  not exists(Function f, int i |
    f = s.getEnclosingFunction() and
    f.getParameter(i) = s.getArgument(s.getDestArg()).(VariableAccess).getTarget()
  ) and
  result = s.getArgument(s.getDestArg())
}

//===----------------------------------------------------------------------===//
// Self-edges
//===----------------------------------------------------------------------===//

/**
 * A boundary condition on a single classified read. One row per mechanism
 * solution; the node id, head, predicate, and json derive from the same
 * solution, and the site is the audited source construct.
 */
predicate sdgSelfEdgeRow(string nodeId, string head, string pred, string json) {
  // Pattern 1, direct comparison on a derived value: head_guard when the
  // comparison is a real guard condition, head_bound otherwise.
  exists(ComparisonOperation cmp, Expr varOperand, SdgSourceNode read |
    comparisonPredicate(cmp, varOperand, pred) and
    definingReadOf(varOperand) = read |
    nodeId = read.getId() and
    (exprIsGuard(cmp) and head = "head_guard"
     or
     not exprIsGuard(cmp) and head = "head_bound") and
    json = selfEdgeJSON(nodeId, head, pred, cmp)
  )
  or
  // Range synthesis: two comparisons of the same value in a conjunction
  // (logical `&&` or bitwise `&`).
  exists(BinaryOperation andOp, SdgSourceNode read |
    (andOp instanceof LogicalAndExpr or andOp instanceof BitwiseAndExpr) and
    rangePredicate(andOp, read, pred) |
    nodeId = read.getId() and
    (exprIsGuard(andOp) and head = "head_guard"
     or
     not exprIsGuard(andOp) and head = "head_bound") and
    json = selfEdgeJSON(nodeId, head, pred, andOp)
  )
  or
  // Mask truth tests: `x & mask` guards.
  exists(BitwiseAndExpr maskExpr, Expr varOperand, SdgSourceNode read |
    maskPredicate(maskExpr, varOperand, pred) and
    definingReadOf(varOperand) = read |
    nodeId = read.getId() and
    head = "head_guard" and
    json = selfEdgeJSON(nodeId, head, pred, maskExpr)
  )
  or
  // Helper-encapsulated checks: the comparison inside a boolean helper
  // definition that the derived value is passed to. Only the helper's
  // relevant comparisons (feeding a branch, a return, or a select
  // condition) bound the argument.
  exists(FunctionCall helperCall, ComparisonOperation cmp, Expr cmpOperand,
         int idx, SdgSourceNode read |
    idx >= 0 and idx < helperCall.getNumberOfArguments() and
    exists(helperCall.getTarget().getBlock()) and
    comparisonPredicate(cmp, cmpOperand, pred) and
    definingReadOf(cmpOperand) = read and
    // The compared value reaches the helper as an actual argument.
    ReadFlow::flow(DataFlow::exprNode(read), DataFlow::exprNode(helperCall.getArgument(idx))) and
    // The comparison is relevant to the helper's boolean result.
    (
      exprIsGuard(cmp)
      or
      exists(ReturnStmt r | r.getAChild() = cmp)
      or
      exists(ConditionalExpr co | co.getCondition() = cmp)
    ) |
    nodeId = read.getId() and
    (exprIsGuard(helperCall) and head = "head_guard"
     or
     not exprIsGuard(helperCall) and head = "head_bound") and
    json = selfEdgeJSON(nodeId, head, pred, helperCall)
  )
  or
  // Feature-bit gates: a bit-test helper call in a guard condition with
  // a constant cataloged bit yields BitSet(bit) on the features node.
  exists(BitTestSource node, int fbit, int bitValue |
    bitTestHelper(normalizeCalleeName(node.getTarget().getName()), _, fbit, _) and
    fbit < node.getNumberOfArguments() and
    bitValue = constValueOf(node.getArgument(fbit)) and
    featureBitName(bitValue) != "" and
    exists(GuardCondition g | g = node and g.controls(_, _)) |
    pred = bitSetPred(bitValue) and
    nodeId = node.getId() and
    head = "head_guard" and
    json = selfEdgeJSON(nodeId, head, pred, node)
  )
  or
  // Plain truth tests: a guard on the value itself. The condition must be
  // a real guard condition, not any expression with surface provenance.
  exists(Expr cond, Expr varOperand, SdgSourceNode read |
    truthPredicate(cond, varOperand, pred) and
    definingReadOf(varOperand) = read and
    exists(GuardCondition g | g = cond and g.controls(_, _)) |
    nodeId = read.getId() and
    head = "head_guard" and
    json = selfEdgeJSON(nodeId, head, pred, cond)
  )
  or
  // Clamp bounds: min_t / max_t.
  exists(Assignment assign, Expr varOperand, SdgSourceNode read |
    clampBound(assign, varOperand, pred) and
    definingReadOf(varOperand) = read |
    nodeId = read.getId() and
    head = "head_bound" and
    json = selfEdgeJSON(nodeId, head, pred, assign)
  )
  or
  // Loop-counter bounds (offset facts): the bound of a counter that is
  // used as an array offset in the same function.
  exists(Function f, LocalScopeVariable counter, SdgSourceNode read,
         ComparisonOperation cmp, VariableAccess ca |
    counterBound(f, counter, pred) and
    f = read.getEnclosingFunction() and
    exists(ArrayExpr arr |
      arr.getEnclosingFunction() = f and
      ca.getTarget() = counter and
      arr.getArrayOffset().getFullyConverted() = ca
    ) and
    (cmp.getLeftOperand().getFullyConverted() = ca or
     cmp.getRightOperand().getFullyConverted() = ca) |
    nodeId = read.getId() and
    head = "head_offset" and
    json = selfEdgeJSON(nodeId, head, pred, cmp)
  )
  or
  // Call contracts: the static capacity of a destination buffer bounds the
  // size operand of a fired sink (pattern 3 lowering). The capacity
  // resolves through the destination formal's actual argument.
  exists(SdgSink sink, int cap, SdgSourceNode read, Expr dest |
    sink.getDestArg() >= 0 and
    dest = destActualOf(sink) and
    cap = destCapacityOf(dest) and
    definingReadOf(sink.getArgument(sink.getArgIndex())) = read |
    pred = relPred("Gt", cap, "unsigned") and
    nodeId = read.getId() and
    head = "head_bound" and
    json = selfEdgeJSON(nodeId, head, pred, sink)
  )
}

/** The JSON object for a self-edge row as it appears in the audit
    document. */
bindingset[nodeId, head, pred, site]
private string selfEdgeJSON(string nodeId, string head, string pred,
                            Expr site) {
  result = "{\"node\":" + jsonString(nodeId) +
           ",\"head\":" + jsonString(head) +
           ",\"predicate\":" + predicateJSON(pred) +
           ",\"function\":" + jsonString(site.getEnclosingFunction().getName()) +
           ",\"location\":" + jsonLocation(site) + "}"
}

//===----------------------------------------------------------------------===//
// Cross-edges
//===----------------------------------------------------------------------===//

/**
 * A precondition between two nodes. head_dataflow links an internal-state
 * value to the physical read its value came from.
 */
class SdgCrossEdge extends Expr {
  SdgSourceNode dstNode;
  string edgeHead;
  string edgePred;
  SdgSourceNode srcNode;

  SdgCrossEdge() {
    // head_dataflow: an internal-state value linked to its physical origin.
    exists(SdgSourceNode internal, SdgSourceNode origin |
      this = internal and
      internal instanceof InternalStateRead and
      not origin instanceof InternalStateRead and
      origin.getRoot() = internal.getRoot() and
      ReadFlow::flow(DataFlow::exprNode(origin), DataFlow::exprNode(internal)) |
      dstNode = internal and
      srcNode = origin and
      edgeHead = "head_dataflow" and
      edgePred = identityPred()
    )
  }

  /** The head of this edge. */
  string getHead() { result = edgeHead }

  /** The canonical predicate text of this edge. */
  string getPred() { result = edgePred }

  /** The canonical node id of the source node. */
  string getSrcId() { result = srcNode.getId() }

  /** The canonical node id of the destination node. */
  string getDstId() { result = dstNode.getId() }

  /** The JSON object for this edge as it appears in the audit document. */
  string getAuditJSON() {
    result = "{\"src\":" + jsonString(this.getSrcId()) +
             ",\"dst\":" + jsonString(this.getDstId()) +
             ",\"head\":" + jsonString(edgeHead) +
             ",\"predicate\":" + predicateJSON(edgePred) +
             ",\"function\":" + jsonString(this.getEnclosingFunction().getName()) +
             ",\"location\":" + jsonLocation(this) + "}"
  }
}

//===----------------------------------------------------------------------===//
// Mutations
//===----------------------------------------------------------------------===//

/** The mutation JSON for a canonical predicate text. */
bindingset[pred]
string mutationJSON(string pred) {
  predicateKind(pred) = "BitSet" and
  result = "{\"operator\":\"SetBits\",\"mask\":" + pow2Of(predicateBit(pred)).toString() + "}"
  or
  predicateKind(pred) = "BitClear" and
  result = "{\"operator\":\"ClearBits\",\"mask\":" + pow2Of(predicateBit(pred)).toString() + "}"
  or
  predicateKind(pred) = "Eq" and
  result = "{\"operator\":\"SetValue\",\"value\":" + predicateValue(pred).toString() + "}"
  or
  (predicateKind(pred) = "Gt" or predicateKind(pred) = "Ge") and
  result = "{\"operator\":\"SetBoundary\",\"side\":\"Above\",\"value\":" +
           predicateValue(pred).toString() + "}"
  or
  (predicateKind(pred) = "Lt" or predicateKind(pred) = "Le") and
  result = "{\"operator\":\"SetBoundary\",\"side\":\"Below\",\"value\":" +
           predicateValue(pred).toString() + "}"
  or
  predicateKind(pred) = "InRange" and
  result = "{\"operator\":\"SampleRange\",\"min\":" + predicateMin(pred).toString() +
           ",\"max\":" + predicateMax(pred).toString() + "}"
  or
  (predicateKind(pred) = "Ne" or predicateKind(pred) = "Identity") and
  result = "{\"operator\":\"Keep\"}"
}

/** The mutation JSON with the rule's target variable. */
bindingset[pred, var]
string mutationJSONWithVar(string pred, string var) {
  predicateKind(pred) = "Gt" and
  result = "{\"operator\":\"SetBoundary\",\"side\":\"Above\",\"value\":" +
           predicateValue(pred).toString() + ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "Ge" and
  result = "{\"operator\":\"SetBoundary\",\"side\":\"Above\",\"value\":" +
           predicateValue(pred).toString() + ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "Lt" and
  result = "{\"operator\":\"SetBoundary\",\"side\":\"Below\",\"value\":" +
           predicateValue(pred).toString() + ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "Le" and
  result = "{\"operator\":\"SetBoundary\",\"side\":\"Below\",\"value\":" +
           predicateValue(pred).toString() + ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "BitSet" and
  result = "{\"operator\":\"SetBits\",\"mask\":" + pow2Of(predicateBit(pred)).toString() +
           ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "BitClear" and
  result = "{\"operator\":\"ClearBits\",\"mask\":" + pow2Of(predicateBit(pred)).toString() +
           ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "Eq" and
  result = "{\"operator\":\"SetValue\",\"value\":" + predicateValue(pred).toString() +
           ",\"var\":" + jsonString(var) + "}"
  or
  predicateKind(pred) = "InRange" and
  result = "{\"operator\":\"SampleRange\",\"min\":" + predicateMin(pred).toString() +
           ",\"max\":" + predicateMax(pred).toString() + ",\"var\":" + jsonString(var) + "}"
  or
  (predicateKind(pred) = "Ne" or predicateKind(pred) = "Identity") and
  result = "{\"operator\":\"Keep\",\"var\":" + jsonString(var) + "}"
}

//===----------------------------------------------------------------------===//
// Rules
//===----------------------------------------------------------------------===//

/** The confidence score of a trigger predicate. */
bindingset[pred]
float triggerConfidence(string pred) {
  predicateKind(pred) != "Ne" and predicateKind(pred) != "Identity" and
  result = 0.7
  or
  (predicateKind(pred) = "Ne" or predicateKind(pred) = "Identity") and
  result = 0.5
}

/**
 * An assembled rule: a physically resolvable physical-origin source, a
 * trigger predicate, and the fired sink evidence. One row per
 * (sink, trigger); the id, predicate, and json derive from the same
 * trigger solution.
 */
predicate sdgRuleRow(SdgSink sink, string id, string pred, string json) {
  exists(Expr arg, SdgSourceNode proximate, SdgSourceNode ruleSource,
         string triggerHead, string triggerPred |
    arg = sink.getArgument(sink.getArgIndex()) and
    proximate = definingReadOf(arg) and
    // Internal-state values resolve to the physical read their value came
    // from.
    ruleSource = physicalOriginOf(proximate) and
    ruleSource.isPhysicallyResolvable() and
    // The trigger: a self-edge on the physical origin (never Ne), or the
    // destination-capacity bound when no self-edge bounds the value.
    (
      exists(string seHead, string sePred |
        sdgSelfEdgeRow(ruleSource.getId(), seHead, sePred, _) and
        predicateKind(sePred) != "Ne" |
        triggerHead = seHead and triggerPred = sePred
      )
      or
      (sink.getDestArg() >= 0 and
       not exists(string sePred |
         sdgSelfEdgeRow(ruleSource.getId(), _, sePred, _) and
         predicateKind(sePred) != "Ne") and
       exists(int cap, Expr dest |
         dest = destActualOf(sink) and
         cap = destCapacityOf(dest) |
         triggerHead = "head_bound" and
         triggerPred = relPred("Gt", cap, "unsigned")
       ))
    ) |
    id = "rule:" + sink.getEnclosingFunction().getName() +
         "|target:" + ruleSource.getId() +
         "|predicate:" + triggerPred and
    pred = triggerPred and
    json = "{\"id\":" + jsonString(id) +
           ",\"function\":" + jsonString(sink.getEnclosingFunction().getName()) +
           ",\"vars\":[" +
           "{\"id\":" + jsonString(ruleSource.getId()) +
           ",\"source\":" + ruleSource.getSourceJSON() + "}]" +
           ",\"preconditions\":[]," +
           "\"target_state\":{\"src\":" + jsonString(ruleSource.getId()) +
           ",\"dst\":" + jsonString(ruleSource.getId()) +
           ",\"head\":" + jsonString(triggerHead) +
           ",\"predicate\":" + predicateJSON(triggerPred) + "}" +
           ",\"mutation\":" + mutationJSONWithVar(triggerPred, ruleSource.getId()) +
           ",\"confidence\":" + triggerConfidence(triggerPred).toString() + "}"
  )
}
