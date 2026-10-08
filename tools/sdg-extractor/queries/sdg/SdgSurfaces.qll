/**
 * Device-written surfaces and provenance.
 *
 * Model (virtio-source-groundtruth.md): device-written surfaces are produced
 * by ioremap-family calls (MMIO), dma-alloc-family calls (coherent DMA), and
 * virtqueue-get-buf / dma-map-family calls (streaming DMA). Provenance flows
 * from each surface root through assignments, member stores, call arguments,
 * returns, and inline-assembly operands.
 *
 * Mechanism mapping from the replaced LLVM/SVF implementation:
 * - The per-TU provenance tables and the 64-pass fixed point become one
 *   CodeQL global data-flow configuration: `SurfaceFlow::flow` is the
 *   least fixed point of the same flow relation, and it is interprocedural.
 * - Cross-TU joins need no shared accumulator: the database is built once
 *   for the whole tree, so members, ops tables, and call chains join
 *   across translation units.
 * - Inline assembly is not crossed by the data-flow library, so the asm
 *   step is modeled explicitly below: asm outputs inherit asm inputs.
 */

import cpp
import semmle.code.cpp.dataflow.new.DataFlow
import semmle.code.cpp.ir.IR
import SdgModel

//===----------------------------------------------------------------------===//
// Surface roots
//===----------------------------------------------------------------------===//

/** The surface family of a root: "Mmio", "Coherent", or "Streaming". */
string surfaceKindName(string kind) {
  kind = "Mmio" and result = "Mmio"
  or
  kind = "Coherent" and result = "Coherent"
  or
  kind = "Streaming" and result = "Streaming"
}

/** Holds if `name` is an ioremap-family call (an MMIO region root). */
bindingset[name]
predicate isMmioRootName(string name) {
  name.regexpMatch("^ioremap.*$")
  or
  name.regexpMatch("^devm_ioremap.*$")
  or
  name.regexpMatch("^devm_platform_ioremap_resource.*$")
  or
  name.regexpMatch("^pci_iomap.*$")
  or
  name.regexpMatch("^pci_ioremap.*$")
  or
  name.regexpMatch("^pcim_iomap.*$")
  or
  name = "of_iomap"
  or
  name = "devm_ioport_map"
}

/** Holds if `name` is a dma-alloc-family call (a coherent DMA root). */
bindingset[name]
predicate isCoherentRootName(string name) {
  name.regexpMatch("^dma_alloc.*$")
  or
  name = "dma_pool_alloc"
  or
  name.regexpMatch("^dmam_alloc.*$")
}

/** Holds if `name` is a virtqueue-get-buf / dma-map-family call (a
    streaming DMA root). */
bindingset[name]
predicate isStreamingRootName(string name) {
  name.regexpMatch("^virtqueue_get_buf.*$")
  or
  name.regexpMatch("^virtqueue_detach_buf.*$")
  or
  name.regexpMatch("^dma_map.*$")
}

/** A call whose result (or, for dma-map, whose mapped buffer) is
    device-written memory. The surface kind is Mmio, Coherent, or Streaming.
    The root may be a direct call (the ioremap/dma families) or the indirect
    virtio config-get call. */
class SurfaceRootCall extends Call {
  string kind_;

  SurfaceRootCall() {
    isMmioRootName(this.getTarget().getName()) and kind_ = "Mmio"
    or
    isCoherentRootName(this.getTarget().getName()) and kind_ = "Coherent"
    or
    isStreamingRootName(this.getTarget().getName()) and kind_ = "Streaming"
    or
    this instanceof ConfigGetCall and kind_ = "Mmio"
  }

  /** The surface family this root produces. */
  string getSurfaceKind() { result = kind_ }

  /** The device-written value: the call result, except for dma-map calls
      where the mapped buffer (argument 1) becomes device-visible. */
  Expr getWrittenValue() {
    this instanceof ConfigGetCall and result = this
    or
    not this instanceof ConfigGetCall and
    this.getTarget().getName().regexpMatch("^dma_map.*$") and
    result = this.getArgument(1)
    or
    not this instanceof ConfigGetCall and
    not this.getTarget().getName().regexpMatch("^dma_map.*$") and
    result = this
  }
}

//===----------------------------------------------------------------------===//
// Virtio-1.3 register and config-field catalog
//===----------------------------------------------------------------------===//

/**
 * The virtio-1.3 MMIO transport register schema by absolute offset
 * (section 4.2.2, table "MMIO Device Register Layout"). Every entry is a
 * 32-bit register exposed by the specification. Only registers the
 * specification marks as device-readable are device-controlled input
 * sources; RW registers (0x044, 0x070, 0x0c0) return driver-owned protocol
 * state and are excluded.
 */
predicate transportRegisterSchema(int offset, string name, int widthBytes) {
  offset = 0 and name = "magic_value" and widthBytes = 4
  or
  offset = 4 and name = "version" and widthBytes = 4
  or
  offset = 8 and name = "device_id" and widthBytes = 4
  or
  offset = 12 and name = "vendor_id" and widthBytes = 4
  or
  offset = 16 and name = "device_features" and widthBytes = 4
  or
  offset = 52 and name = "queue_size_max" and widthBytes = 4
  or
  offset = 96 and name = "interrupt_status" and widthBytes = 4
  or
  offset = 176 and name = "shm_len_low" and widthBytes = 4
  or
  offset = 180 and name = "shm_len_high" and widthBytes = 4
  or
  offset = 184 and name = "shm_base_low" and widthBytes = 4
  or
  offset = 188 and name = "shm_base_high" and widthBytes = 4
  or
  offset = 252 and name = "config_generation" and widthBytes = 4
}

/**
 * The virtio-1.3 config-space field schema by absolute offset (section
 * 5.1.4): the ordered virtio_net_config fields, inferred from the
 * section-4.2.2 Config base 0x100 and the preceding field widths.
 */
predicate configFieldSchema(int offset, string name, int widthBytes) {
  offset = 256 and name = "mac" and widthBytes = 6
  or
  offset = 262 and name = "status" and widthBytes = 2
  or
  offset = 264 and name = "max_virtqueue_pairs" and widthBytes = 2
  or
  offset = 266 and name = "mtu" and widthBytes = 2
  or
  offset = 268 and name = "speed" and widthBytes = 4
  or
  offset = 272 and name = "duplex" and widthBytes = 1
  or
  offset = 273 and name = "rss_max_key_size" and widthBytes = 1
  or
  offset = 274 and name = "rss_max_indirection_table_length" and widthBytes = 2
  or
  offset = 276 and name = "supported_hash_types" and widthBytes = 4
  or
  offset = 280 and name = "supported_tunnel_types" and widthBytes = 4
}

/** The catalog schema for a transport access at `offset`: the register or
    config-field name and its access width. */
predicate surfaceSchema(int offset, string name, int widthBytes) {
  transportRegisterSchema(offset, name, widthBytes)
  or
  configFieldSchema(offset, name, widthBytes)
}

/**
 * The virtio-1.3 feature-bit schema: bit -> feature name (section 2.2 for
 * the transport-independent bits, section 5.1.3 for the virtio-net bits).
 */
bindingset[bit]
string featureBitName(int bit) {
  bit = 24 and result = "VIRTIO_F_NOTIFY_ON_EMPTY"
  or
  bit = 27 and result = "VIRTIO_F_ANY_LAYOUT"
  or
  bit = 28 and result = "VIRTIO_F_INDIRECT_DESC"
  or
  bit = 29 and result = "VIRTIO_F_EVENT_IDX"
  or
  bit = 32 and result = "VIRTIO_F_VERSION_1"
  or
  bit = 33 and result = "VIRTIO_F_ACCESS_PLATFORM"
  or
  bit = 34 and result = "VIRTIO_F_RING_PACKED"
  or
  bit = 35 and result = "VIRTIO_F_IN_ORDER"
  or
  bit = 36 and result = "VIRTIO_F_ORDER_PLATFORM"
  or
  bit = 37 and result = "VIRTIO_F_SR_IOV"
  or
  bit = 38 and result = "VIRTIO_F_NOTIFICATION_DATA"
  or
  bit = 39 and result = "VIRTIO_F_NOTIF_CONFIG_DATA"
  or
  bit = 40 and result = "VIRTIO_F_RING_RESET"
  or
  bit = 41 and result = "VIRTIO_F_ADMIN_VQ"
  or
  bit = 3 and result = "VIRTIO_NET_F_MTU"
  or
  bit = 5 and result = "VIRTIO_NET_F_MAC"
  or
  bit = 16 and result = "VIRTIO_NET_F_STATUS"
  or
  bit = 17 and result = "VIRTIO_NET_F_CTRL_VQ"
  or
  bit = 18 and result = "VIRTIO_NET_F_CTRL_RX"
  or
  bit = 19 and result = "VIRTIO_NET_F_CTRL_VLAN"
  or
  bit = 22 and result = "VIRTIO_NET_F_MQ"
  or
  bit = 23 and result = "VIRTIO_NET_F_CTRL_MAC_ADDR"
  or
  bit = 51 and result = "VIRTIO_NET_F_HASH_TUNNEL"
  or
  bit = 53 and result = "VIRTIO_NET_F_NOTF_COAL"
  or
  bit = 57 and result = "VIRTIO_NET_F_HASH_REPORT"
  or
  bit = 60 and result = "VIRTIO_NET_F_RSS"
  or
  bit = 63 and result = "VIRTIO_NET_F_SPEED_DUPLEX"
}

//===----------------------------------------------------------------------===//
// Helper contracts
//===----------------------------------------------------------------------===//

/** IO-register read helpers: callee -> access width in bytes. */
bindingset[fn]
predicate ioReadWidth(string fn, int width) {
  fn.regexpMatch("^readl.*$") and width = 4
  or
  fn.regexpMatch("^readw.*$") and width = 2
  or
  fn.regexpMatch("^readb.*$") and width = 1
  or
  fn.regexpMatch("^readq.*$") and width = 8
  or
  fn.regexpMatch("^ioread8.*$") and width = 1
  or
  fn.regexpMatch("^ioread16.*$") and width = 2
  or
  fn.regexpMatch("^ioread32.*$") and width = 4
  or
  fn.regexpMatch("^ioread64.*$") and width = 8
}

/** Config-read helpers: callee -> access width in bytes. */
bindingset[fn]
predicate creadWidth(string fn, int width) {
  fn.regexpMatch("^virtio_cread8.*$") and width = 1
  or
  fn.regexpMatch("^virtio_cread16.*$") and width = 2
  or
  fn.regexpMatch("^virtio_cread32.*$") and width = 4
  or
  fn.regexpMatch("^virtio_cread64.*$") and width = 8
}

/**
 * Feature-bit helpers: callee -> (baseArgIndex, fbitArgIndex, bitmapField).
 * bitmapField names the bitmap member of the base argument's pointee struct;
 * "" when the base argument itself is the bitmap.
 */
bindingset[fn]
predicate bitTestHelper(string fn, int baseArg, int fbitArg, string bitmapField) {
  fn = "virtio_has_feature" and baseArg = 0 and fbitArg = 1 and
  bitmapField = "features_array"
  or
  fn = "virtio_test_bit" and baseArg = 0 and fbitArg = 1 and
  bitmapField = "features_array"
  or
  fn = "virtio_features_test_bit" and baseArg = 0 and fbitArg = 1 and
  bitmapField = ""
  or
  fn = "test_bit" and baseArg = 1 and fbitArg = 0 and bitmapField = ""
}

/**
 * The struct and field names of an offset expression: a `__builtin_offsetof`
 * (children: type, member) or an offsetof macro expansion
 * `&((TYPE *)0)->MEMBER` (the member access of a null-pointer cast).
 */
predicate offsetField(Expr offsetArg, string structName, string field, int offBytes) {
  exists(BuiltInOperationBuiltInOffsetOf o |
    offsetArg.getFullyConverted() = o and
    structName = o.getChild(0).toString() and
    field = o.getChild(1).toString() and
    offBytes = o.getValue().toInt()
  )
  or
  exists(AddressOfExpr addr, VariableAccess access, Field f |
    offsetArg.getFullyConverted() = addr and
    addr.getAnOperand() = access and
    access.getTarget() = f and
    structName = f.getDeclaringType().getName() and
    field = f.getName() and
    offBytes = f.getByteOffset()
  )
}

/**
 * A virtio config-space access: the indirect `vdev->config->get(vdev, off,
 * buf, size)` call through a member of virtio_config_ops. The device writes
 * the buffer argument (argument 2) at the config offset given by argument 1.
 */
class ConfigGetCall extends VariableCall {
  ConfigGetCall() {
    this.getNumberOfArguments() >= 4 and
    exists(MemberVariable mv |
      this.getVariable() = mv and
      mv.getDeclaringType().getName() = "virtio_config_ops"
    )
  }

  /** The relative config offset: a literal argument or an offsetof
      expression. */
  int getRelativeOffset() {
    result = constValueOf(this.getArgument(1))
    or
    exists(string s, string f, int off |
      offsetField(this.getArgument(1), s, f, off) | result = off
    )
  }

  /** The written byte size: argument 3. */
  int getWriteSize() { result = constValueOf(this.getArgument(3)) }

  /** The variable the device writes through: the pointee of the buffer
      argument, when the argument is `&var`. */
  Variable getWrittenVariable() {
    exists(AddressOfExpr addr, VariableAccess access |
      this.getArgument(2).getFullyConverted() = addr and
      addr.getAnOperand() = access and
      result = access.getTarget().(Variable)
    )
  }
}

//===----------------------------------------------------------------------===//
// Provenance: one global data-flow configuration
//===----------------------------------------------------------------------===//

/**
 * Global data flow from surface roots. Sources are the device-written
 * values; sinks are every expression, because provenance is queried
 * per expression of interest by the mechanisms in this pack.
 */
module SurfaceFlowConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node src) {
    src.asExpr() = any(SurfaceRootCall c).getWrittenValue()
  }

  predicate isSink(DataFlow::Node sink) { any() }

  predicate isAdditionalFlowStep(DataFlow::Node src, DataFlow::Node sink) {
    surfaceFlowStep(src, sink)
  }
}

/** The instantiated global data-flow module. */
module SurfaceFlow = DataFlow::Global<SurfaceFlowConfig>;

/**
 * Additional provenance steps shared by both flow configurations.
 * - Address arithmetic keeps provenance: `base + MACRO` (the register
 *   offset annotation) is a derived address of the same surface.
 * - Inline assembly: outputs inherit inputs (arm64 readl lowers the load to
 *   asm, so the data-flow library does not cross it). The asm input operand
 *   computes the input value; the asm output operand is written through an
 *   address (its definition is a `VariableAddress`). Every later load of the
 *   output variable inherits the input value.
 */
predicate surfaceFlowStep(DataFlow::Node src, DataFlow::Node sink) {
  exists(PointerAddExpr padd |
    src = DataFlow::exprNode(padd.getLeftOperand()) and sink = DataFlow::exprNode(padd) |
    src.asExpr() = padd.getLeftOperand() and sink.asExpr() = padd
  )
  or
  exists(PointerAddExpr padd |
    src = DataFlow::exprNode(padd.getRightOperand()) and sink = DataFlow::exprNode(padd) |
    src.asExpr() = padd.getRightOperand() and sink.asExpr() = padd
  )
  or
  exists(InlineAsmInstruction asm, Operand inOp, Operand outOp, Instruction inDef,
         VariableAddressInstruction outAddr, IRVariable outVar, LoadInstruction outLoad,
         VariableAddressInstruction loadAddr |
    asm.getAnOperand() = inOp and
    asm.getAnOperand() = outOp and
    inOp.getDef() = inDef and
    outOp.getDef() = outAddr and
    outAddr.getIRVariable() = outVar and
    outLoad.getEnclosingIRFunction() = asm.getEnclosingIRFunction() and
    outLoad.getSourceAddress() = loadAddr and
    loadAddr.getIRVariable() = outVar |
    src = DataFlow::instructionNode(inDef) and
    sink = DataFlow::instructionNode(outLoad)
  )
  or
  // The config-get writes the buffer variable; later reads of that variable
  // carry the device-written value.
  exists(ConfigGetCall get, Variable v |
    src = DataFlow::exprNode(get) and
    sink = DataFlow::variableNode(v) and
    get.getWrittenVariable() = v
  )
  or
  // Arithmetic, bitwise, shift, logical, and comparison derivations keep
  // provenance (the taint-style transparent set of the replaced LLVM
  // implementation).
  exists(BinaryOperation op |
    sink = DataFlow::exprNode(op) |
    src = DataFlow::exprNode(op.getLeftOperand()) or
    src = DataFlow::exprNode(op.getRightOperand())
  )
}

/**
 * A read of the surface that root `root` produces: the read value carries
 * the device-written data and is the origin of the downstream provenance.
 * The read address (or, for config reads, the read itself) is reachable
 * from the root through the global data-flow graph.
 */
predicate surfaceRead(Expr e, SurfaceRootCall root) {
  // Pattern 1: a dereference of a surface-derived pointer at a cataloged
  // transport or config offset.
  exists(Expr addr, int off, string name, int w |
    e instanceof PointerDereferenceExpr and
    e.(PointerDereferenceExpr).getAnOperand() = addr and
    SurfaceFlow::flow(DataFlow::exprNode(root), DataFlow::exprNode(addr)) and
    off = addedOffsetOf(addr) and
    off >= 0 and
    surfaceSchema(off, name, w)
  )
  or
  // Pattern 2: an IO-register read helper whose address argument is
  // surface-derived and at a cataloged offset.
  exists(FunctionCall call, int w, string name, int off |
    ioReadWidth(normalizeCalleeName(call.getTarget().getName()), w) and
    call.getNumberOfArguments() >= 1 and
    SurfaceFlow::flow(DataFlow::exprNode(root), DataFlow::exprNode(call.getArgument(0))) and
    off = addedOffsetOf(call.getArgument(0)) and
    surfaceSchema(off, name, _) and
    e = call
  )
  or
  // Pattern 3: the config-get call itself is the read origin: the flow
  // step carries the written value to the buffer variable's reads.
  exists(ConfigGetCall get | e = get and root = get)
  or
  // Pattern 4: a config-read helper call whose body writes the returned
  // value through a config-get at a cataloged config offset with a matching
  // access width. The helper is a definition: the offset is inferred from
  // the config-get in its body.
  exists(FunctionCall call, ConfigGetCall get, int w, int off, string name, int schemaWidth |
    creadWidth(normalizeCalleeName(call.getTarget().getName()), w) and
    exists(call.getTarget().getBlock()) and
    get.getEnclosingFunction() = call.getTarget() and
    get.getWriteSize() = w and
    off = 256 + get.getRelativeOffset() and
    configFieldSchema(off, name, schemaWidth) and
    schemaWidth = w and
    e = call
  )
}

/**
 * Downstream provenance from the read sites: the reads are the flow sources
 * (a dereference does not carry the pointer's value, so the root flow alone
 * cannot cross a read).
 */
module ReadFlowConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node src) {
    exists(SurfaceRootCall root | surfaceRead(src.asExpr(), root))
  }

  predicate isSink(DataFlow::Node sink) { any() }

  predicate isAdditionalFlowStep(DataFlow::Node src, DataFlow::Node sink) {
    surfaceFlowStep(src, sink)
  }
}

module ReadFlow = DataFlow::Global<ReadFlowConfig>;

/**
 * Holds if the value of `e` may carry data written by surface root `root`.
 * A read of the root's surface carries the device-written value, and every
 * expression reachable from a read inherits it.
 */
predicate surfaceProvenance(Expr e, SurfaceRootCall root) {
  // The root's own value (a surface buffer or region mapping).
  e = root.getWrittenValue()
  or
  surfaceRead(e, root)
  or
  exists(Expr read | surfaceRead(read, root) and
    ReadFlow::flow(DataFlow::exprNode(read), DataFlow::exprNode(e))
  )
}

//===----------------------------------------------------------------------===//
// Type-keyed member inheritance (the AST scanner's (struct, field) table)
//===----------------------------------------------------------------------===//

/** The struct name of a member access `x->field`. */
string memberStructName(VariableAccess access, MemberVariable mv) {
  access.getTarget() = mv and
  result = mv.getDeclaringType().getName()
}

/** Holds if `assign` writes `x->field` (a member access through an arrow or
    a dot). The LHS of an assignment to a member is a `VariableAccess` whose
    target is a `MemberVariable`. */
predicate isMemberWrite(Assignment assign, VariableAccess access, MemberVariable mv) {
  assign.getLValue() = access and
  access.getTarget() = mv
}

/**
 * Member surface table: an assignment `x->field = <surface-derived>` records
 * the surface for (struct, field); reads of that member anywhere in the tree
 * inherit it. This is the cross-TU join that replaced the shared
 * accumulator: it is a database join, not a per-TU table.
 */
predicate memberSurface(string structName, string field, SurfaceRootCall root) {
  exists(Assignment assign, VariableAccess access, MemberVariable mv |
    isMemberWrite(assign, access, mv) and
    memberStructName(access, mv) = structName and
    mv.getName() = field and
    surfaceProvenance(assign.getRValue(), root)
  )
}

/**
 * Holds if the value of `e` may carry device-written data, either by direct
 * global data flow from a root or by type-keyed member inheritance.
 */
predicate exprSurface(Expr e, SurfaceRootCall root) {
  surfaceProvenance(e, root)
  or
  exists(VariableAccess access, MemberVariable mv |
    e = access and
    access.getTarget() = mv and
    memberSurface(memberStructName(access, mv), mv.getName(), root)
  )
}

/** The surface root of `e`, when it has provenance. */
SurfaceRootCall aSurfaceRootOf(Expr e) {
  exprSurface(e, result)
}

/** The surface kind of `e`: "Mmio", "Coherent", or "Streaming". */
string surfaceKindOf(Expr e) {
  result = aSurfaceRootOf(e).getSurfaceKind()
}

//===----------------------------------------------------------------------===//
// Constant folding of address arithmetic (register offsets)
//===----------------------------------------------------------------------===//

/**
 * The integer constant `e` folds to. The extractor binds constant values
 * for macro-expanded literals, enum constants, and constant arithmetic,
 * so this replaces the DataLayout GEP offset accumulation: at source
 * level, register offsets are `base + MACRO` expressions.
 */
int constValueOf(Expr e) {
  exists(Expr c, string v |
    c = e.getFullyConverted() and
    v = c.getValue() |
    result = v.toInt()
  )
  or
  // Negative literals: the unary minus of a positive constant.
  exists(int v |
    e instanceof UnaryMinusExpr and
    v = e.(UnaryMinusExpr).getAnOperand().getFullyConverted().getValue().toInt() |
    result = -v
  )
}

/**
 * The byte offset `e` adds to a base address: `base + lit`, `lit + base`,
 * `base - lit`, or a plain base (offset 0). Only constants fold; unknown
 * offsets leave no result, and a candidate without a physical offset cannot
 * become a resolvable rule node.
 */
int addedOffsetOf(Expr e) {
  e instanceof PointerAddExpr and
  (
    result = constValueOf(e.(PointerAddExpr).getLeftOperand())
    or
    result = constValueOf(e.(PointerAddExpr).getRightOperand())
  )
  or
  e instanceof SubExpr and
  result = -constValueOf(e.(SubExpr).getRightOperand())
  or
  not e instanceof PointerAddExpr and
  not e instanceof SubExpr and
  not e instanceof PointerSubExpr and
  result = 0
}
