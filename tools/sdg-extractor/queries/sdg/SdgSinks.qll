/**
 * Sink contracts and sink discovery.
 *
 * The contract table is an exact kernel-API contract, identical in both the
 * replaced LLVM implementation and the AST comparison tool: entries identify
 * only operands whose value is a size, count, or index consumed by a
 * memory-sensitive operation. Entries with a destination operand also own
 * that buffer contract: the role operand's valid range is bounded by the
 * destination's static capacity.
 *
 * A sink fires only at an actual callsite whose contracted operand carries
 * surface provenance. Call edges are never invented here.
 */

import cpp
import SdgModel
import SdgSurfaces

//===----------------------------------------------------------------------===//
// Contract table
//===----------------------------------------------------------------------===//

/**
 * Sink contract: an operand of a memory-sensitive API whose value is a
 * size, count, or index. `destArg` is the destination-buffer operand when
 * the role operand is bounded by that buffer's static capacity, and -1
 * when there is no destination operand.
 */
predicate sinkContract(string fn, int argIndex, string role, int destArg) {
  fn = "memcpy" and argIndex = 2 and role = "Size" and destArg = 0
  or
  fn = "memmove" and argIndex = 2 and role = "Size" and destArg = 0
  or
  fn = "memset" and argIndex = 2 and role = "Size" and destArg = 0
  or
  fn = "strscpy" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "strlcpy" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "strncpy" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "kmalloc" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "kzalloc" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "kcalloc" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "kcalloc" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "kvmalloc" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "kvzalloc" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "kvcalloc" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "kvcalloc" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "devm_kmalloc" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "devm_kzalloc" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "devm_kcalloc" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "devm_kcalloc" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "kmemdup" and argIndex = 1 and role = "Size" and destArg = 0
  or
  fn = "devm_kmemdup" and argIndex = 2 and role = "Size" and destArg = 0
  or
  fn = "kstrndup" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "alloc_pages_exact" and argIndex = 0 and role = "Size" and destArg = -1
  or
  fn = "skb_put" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "skb_put_data" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "netdev_alloc_skb" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "napi_alloc_skb" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "skb_copy_expand" and argIndex = 1 and role = "Size" and destArg = -1
  or
  fn = "skb_copy_expand" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "dma_map_sg_attrs" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "dma_map_page_attrs" and argIndex = 3 and role = "Size" and destArg = -1
  or
  fn = "dma_map_single_attrs" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "virtqueue_map_page_attrs" and argIndex = 3 and role = "Size" and destArg = -1
  or
  fn = "virtqueue_map_single_attrs" and argIndex = 2 and role = "Size" and destArg = -1
  or
  fn = "detach_buf_split" and argIndex = 1 and role = "Index" and destArg = -1
  or
  fn = "detach_buf_split_in_order" and argIndex = 1 and role = "Index" and destArg = -1
}

//===----------------------------------------------------------------------===//
// Sink discovery
//===----------------------------------------------------------------------===//

/**
 * A concrete sink call: a direct call to a contracted function. Indirect
 * calls never match; call edges are never invented here.
 */
class SinkCall extends FunctionCall {
  SinkCall() { sinkContract(normalizeCalleeName(this.getTarget().getName()), _, _, _) }

  /** The normalized contract key of the callee. */
  string getContractName() { result = normalizeCalleeName(this.getTarget().getName()) }
}

/**
 * A fired sink: a sink call whose contracted operand carries surface
 * provenance. The surface kind comes from the operand's provenance root.
 */
class SdgSink extends SinkCall {
  int argIndex;
  string role;
  int destArg;
  string surface;

  SdgSink() {
    exists(int idx, string contractRole, int contractDest, SurfaceRootCall root, Expr arg |
      sinkContract(this.getContractName(), idx, contractRole, contractDest) and
      arg = this.getArgument(idx) and
      idx < this.getNumberOfArguments() and
      exprSurface(arg, root) |
      argIndex = idx and
      role = contractRole and
      destArg = contractDest and
      surface = root.getSurfaceKind()
    )
  }

  SinkCall getCall() { result = this }

  int getArgIndex() { result = argIndex }

  string getRole() { result = role }

  int getDestArg() { result = destArg }

  string getSurface() { result = surface }

  /** The JSON object for this sink as it appears in the audit document. */
  string getAuditJSON() {
    result = "{\"surface\":" + jsonString(surface) +
             ",\"function\":" + jsonString(this.getContractName()) +
             ",\"role\":" + jsonString(role) +
             ",\"arg_index\":" + argIndex.toString() +
             ",\"location\":" + jsonLocation(this) + "}"
  }

  /** The JSON object for this sink as it appears in a rule. */
  string getRuleJSON() {
    result = "{\"function\":" + jsonString(this.getContractName()) +
             ",\"arg_index\":" + argIndex.toString() +
             ",\"role\":" + jsonString(role.toLowerCase()) + "}"
  }
}
