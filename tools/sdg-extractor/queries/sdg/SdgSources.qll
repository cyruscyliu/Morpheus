/**
 * Classified reads: every value the device writes and the driver reads
 * (virtio-source-groundtruth.md).
 *
 * Read patterns:
 * 1. Volatile dereference of a surface-derived pointer (the MMIO transport
 *    register access and the DMA buffer access).
 * 2. IO-register helper calls (readl / readw / readb / readq / ioreadN)
 *    whose address argument is surface-derived.
 * 3. Config-space reads (virtio_creadN) with a constant field offset.
 * 4. Feature-bit tests (virtio_has_feature and the other bit-test helpers)
 *    with a constant feature bit.
 * 5. Internal-state values: member reads whose stored value carries surface
 *    provenance. These are intermediate values in a provenance chain, not
 *    independently writable fuzzer inputs; they are linked to their physical
 *    origins with head_dataflow cross-edges (grammar-extraction.md 2.4).
 *
 * A candidate without a physical offset or access width remains an analysis
 * finding in the audit document, but cannot become a resolvable rule node
 * (grammar-extraction.md 2.3).
 */

import cpp
import SdgModel
import SdgSurfaces

//===----------------------------------------------------------------------===//
// Canonical node ids (grammar-extraction.md 4.6)
//===----------------------------------------------------------------------===//

/** Canonical node ids for physically lowerable MMIO/DMA nodes. */
bindingset[class_, offset, sizeBytes, field]
string canonicalNodeId(string class_, int offset, int sizeBytes, string field) {
  class_ = "Mmio" and
  result = "mmio:" + offset.toString() + ":" + sizeBytes.toString() + ":" + valueFieldName(field)
  or
  class_ = "Dma" and offset >= 0 and
  result = "coherent:" + offset.toString() + ":" + sizeBytes.toString() + ":" + valueFieldName(field)
}

/** The node-id field component: `field` when named, `value` otherwise. */
bindingset[field]
private string valueFieldName(string field) {
  field = "" and result = "value"
  or
  field != "" and result = field
}

//===----------------------------------------------------------------------===//
// Reads
//===----------------------------------------------------------------------===//

/**
 * A classified read: an access to device-written memory, or an internal
 * value derived from one. The extent is the union of the read patterns;
 * the schema accessors dispatch to the pattern classes.
 */
abstract class SdgSourceNode extends Expr {

  /** The surface root this read traces to, when it has provenance. */
  SurfaceRootCall getRoot() { none() }

  /** The surface family: "Mmio", "Dma", or "InternalState". */
  string getSourceClass() { none() }

  /** The access kind. */
  string getAccessKind() { none() }

  /** The physical byte offset, when known; -1 when unknown. */
  int getOffset() { none() }

  /** The access width in bytes; 0 when unknown. */
  int getSizeBytes() { none() }

  /** The struct.field name, when known; "" otherwise. */
  string getField() { none() }

  /** The canonical node id (grammar-extraction.md 4.6). */
  string getId() {
    this instanceof InternalStateRead and result = "internal:" + this.getField()
    or
    not this instanceof InternalStateRead and
    result = canonicalNodeId("Mmio", this.getOffset(), this.getSizeBytes(), this.getField())
  }

  /** Holds if this node has a physical offset and width, and can therefore
      become a resolvable rule node (grammar-extraction.md 2.3). */
  predicate isPhysicallyResolvable() {
    not this instanceof InternalStateRead and
    this.getOffset() >= 0 and
    this.getSizeBytes() > 0
  }

  /** The JSON source object for this node as it appears in a rule's vars. */
  string getSourceJSON() {
    exists(string fieldPart, string offsetPart, string sizePart |
      (this.getField() = "" and fieldPart = ""
       or
       this.getField() != "" and fieldPart = ",\"field\":\"" + this.getField() + "\"") and
      (this.getOffset() < 0 and offsetPart = ""
       or
       this.getOffset() >= 0 and offsetPart = ",\"offset\":" + this.getOffset().toString()) and
      (this.getSizeBytes() = 0 and sizePart = ""
       or
       this.getSizeBytes() != 0 and
       sizePart = ",\"size_bytes\":" + this.getSizeBytes().toString()) |
      result = "{\"class\":\"" + this.getSourceClass() + "\"" +
               ",\"access_kind\":\"" + this.getAccessKind() + "\"" +
               fieldPart + offsetPart + sizePart + "}"
    )
  }

  /** The JSON object for this source as it appears in the audit document. */
  string getAuditJSON() {
    exists(string fieldPart, string offsetPart, string sizePart |
      (this.getField() = "" and fieldPart = ""
       or
       this.getField() != "" and fieldPart = ",\"field\":\"" + this.getField() + "\"") and
      (this.getOffset() < 0 and offsetPart = ""
       or
       this.getOffset() >= 0 and offsetPart = ",\"offset\":" + this.getOffset().toString()) and
      (this.getSizeBytes() = 0 and sizePart = ""
       or
       this.getSizeBytes() != 0 and
       sizePart = ",\"size_bytes\":" + this.getSizeBytes().toString()) |
      result = "{\"id\":" + jsonString(this.getId()) +
               ",\"class\":\"" + this.getSourceClass() + "\"" +
               ",\"access_kind\":\"" + this.getAccessKind() + "\"" +
               fieldPart + offsetPart + sizePart +
               ",\"function\":" + jsonString(this.getEnclosingFunction().getName()) +
               ",\"location\":" + jsonLocation(this) + "}"
    )
  }
}

/**
 * Pattern 1: a volatile dereference of a surface-derived pointer. The
 * offset follows `+ lit` / `- lit` address arithmetic; the width comes from
 * the dereferenced type.
 */
class DerefRead extends SdgSourceNode, PointerDereferenceExpr {
  SurfaceRootCall derefRoot;

  DerefRead() { surfaceRead(this, derefRoot) }

  override SurfaceRootCall getRoot() { result = derefRoot }

  override string getSourceClass() {
    result = "Mmio"
    or
    result = "Dma" and derefRoot.getSurfaceKind() != "Mmio"
  }

  override string getAccessKind() { result = "transport" }

  /** The offset added to the surface base by the address expression. */
  override int getOffset() { result = addedOffsetOf(this.getAnOperand()) }

  /** The access width from the catalog schema at the offset. */
  override int getSizeBytes() { surfaceSchema(this.getOffset(), _, result) }

  /** The catalog field name at the offset. */
  override string getField() { surfaceSchema(this.getOffset(), result, _) }
}

/**
 * Pattern 2: an IO-register helper call (readl / readw / readb / readq /
 * ioreadN) whose address argument is surface-derived.
 */
class IoRead extends SdgSourceNode, FunctionCall {
  SurfaceRootCall ioRoot;
  int ioWidth;

  IoRead() {
    ioReadWidth(this.getTarget().getName(), ioWidth) and
    this.getNumberOfArguments() >= 1 and
    surfaceRead(this, ioRoot)
  }

  override SurfaceRootCall getRoot() { result = ioRoot }

  override string getSourceClass() { result = "Mmio" }

  override string getAccessKind() { result = "transport" }

  /** The offset added to the surface base by the address argument. */
  override int getOffset() { result = addedOffsetOf(this.getArgument(0)) }

  /** The access width from the catalog schema at the offset. */
  override int getSizeBytes() { surfaceSchema(this.getOffset(), _, result) }

  /** The catalog field name at the offset. */
  override string getField() { surfaceSchema(this.getOffset(), result, _) }
}

/**
 * Pattern 3: a config-space read (virtio_creadN). The offset comes from the
 * call's constant/offsetof argument, or from the config-get in the helper's
 * body when the helper is a single-argument definition. The device
 * configuration space starts at absolute MMIO offset 0x100; only cataloged
 * config fields with a matching access width classify.
 */
class CreadRead extends SdgSourceNode, FunctionCall {
  int relativeOffset;

  CreadRead() {
    exists(int w, int off, string name, int schemaWidth |
      creadWidth(this.getTarget().getName(), w) and
      // The relative offset: the call argument, or the config-get in the
      // helper's body for a single-argument definition.
      (
        this.getNumberOfArguments() >= 2 and
        (off = constValueOf(this.getArgument(1))
         or
         exists(string s, string f, int fieldOff |
           offsetField(this.getArgument(1), s, f, fieldOff) | off = fieldOff
         ))
        or
        this.getNumberOfArguments() = 1 and
        exists(ConfigGetCall get |
          get.getEnclosingFunction() = this.getTarget() and
          get.getWriteSize() = w and
          off = get.getRelativeOffset()
        )
      ) |
      relativeOffset = off and
      configFieldSchema(256 + off, name, schemaWidth) and
      schemaWidth = w
    )
  }

  override SurfaceRootCall getRoot() {
    exists(ConfigGetCall get |
      get.getEnclosingFunction() = this.getTarget() |
      result = get
    )
  }

  override string getSourceClass() { result = "Mmio" }

  override string getAccessKind() { result = "config" }

  /** The absolute config-space offset: 0x100 + the field offset. */
  override int getOffset() { result = 256 + relativeOffset }

  override int getSizeBytes() { creadWidth(this.getTarget().getName(), result) }

  /** The catalog field name at the absolute offset. */
  override string getField() { configFieldSchema(this.getOffset(), result, _) }
}

/**
 * Pattern 4: a feature-bit test with a constant feature bit. The device
 * features register is at absolute MMIO offset 0x10 (table 4.1). The node
 * is the negotiated-features read: one per tested bitmap member; each
 * tested bit is a BitSet guard on it.
 */
class BitTestSource extends SdgSourceNode, FunctionCall {
  int bitValue;

  BitTestSource() {
    exists(int base, int fbit, int fbitValue |
      bitTestHelper(normalizeCalleeName(this.getTarget().getName()), base, fbit, _) and
      this.getNumberOfArguments() > fbit and
      fbitValue = constValueOf(this.getArgument(fbit)) and
      // Only cataloged feature bits classify.
      featureBitName(fbitValue) != "" |
      bitValue = fbitValue
    )
  }

  override string getSourceClass() { result = "Mmio" }

  override string getAccessKind() { result = "feature" }

  override int getOffset() { result = 16 }

  override int getSizeBytes() { result = 4 }

  /** The catalog feature name of the tested bit. */
  override string getField() { result = featureBitName(bitValue) }
}

/**
 * Pattern 5: an internal-state value. The member's stored value carries
 * surface provenance (the type-keyed member table); the member read is an
 * intermediate value in the provenance chain.
 */
class InternalStateRead extends SdgSourceNode, VariableAccess {
  SurfaceRootCall stateRoot;

  InternalStateRead() {
    this.getTarget() instanceof MemberVariable and
    memberSurface(this.getTarget().(MemberVariable).getDeclaringType().getName(),
                  this.getTarget().getName(), stateRoot) and
    // The store site itself is not a read: the LHS of the assignment that
    // recorded the surface must not classify as an internal-state read.
    not exists(Assignment a | a.getLValue() = this)
  }

  override SurfaceRootCall getRoot() { result = stateRoot }

  override string getSourceClass() { result = "InternalState" }

  override string getAccessKind() { result = "state" }

  override int getOffset() { result = -1 }

  override int getSizeBytes() { result = this.getTarget().getType().getSize() }

  /** The struct.field name. */
  override string getField() {
    exists(MemberVariable mv | this.getTarget() = mv |
      result = mv.getDeclaringType().getName() + "." + mv.getName()
    )
  }
}

/**
 * The physical origin of a classified read: internal-state values are
 * intermediate values in a provenance chain, and they resolve through
 * their provenance root to the physical read their value came from;
 * physical reads are their own origin.
 */
SdgSourceNode physicalOriginOf(SdgSourceNode src) {
  not src instanceof InternalStateRead and result = src
  or
  src instanceof InternalStateRead and
  exists(SdgSourceNode origin |
    origin.getRoot() = src.getRoot() and
    not origin instanceof InternalStateRead and
    ReadFlow::flow(DataFlow::exprNode(origin), DataFlow::exprNode(src)) |
    result = origin
  )
}
