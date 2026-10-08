/**
 * Self-edges: boundary conditions on a single node (grammar-extraction.md
 * 3.2), and the predicate-shape analysis shared with guard cross-edges.
 *
 * Self-edge mechanisms:
 * - Pattern 1, direct comparison: a derived value compared against an
 *   integer constant. The predicate kind follows the comparison; the head
 *   is head_guard when the comparison guards a region (a real guard
 *   condition), head_bound otherwise.
 * - Pattern 2, helper-encapsulated check: the comparison lives inside a
 *   noinline boolean helper that the derived value is passed to. Only the
 *   helper's relevant comparisons (used by a branch, a return, or a select
 *   condition) bound the argument.
 * - Pattern 3, missing check: a derived value reaches a size/index sink
 *   with no dominating relational comparison. This is a low-confidence
 *   analysis finding; it is lowered into an executable rule only when the
 *   destination's static capacity bounds it (Rules.qll).
 * - Range synthesis: two comparisons of the same derived value feeding the
 *   same conjunction become InRange(min, max).
 * - Mask truth tests: `x & mask` yields one BitSet per set bit, BitClear
 *   under an odd number of logical negations.
 * - Truth tests: a plain guard on the derived value yields Ne(0); a
 *   negated guard yields Eq(0).
 * - Offset facts: a loop counter bound used as an array index yields
 *   head_offset edges.
 * - Call contracts: the sink contract is a head_call self-edge on the
 *   tracked operand, with the bound established by a comparison on the
 *   same variable.
 */

import cpp
import semmle.code.cpp.controlflow.Guards
import semmle.code.cpp.dataflow.new.DataFlow
import SdgModel
import SdgSurfaces
import SdgSinks
import SdgSources

//===----------------------------------------------------------------------===//
// Node tracking
//===----------------------------------------------------------------------===//

/**
 * The classified read whose value `e`'s value came from. The operand may
 * itself be the read site, or its value may be derived from one through the
 * global data-flow graph. A provenance root shared by several reads does
 * not conflate them: the flow path from a read to `e` must not pass
 * through another read site, which names the proximate read.
 */
SdgSourceNode definingReadOf(Expr e) {
  exists(SdgSourceNode read, SurfaceRootCall root |
    read.getRoot() = root and
    exprSurface(e, root) and
    (read = e or ReadFlow::flow(DataFlow::exprNode(read), DataFlow::exprNode(e))) and
    not exists(SdgSourceNode other |
      other != read and other.getRoot() = root and
      ReadFlow::flow(DataFlow::exprNode(read), DataFlow::exprNode(other)) and
      (other = e or ReadFlow::flow(DataFlow::exprNode(other), DataFlow::exprNode(e)))
    )
  |
    result = read
  )
}

//===----------------------------------------------------------------------===//
// Comparison predicates
//===----------------------------------------------------------------------===//

/** The signedness of a comparison's domain: C comparisons on unsigned
    types are unsigned; anything else is signed. */
private string operandSignedness(ComparisonOperation cmp) {
  cmp.getLeftOperand().getFullyConverted().getType().(IntegralType).isUnsigned() and
  result = "Unsigned"
  or
  not cmp.getLeftOperand().getFullyConverted().getType().(IntegralType).isUnsigned() and
  result = "Signed"
}

/**
 * The predicate of a comparison between a derived value and an integer
 * constant, on the derived side `varOperand`.
 */
predicate comparisonPredicate(ComparisonOperation cmp, Expr varOperand,
                              string pred) {
  exists(int c, string signedness |
    varOperand = cmp.getLeftOperand() and
    c = constValueOf(cmp.getRightOperand()) and
    signedness = operandSignedness(cmp) and
    (cmp instanceof EQExpr and pred = eqPred(c)
     or
     cmp instanceof NEExpr and pred = nePred(c)
     or
     cmp instanceof LTExpr and pred = relPred("Lt", c, signedness)
     or
     cmp instanceof GTExpr and pred = relPred("Gt", c, signedness)
     or
     cmp instanceof LEExpr and pred = relPred("Le", c, signedness)
     or
     cmp instanceof GEExpr and pred = relPred("Ge", c, signedness))
  )
  or
  exists(int c, string signedness |
    // const < var  ==  var > const, and so on.
    varOperand = cmp.getRightOperand() and
    c = constValueOf(cmp.getLeftOperand()) and
    signedness = operandSignedness(cmp) and
    (cmp instanceof EQExpr and pred = eqPred(c)
     or
     cmp instanceof NEExpr and pred = nePred(c)
     or
     cmp instanceof LTExpr and pred = relPred("Gt", c, signedness)
     or
     cmp instanceof GTExpr and pred = relPred("Lt", c, signedness)
     or
     cmp instanceof LEExpr and pred = relPred("Ge", c, signedness)
     or
     cmp instanceof GEExpr and pred = relPred("Le", c, signedness))
  )
}

//===----------------------------------------------------------------------===//
// Logical negation depth
//===----------------------------------------------------------------------===//

/** The number of logical negations enclosing `inner` up the AST. */
private int negDepthOf(Expr inner) {
  not exists(NotExpr ne | inner.getParent() = ne) and result = 0
  or
  exists(NotExpr ne |
    inner.getParent() = ne and
    result = 1 + negDepthOf(ne)
  )
}

/** Holds if an even number of logical negations encloses `inner`. */
private predicate polarityIsSet(Expr inner) { negDepthOf(inner) % 2 = 0 }

//===----------------------------------------------------------------------===//
// Mask truth tests
//===----------------------------------------------------------------------===//

/**
 * The mask truth test: `var & mask` with a constant mask yields one
 * BitSet per set bit; an odd number of logical negations yields BitClear.
 */
predicate maskPredicate(BitwiseAndExpr maskExpr, Expr varOperand,
                        string pred) {
  exists(int mask, int bit |
    varOperand = maskExpr.getLeftOperand() and
    mask = maskValueOf(maskExpr.getRightOperand()) and
    bit in [0..31] and
    mask.bitAnd(pow2Of(bit)) = pow2Of(bit) and
    (polarityIsSet(maskExpr) and pred = bitSetPred(bit)
     or
     not polarityIsSet(maskExpr) and pred = bitClearPred(bit))
  )
  or
  exists(int mask, int bit |
    varOperand = maskExpr.getRightOperand() and
    mask = maskValueOf(maskExpr.getLeftOperand()) and
    bit in [0..31] and
    mask.bitAnd(pow2Of(bit)) = pow2Of(bit) and
    (polarityIsSet(maskExpr) and pred = bitSetPred(bit)
     or
     not polarityIsSet(maskExpr) and pred = bitClearPred(bit))
  )
}

//===----------------------------------------------------------------------===//
// Truth tests
//===----------------------------------------------------------------------===//

/**
 * A plain truth test on a derived value: a guard on the value yields
 * Ne(0); a negated guard yields Eq(0).
 */
predicate truthPredicate(Expr cond, Expr varOperand, string pred) {
  exists(SurfaceRootCall root |
    cond.getFullyConverted() = varOperand and
    exprSurface(varOperand, root) |
    pred = nePred(0)
  )
  or
  exists(NotExpr ne, SurfaceRootCall root |
    cond.getFullyConverted() = ne and
    ne.getAnOperand() = varOperand and
    exprSurface(varOperand, root) |
    pred = eqPred(0)
  )
}

//===----------------------------------------------------------------------===//
// Range synthesis
//===----------------------------------------------------------------------===//

/** The constant of a lower-bound comparison (`v >= c` / `v > c` in either
    orientation). */
private int rangeMin(ComparisonOperation lower) {
  (lower instanceof GEExpr or lower instanceof GTExpr) and
  (result = constValueOf(lower.getRightOperand())
   or
   result = constValueOf(lower.getLeftOperand()))
}

/** The constant of an upper-bound comparison (`v <= c` / `v < c` in either
    orientation). */
private int rangeMax(ComparisonOperation upper) {
  (upper instanceof LEExpr or upper instanceof LTExpr) and
  (result = constValueOf(upper.getRightOperand())
   or
   result = constValueOf(upper.getLeftOperand()))
}

/**
 * Range synthesis: two comparisons of the same derived value feeding the
 * same conjunction (logical `&&` or bitwise `&`) become InRange(min, max).
 * Signed bounds keep their two-complement pattern at the source width. The
 * comparisons' operands are distinct AST nodes; both must derive from the
 * same classified read.
 */
predicate rangePredicate(BinaryOperation andOp, SdgSourceNode read, string pred) {
  exists(ComparisonOperation left, ComparisonOperation right,
         int mn, int mx, string signedness, int widthBits,
         Expr leftOperand, Expr rightOperand |
    comparisonPredicate(left, leftOperand, _) and
    comparisonPredicate(right, rightOperand, _) and
    (andOp instanceof LogicalAndExpr or andOp instanceof BitwiseAndExpr) and
    left = andOp.getLeftOperand() and
    right = andOp.getRightOperand() and
    signedness = operandSignedness(left) and
    (
      // Lower bound on the left, upper bound on the right.
      mn = rangeMin(left) and mx = rangeMax(right)
      or
      // Upper bound on the left, lower bound on the right.
      mn = rangeMin(right) and mx = rangeMax(left)
    ) and
    widthBits = read.getSizeBytes() * 8 and
    definingReadOf(leftOperand) = read and
    definingReadOf(rightOperand) = read and
    // Compare the encoded bounds under the predicate's signedness: signed
    // bounds compare by two-complement pattern, unsigned by raw value.
    (
      signedness = "Signed" and
      (mn >= 0 or mx >= 0 or widthPatternValue(mn, widthBits) <= widthPatternValue(mx, widthBits))
      or
      signedness = "Unsigned" and mn <= mx
    ) and
    (
      signedness = "Signed" and
      pred = inRangePred(widthPatternOf(mn, widthBits), widthPatternOf(mx, widthBits), signedness)
      or
      signedness = "Unsigned" and pred = inRangePred(mn, mx, signedness)
    )
  )
}

/** The two-complement pattern of a signed value at `widthBits`. */
bindingset[value, widthBits]
private int widthPatternOf(int value, int widthBits) {
  value >= 0 and result = value
  or
  value < 0 and widthBits = 8 and result = 256 + value
  or
  value < 0 and widthBits = 16 and result = 65536 + value
  or
  value < 0 and widthBits = 32 and result = (2147483647 + 1) * 2 + value
}

/** The signed value of a two-complement pattern at `widthBits`. */
bindingset[pattern, widthBits]
private int widthPatternValue(int pattern, int widthBits) {
  widthBits = 8 and
  (pattern < 128 and result = pattern or pattern >= 128 and result = pattern - 256)
  or
  widthBits = 16 and
  (pattern < 32768 and result = pattern or pattern >= 32768 and result = pattern - 65536)
  or
  widthBits = 32 and
  (pattern < 2147483647 and result = pattern or
   pattern >= 2147483647 and result = pattern - (2147483647 + 1) * 2)
}

//===----------------------------------------------------------------------===//
// Clamp bounds (min_t / max_t)
//===----------------------------------------------------------------------===//

/**
 * A min_t / max_t clamp: a statement expression whose value is a ternary
 * with a constant-compared condition and arms selecting the compared
 * operands bounds the assigned node at the constant. min_t bounds from
 * above (Le); max_t from below (Ge).
 */
predicate clampBound(Assignment assign, Expr varOperand, string pred) {
  exists(StmtExpr se, ConditionalExpr co, ComparisonOperation cmp, int c,
         string signedness, Expr trueArm, Expr falseArm, Expr condLeft, Expr condRight |
    assign.getRValue() = se and
    varOperand = assign.getLValue() and
    co = se.getResultExpr() and
    cmp = co.getCondition().getFullyConverted() and
    condLeft = cmp.getLeftOperand() and
    condRight = cmp.getRightOperand() and
    trueArm = co.getThen().getFullyConverted() and
    falseArm = co.getElse().getFullyConverted() and
    // The arms select the compared operands: the ternary result is one of
    // the compared values.
    (trueArm = condLeft or trueArm = condRight) and
    (falseArm = condLeft or falseArm = condRight) and
    // One compared operand folds to a constant.
    (c = constValueOf(condLeft) or c = constValueOf(condRight)) and
    signedness = operandSignedness(cmp) |
    (cmp instanceof LTExpr or cmp instanceof LEExpr) and
    pred = relPred("Le", c, signedness)
    or
    (cmp instanceof GTExpr or cmp instanceof GEExpr) and
    pred = relPred("Ge", c, signedness)
  )
}

//===----------------------------------------------------------------------===//
// Loop counters (offset facts)
//===----------------------------------------------------------------------===//

/** Holds if the local `v` in `f` is assigned an integer constant. */
predicate counterInit(Function f, LocalScopeVariable v) {
  exists(Initializer init | init.getDeclaration() = v and
    init.getExpr().getFullyConverted() instanceof Literal and
    v.getFunction() = f
  )
  or
  exists(Assignment assign, VariableAccess access |
    assign.getLValue() = access and
    access.getTarget() = v and
    assign.getRValue().getFullyConverted() instanceof Literal
  )
}

/** Holds if the local `v` is incremented or decremented. */
predicate counterInc(LocalScopeVariable v) {
  exists(CrementOperation c | c.getOperand().getFullyConverted() = v.getAnAccess())
  or
  exists(AssignAddExpr a | a.getLValue() = v.getAnAccess())
  or
  exists(AssignSubExpr a | a.getLValue() = v.getAnAccess())
}

/** A loop counter: a local assigned an integer constant and incremented. */
predicate isCounter(Function f, LocalScopeVariable v) {
  counterInit(f, v) and
  counterInc(v) and
  v.getFunction() = f
}

/**
 * A counter's bound is an offset fact even when neither side has surface
 * provenance: `i = 0; i < N; arr[i]` bounds the index at N
 * (grammar-extraction.md 3.2, head_offset coverage).
 */
predicate counterBound(Function f, LocalScopeVariable counter,
                       string pred) {
  isCounter(f, counter) and
  exists(ComparisonOperation cmp, VariableAccess access |
    access.getTarget() = counter and
    (cmp.getLeftOperand().getFullyConverted() = access or
     cmp.getRightOperand().getFullyConverted() = access) and
    comparisonPredicate(cmp, access, pred)
  )
}
