// AST-level source catalog: classify reads (x->field accesses) by the
// provenance of their base address, tracked through assignments in the
// translation unit.
//
// Model: device-written surfaces are produced by ioremap-family calls
// (MMIO), dma-alloc-family calls (coherent DMA), and virtqueue-get-buf /
// dma-map-family calls (streaming DMA). An assignment `x->field = <surface>`
// records the surface for (struct, field); reads of that member anywhere in
// the TU inherit it. Provenance also flows through call arguments into
// callee parameters, through function returns, and through local variables.
//
// Member identity comes from the base's static type (struct name + field
// name), so container_of-style casts resolve exactly without any pointer
// analysis.
#include "clang/AST/ASTConsumer.h"
#include "clang/AST/ASTContext.h"
#include "clang/AST/Decl.h"
#include "clang/AST/Expr.h"
#include "clang/AST/RecordLayout.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/AST/Type.h"
#include "clang/Basic/SourceLocation.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Tooling/CompilationDatabase.h"
#include "clang/Tooling/Tooling.h"

#include <cstdio>
#include <map>
#include <set>
#include <tuple>
#include <vector>

using namespace clang;

namespace {

// A member of a struct, identified by the struct and field names.
struct Key {
  std::string structName;
  std::string field;
  bool operator<(const Key &o) const {
    return structName != o.structName ? structName < o.structName
                                      : field < o.field;
  }
};

// Sink contract: an operand of a memory-sensitive API whose value is a size,
// count, or index. destArg is the destination-buffer operand when the role
// operand is bounded by that buffer's static capacity.
struct SinkContract {
  unsigned argIndex;
  const char *role;
  int destArg; // -1 when there is no destination operand
};

// Kernel API sink contracts, keyed by normalized callee name.
const std::map<std::string, std::vector<SinkContract>> kSinkContracts = {
    {"memcpy", {{2, "Size", 0}}},
    {"memmove", {{2, "Size", 0}}},
    {"memset", {{2, "Size", 0}}},
    {"strscpy", {{2, "Size", -1}}},
    {"strlcpy", {{2, "Size", -1}}},
    {"strncpy", {{2, "Size", -1}}},
    {"kmalloc", {{0, "Size", -1}}},
    {"kzalloc", {{0, "Size", -1}}},
    {"kcalloc", {{0, "Size", -1}, {1, "Size", -1}}},
    {"kvmalloc", {{0, "Size", -1}}},
    {"kvzalloc", {{0, "Size", -1}}},
    {"kvcalloc", {{0, "Size", -1}, {1, "Size", -1}}},
    {"devm_kmalloc", {{1, "Size", -1}}},
    {"devm_kzalloc", {{1, "Size", -1}}},
    {"devm_kcalloc", {{1, "Size", -1}, {2, "Size", -1}}},
    {"kmemdup", {{1, "Size", 0}}},
    {"devm_kmemdup", {{2, "Size", 0}}},
    {"kstrndup", {{1, "Size", -1}}},
    {"alloc_pages_exact", {{0, "Size", -1}}},
    {"skb_put", {{1, "Size", -1}}},
    {"skb_put_data", {{2, "Size", -1}}},
    {"netdev_alloc_skb", {{1, "Size", -1}}},
    {"napi_alloc_skb", {{1, "Size", -1}}},
    {"skb_copy_expand", {{1, "Size", -1}, {2, "Size", -1}}},
    {"dma_map_sg_attrs", {{2, "Size", -1}}},
    {"dma_map_page_attrs", {{3, "Size", -1}}},
    {"dma_map_single_attrs", {{2, "Size", -1}}},
    {"virtqueue_map_page_attrs", {{3, "Size", -1}}},
    {"virtqueue_map_single_attrs", {{2, "Size", -1}}},
    {"detach_buf_split", {{1, "Index", -1}}},
    {"detach_buf_split_in_order", {{1, "Index", -1}}},
};

// Bit-test helpers called in branch conditions: callee -> (baseArgIndex,
// fbitArgIndex, bitmapField). bitmapField names the bitmap member of the
// base argument's pointee struct; "" when the base argument itself is the
// bitmap. A call with a constant feature bit yields a BitSet gate.
const std::map<std::string, std::tuple<unsigned, unsigned, std::string>>
    kBitTestHelpers = {
        {"virtio_has_feature", {0, 1, "features_array"}},
        {"__virtio_test_bit", {0, 1, "features_array"}},
        {"virtio_features_test_bit", {0, 1, ""}},
        {"test_bit", {1, 0, ""}},
        {"__test_bit", {1, 0, ""}},
};

// Config-read helpers: callee suffix -> access width in bytes.
static unsigned creadWidth(StringRef name) {
  if (name.ends_with("8"))
    return 1;
  if (name.ends_with("16"))
    return 2;
  if (name.ends_with("32"))
    return 4;
  if (name.ends_with("64"))
    return 8;
  return 0;
}

// Normalize a callee name to the contract key: profiling suffixes, .N
// duplicates, and double-underscore variants collapse to the base name.
static std::string normalizeCallee(StringRef name) {
  std::string n = name.str();
  if (n.size() > 7 && n.compare(n.size() - 7, 7, "_noprof") == 0)
    n.resize(n.size() - 7);
  while (n.size() > 2 && n[0] == '_' && n[1] == '_')
    n = n.substr(2);
  return n;
}

// Canonical predicate extracted from a comparison or mask test.
struct Pred {
  std::string kind; // BitSet BitClear Eq Ne Lt Gt Le Ge InRange
  long long value = 0;
  long long max = 0;
};

static std::string predText(const Pred &p) {
  if (p.kind == "InRange")
    return "InRange(" + std::to_string(p.value) + ", " +
           std::to_string(p.max) + ")";
  return p.kind + "(" + std::to_string(p.value) + ")";
}

// The predicate kind of an edge predicate text (BitSet(3) -> BitSet).
static std::string predKind(const std::string &pred) {
  size_t open = pred.find('(');
  return open == std::string::npos ? pred : pred.substr(0, open);
}

// A self-edge: N --[head, predicate]--> N.
struct SelfEdge {
  std::string node;
  std::string head; // head_guard head_bound head_offset head_call
  std::string pred;
  std::string function; // where the self-edge was found (rule id input)
};

// A cross-edge: N1 --[head, predicate]--> N2, src != dst.
struct CrossEdge {
  std::string src;
  std::string head; // head_guard head_dataflow head_bound
  std::string pred;
  std::string dst;
};

// A rule: R = (id, vars, preconditions, target_state, mutation_hint).
struct Rule {
  std::string id;
  std::vector<std::string> vars;
  std::vector<CrossEdge> preconditions;
  SelfEdge target;
  std::string hint;
};

static bool isMmioRoot(StringRef n) {
  return n.starts_with("ioremap") || n.starts_with("devm_ioremap") ||
         n.starts_with("devm_platform_ioremap_resource") ||
         n.starts_with("pci_iomap") || n == "of_iomap" ||
         n == "devm_ioport_map";
}

static bool isCoherentRoot(StringRef n) {
  return n.starts_with("dma_alloc") || n == "dma_pool_alloc" ||
         n.starts_with("dmam_alloc");
}

static bool isStreamingRoot(StringRef n) {
  return n.starts_with("virtqueue_get_buf") ||
         n.starts_with("virtqueue_detach_buf") || n.starts_with("dma_map");
}

// "0x10" style hex text for register offsets.
static std::string hexText(long long v) {
  char buf[32];
  snprintf(buf, sizeof(buf), "0x%llx", (unsigned long long)v);
  return buf;
}

// The offset a pointer expression adds: `base + lit` (constants only).
static bool addedOffset(Expr *E, long long &out) {
  E = E->IgnoreParenImpCasts();
  if (auto *BO = dyn_cast<BinaryOperator>(E)) {
    if (BO->getOpcode() != BO_Add && BO->getOpcode() != BO_Sub)
      return false;
    Expr *R = BO->getRHS()->IgnoreParenImpCasts();
    auto *lit = dyn_cast<IntegerLiteral>(R);
    if (!lit || lit->getValue().getSignificantBits() > 63)
      return false;
    out = lit->getValue().getSExtValue();
    if (BO->getOpcode() == BO_Sub)
      out = -out;
    return true;
  }
  return false;
}

// The MMIO register access an IO-family call performs, from its address
// argument: `vm_dev->base + VIRTIO_MMIO_DEVICE_FEATURES` etc.
static bool ioReadArg(Expr *addr, long long &off, unsigned &width,
                      StringRef callee) {
  if (callee.starts_with("readl") || callee.starts_with("writel"))
    width = 4;
  else if (callee.starts_with("readw") || callee.starts_with("writew"))
    width = 2;
  else if (callee.starts_with("readb") || callee.starts_with("writeb"))
    width = 1;
  else if (callee.starts_with("readq") || callee.starts_with("writeq"))
    width = 8;
  else
    width = 0;
  if (width == 0)
    return false;
  Expr *E = addr->IgnoreParenImpCasts();
  if (addedOffset(E, off))
    return true;
  if (auto *BO = dyn_cast<BinaryOperator>(E)) {
    if (BO->getOpcode() == BO_Add)
      return addedOffset(BO->getLHS(), off) ||
             addedOffset(BO->getRHS(), off);
  }
  return false;
}

// The config field a virtio_cread*(vdev, offsetof(S, F)) call reads:
// struct and field names plus the numeric field offset in bytes.
static bool creadField(Expr *offsetArg, ASTContext *Ctx, std::string &structName,
                       std::string &field, long long &offBytes) {
  Expr *E = offsetArg->IgnoreParenImpCasts();
  auto *OOE = dyn_cast<OffsetOfExpr>(E);
  if (!OOE || OOE->getNumComponents() == 0)
    return false;
  // Single-field offsetof: exact offset from the record layout.
  if (OOE->getNumComponents() != 1)
    return false;
  if (OOE->getComponent(0).getKind() != OffsetOfNode::Field)
    return false;
  const FieldDecl *FD = OOE->getComponent(0).getField();
  if (!FD)
    return false;
  structName = FD->getParent()->getNameAsString();
  field = FD->getNameAsString();
  offBytes = Ctx->getASTRecordLayout(FD->getParent())
                 .getFieldOffset(FD->getFieldIndex()) / 8;
  return true;
}

// Provenance accumulated over the TU: surfaces per (struct, field), per
// local variable, and per function return value. funcTable presets the
// ops-table contract: (ops struct, member) -> implementing function.
// funcParams records parameter names per function; paramOut records the
// surface written through a parameter, propagated back to actual arguments.
struct Provenance {
  std::map<Key, std::string> memberIndex;
  std::map<std::pair<std::string, std::string>, std::string> varProv;
  std::map<std::string, std::string> funcReturn;
  std::map<Key, std::string> funcTable;
  std::map<std::string, std::vector<std::string>> funcParams;
  std::map<std::pair<std::string, std::string>, std::string> paramOut;
  // Locals aliasing other variables: (func, local) -> origin variable.
  std::map<std::pair<std::string, std::string>, std::string> localAliases;
  // Flags set to a constant under gates: member -> gates that set it.
  std::map<Key, std::set<std::pair<std::string, std::string>>> memberGates;
  // Known bounds from min_t/max_t clamps: node -> (kind, constant).
  std::map<std::string, std::pair<std::string, long long>> varBound;
  // Register-read annotations: (func, var)/(func, param), func, member,
  // and resolved config-field nodes -> "MmioRead(offset=N, size_bytes=W)".
  std::map<std::pair<std::string, std::string>, std::string> varAnnot;
  std::map<std::pair<std::string, std::string>, std::string> paramAnnot;
  std::map<std::string, std::string> funcAnnot;
  std::map<Key, std::string> memberAnnot;
  std::map<std::string, std::string> nodeAnnot;

  size_t size() const {
    return memberIndex.size() + varProv.size() + funcReturn.size() +
           funcTable.size() + funcParams.size() + paramOut.size() +
           localAliases.size() + memberGates.size() + varBound.size() +
           varAnnot.size() + paramAnnot.size() + funcAnnot.size() +
           memberAnnot.size() + nodeAnnot.size();
  }
};

// The integer constant of an expression that is a literal or an alias of
// one, when the alias table resolves it to a purely numeric value.
static bool literalOrAlias(Expr *E, const Provenance &P,
                           const std::string &func, long long &out) {
  E = E->IgnoreParenImpCasts();
  if (auto *lit = dyn_cast<IntegerLiteral>(E)) {
    out = lit->getValue().getSExtValue();
    return true;
  }
  if (auto *DRE = dyn_cast<DeclRefExpr>(E)) {
    auto it = P.localAliases.find({func, DRE->getNameInfo().getAsString()});
    if (it == P.localAliases.end() || it->second.empty())
      return false;
    size_t pos = 0;
    try {
      out = std::stoll(it->second, &pos);
    } catch (...) {
      return false;
    }
    return pos == it->second.size();
  }
  return false;
}

class Visitor : public RecursiveASTVisitor<Visitor> {
public:
  Visitor(ASTContext *Ctx, Provenance &P) : Ctx(Ctx), P(P) {}

  bool TraverseFunctionDecl(FunctionDecl *FD) {
    std::string prev = CurFunc;
    CurFunc = FD->getNameAsString();
    if (FD->doesThisDeclarationHaveABody() && !P.funcParams.count(CurFunc)) {
      std::vector<std::string> names;
      for (const ParmVarDecl *PD : FD->parameters())
        names.push_back(PD->getNameAsString());
      P.funcParams[CurFunc] = names;
    }
    bool r = Base::TraverseFunctionDecl(FD);
    CurFunc = prev;
    return r;
  }

  // Branch and loop conditions are guard context; their bodies are not.
  // Comparisons in a condition gate the guarded region (then/else/body):
  // reads and sink operands in that region emit head_guard cross-edges.
  bool TraverseIfStmt(IfStmt *S) {
    bool prev = GuardCtx;
    GuardCtx = true;
    GuardCmps.clear();
    Base::TraverseStmt(S->getCond());
    GuardCtx = prev;
    GateStack.push_back(GuardCmps);
    Base::TraverseStmt(S->getThen());
    Base::TraverseStmt(S->getElse());
    GateStack.pop_back();
    return true;
  }

  bool TraverseWhileStmt(WhileStmt *S) {
    bool prev = GuardCtx;
    GuardCtx = true;
    GuardCmps.clear();
    Base::TraverseStmt(S->getCond());
    GuardCtx = prev;
    GateStack.push_back(GuardCmps);
    Base::TraverseStmt(S->getBody());
    GateStack.pop_back();
    return true;
  }

  bool TraverseForStmt(ForStmt *S) {
    // Counter init and increment: traversed outside guard context so the
    // counter sets fill (the increment is not a condition).
    Base::TraverseStmt(S->getInit());
    bool prev = GuardCtx;
    GuardCtx = true;
    GuardCmps.clear();
    Base::TraverseStmt(S->getCond());
    GuardCtx = prev;
    GateStack.push_back(GuardCmps);
    Base::TraverseStmt(S->getInc());
    Base::TraverseStmt(S->getBody());
    GateStack.pop_back();
    return true;
  }

  bool TraverseDoStmt(DoStmt *S) {
    bool prev = GuardCtx;
    GuardCtx = true;
    GuardCmps.clear();
    Base::TraverseStmt(S->getCond());
    GuardCtx = prev;
    GateStack.push_back(GuardCmps);
    Base::TraverseStmt(S->getBody());
    GateStack.pop_back();
    return true;
  }

  // An odd number of logical negations flips mask-test polarity.
  bool TraverseUnaryOperator(UnaryOperator *U) {
    if (U->getOpcode() == UO_LNot) {
      ++NegDepth;
      Base::TraverseStmt(U->getSubExpr());
      --NegDepth;
      return true;
    }
    return Base::TraverseUnaryOperator(U);
  }

  bool VisitUnaryOperator(UnaryOperator *U) {
    if (U->getOpcode() == UO_PreInc || U->getOpcode() == UO_PostInc ||
        U->getOpcode() == UO_PreDec || U->getOpcode() == UO_PostDec) {
      Expr *sub = U->getSubExpr()->IgnoreParenImpCasts();
      if (auto *DRE = dyn_cast<DeclRefExpr>(sub))
        if (!dyn_cast<ParmVarDecl>(DRE->getDecl()))
          incVars.insert({CurFunc, DRE->getNameInfo().getAsString()});
    }
    if (U->getOpcode() != UO_LNot || !GuardCtx)
      return true;
    Expr *sub = U->getSubExpr()->IgnoreParenImpCasts();
    if (isa<BinaryOperator>(sub) || isa<UnaryOperator>(sub))
      return true; // compound conditions handled elsewhere
    std::string node = trackedVar(sub);
    if (node.empty())
      return true;
    auto key = std::make_pair(CurFunc, node);
    Pred p{"Eq", 0, 0};
    if (!cmpByVar.count(key))
      cmpByVar[key] = p;
    GuardCmps.push_back({node, "Eq(0)"});
    selfEdges.push_back({node, "head_guard", "Eq(0)", CurFunc});
    return true;
  }

  // A plain truth test (if (x)) on a tracked variable yields Ne(0); mask
  // tests are handled by extractMask instead.
  bool VisitCastExpr(CastExpr *C) {
    if (!GuardCtx)
      return true;
    switch (C->getCastKind()) {
    case CK_IntegralToBoolean:
    case CK_PointerToBoolean:
      break;
    default:
      return true;
    }
    Expr *sub = C->getSubExpr()->IgnoreParenImpCasts();
    if (isa<BinaryOperator>(sub) || isa<UnaryOperator>(sub))
      return true;
    std::string node = trackedVar(sub);
    if (node.empty())
      return true;
    auto key = std::make_pair(CurFunc, node);
    Pred p{"Ne", 0, 0};
    if (!cmpByVar.count(key))
      cmpByVar[key] = p;
    GuardCmps.push_back({node, "Ne(0)"});
    selfEdges.push_back({node, "head_guard", "Ne(0)", CurFunc});
    return true;
  }

  // `x->field = <surface>` records the surface for the member; `v = <surface>`
  // records it for the local variable.
  bool VisitBinaryOperator(BinaryOperator *BO) {
    if (BO->isComparisonOp()) {
      extractComparison(BO);
      return true;
    }
    if (BO->getOpcode() == BO_LAnd) {
      mergeRange(BO);
      return true;
    }
    extractMask(BO);
    if (BO->getOpcode() == BO_AddAssign || BO->getOpcode() == BO_SubAssign)
      if (auto *DREi =
              dyn_cast<DeclRefExpr>(BO->getLHS()->IgnoreParenImpCasts()))
        if (!dyn_cast<ParmVarDecl>(DREi->getDecl()))
          incVars.insert({CurFunc, DREi->getNameInfo().getAsString()});
    if (!BO->isAssignmentOp())
      return true;
    Expr *RHS = BO->getRHS();
    if (!RHS)
      return true;
    std::string annot;
    std::string surface = classify(RHS, &annot);
    // Constant flags set under gates inherit the gates, so a later test on
    // the flag gates its region transitively.
    Expr *RHSi = RHS->IgnoreParenImpCasts();
    // A local assigned a constant is a loop counter: its bound is an offset
    // fact even without surface provenance (i = 0; i < N; arr[i]).
    if (isa<IntegerLiteral>(RHSi))
      if (auto *DREc = dyn_cast<DeclRefExpr>(BO->getLHS()->IgnoreParenImpCasts()))
        if (!dyn_cast<ParmVarDecl>(DREc->getDecl()))
          counterVars.insert({CurFunc, DREc->getNameInfo().getAsString()});
    if ((isa<CXXBoolLiteralExpr>(RHSi) || isa<IntegerLiteral>(RHSi)) &&
        !GateStack.empty()) {
      Expr *LHSc = BO->getLHS()->IgnoreParenImpCasts();
      if (auto *MEc = dyn_cast<MemberExpr>(LHSc)) {
        Key kc = memberKey(MEc);
        if (!kc.structName.empty())
          for (const auto &g : activeGates())
            P.memberGates[kc].insert(g);
      }
    }
    if (surface.empty())
      return true;
    Expr *LHS = BO->getLHS()->IgnoreParenImpCasts();
    std::string lhsNode;
    if (auto *ME = dyn_cast<MemberExpr>(LHS)) {
      Key key = memberKey(ME);
      if (!key.structName.empty()) {
        P.memberIndex[key] = surface;
        if (!annot.empty())
          P.memberAnnot[key] = annot;
        lhsNode = key.structName + "." + key.field;
      }
    } else if (auto *DRE = dyn_cast<DeclRefExpr>(LHS)) {
      std::string name = DRE->getNameInfo().getAsString();
      P.varProv[{CurFunc, name}] = surface;
      if (!annot.empty())
        P.varAnnot[{CurFunc, name}] = annot;
      lhsNode = name;
    } else if (auto *ASE = dyn_cast<ArraySubscriptExpr>(LHS)) {
      // Local array element: the array inherits the surface.
      Expr *base = ASE->getBase()->IgnoreParenImpCasts();
      if (auto *DRE = dyn_cast<DeclRefExpr>(base)) {
        if (!dyn_cast<ParmVarDecl>(DRE->getDecl())) {
          std::string name = DRE->getNameInfo().getAsString();
          P.varProv[{CurFunc, name}] = surface;
          if (!annot.empty())
            P.varAnnot[{CurFunc, name}] = annot;
          lhsNode = name;
        }
      }
    }
    // min_t/max_t clamps bound the assigned node at the clamp constant.
    std::string clampKind;
    long long clampC = 0;
    if (stmtExprClamp(RHS, clampKind, clampC) && !lhsNode.empty() &&
        !P.varBound.count(lhsNode))
      P.varBound[lhsNode] = {clampKind, clampC};
    // The assignment provenance is a dataflow cross-edge from the tracked
    // operand to the assigned variable.
    std::string rhsNode = trackedVar(RHS);
    if (!lhsNode.empty() && !rhsNode.empty() && lhsNode != rhsNode)
      crossEdges.push_back({rhsNode, "head_dataflow", "Identity", lhsNode});
    // Assignments in a gated region: the receiving variable is gated.
    if (!GateStack.empty() && !lhsNode.empty())
      for (const auto &gate : activeGates())
        if (gate.first != lhsNode)
          crossEdges.push_back(
              {gate.first, "head_guard", gate.second, lhsNode});
    // Writes through a parameter are param-out: the surface propagates back
    // to the actual arguments at call sites. One alias hop through a local
    // aliased to a parameter counts too (u8 *ptr = buf; ptr[i] = ...).
    if (auto *MEw = dyn_cast<MemberExpr>(LHS))
      writtenMembers.insert(MEw);
    else if (auto *MEa = dyn_cast<MemberExpr>(
                 BO->getLHS()->IgnoreParenImpCasts()))
      writtenMembers.insert(MEa);
    std::string writeParam;
    if (auto *AS = dyn_cast<ArraySubscriptExpr>(LHS)) {
      // X->field[i] = RHS: an array-field member contract.
      Expr *base = AS->getBase()->IgnoreParenImpCasts();
      if (auto *ME = dyn_cast<MemberExpr>(base)) {
        Key k = memberKey(ME);
        if (!k.structName.empty()) {
          P.memberIndex[k] = surface;
          if (!annot.empty())
            P.memberAnnot[k] = annot;
          if (getenv("SDG_AST_DEBUG"))
            fprintf(stderr,
                    "[dbg] member-write (%s, %s) <- %s marks=%d\n",
                    k.structName.c_str(), k.field.c_str(), surface.c_str(),
                    (int)P.memberGates.count(k));
          lhsNode = k.structName + "." + k.field;
        }
      }
      writeParam = paramDerefName(base);
      if (writeParam.empty())
        writeParam = localAliasParam(base);
    } else if (auto *UO = dyn_cast<UnaryOperator>(LHS)) {
      if (UO->getOpcode() == UO_Deref) {
        writeParam = paramDerefName(UO->getSubExpr());
        if (writeParam.empty())
          writeParam = localAliasParam(UO->getSubExpr());
      }
    }
    if (!writeParam.empty())
      P.paramOut[{CurFunc, writeParam}] = surface;
    return true;
  }

  // Initializations carry provenance like assignments (`v = <surface>`).
  bool VisitDeclStmt(DeclStmt *DS) {
    for (Decl *D : DS->decls()) {
      auto *VD = dyn_cast<VarDecl>(D);
      if (!VD || !VD->getInit())
        continue;
      // Locals aliasing parameters: writes through them are param-out.
      std::string param = paramDerefName(VD->getInit());
      if (!param.empty()) {
        auto key = std::make_pair(CurFunc, VD->getNameAsString());
        if (!P.localAliases.count(key))
          P.localAliases[key] = param;
      }
      // Locals aliasing other variables (min_t's __UNIQUE_ID temps etc.).
      std::string origin = varNameOf(VD->getInit());
      if (!origin.empty()) {
        auto key = std::make_pair(CurFunc, VD->getNameAsString());
        if (!P.localAliases.count(key))
          P.localAliases[key] = origin;
      }
      // Locals aliasing constants (NETDEV_RSS_KEY_LEN etc.): comparisons
      // against them become var-vs-const bounds.
      if (auto *lit = dyn_cast<IntegerLiteral>(
              VD->getInit()->IgnoreParenImpCasts())) {
        auto key = std::make_pair(CurFunc, VD->getNameAsString());
        if (!P.localAliases.count(key))
          P.localAliases[key] = std::to_string(
              lit->getValue().getSExtValue());
        counterVars.insert(key);
      }
      std::string annot;
      std::string surface = classify(VD->getInit(), &annot);
      if (surface.empty())
        continue;
      std::string name = VD->getNameAsString();
      P.varProv[{CurFunc, name}] = surface;
      if (!annot.empty())
        P.varAnnot[{CurFunc, name}] = annot;
      // Initializations in a gated region: the variable is gated.
      if (!GateStack.empty())
        for (const auto &gate : activeGates())
          if (gate.first != name)
            crossEdges.push_back(
                {gate.first, "head_guard", gate.second, name});
    }
    return true;
  }

  // A call argument classified as a surface marks the callee's parameter,
  // connecting header inline functions (vring_init etc.) to their callers.
  bool VisitCallExpr(CallExpr *CE) {
    std::string callee = resolveCalleeName(CE);
    if (callee.empty())
      return true;
    discoverSinks(CE, callee);
    SourceManager &SM = Ctx->getSourceManager();
    StringRef cn = callee;
    // Config reads (virtio_cread*(vdev, offsetof(S, F))): the read is of
    // the config field with its numeric offset.
    if (cn.starts_with("virtio_cread") && CE->getNumArgs() >= 2) {
      std::string s, f;
      long long off = 0;
      if (creadField(CE->getArg(1), Ctx, s, f, off)) {
        std::string node = s + "." + f;
        unsigned w = creadWidth(callee);
        P.nodeAnnot[node] = "MmioRead(offset=" + hexText(off) +
                            ", size_bytes=" + std::to_string(w) + ")";
        SourceLocation loc = CE->getExprLoc();
        reads.push_back({"Mmio", CurFunc, s, f, SM.getFilename(loc).str(),
                         SM.getSpellingLineNumber(loc)});
      }
    }
    // IO-family register accesses annotate the reading function.
    if (CE->getNumArgs() >= 1) {
      long long off = 0;
      unsigned width = 0;
      if (ioReadArg(CE->getArg(0), off, width, callee)) {
        std::string annot = "MmioRead(offset=" + hexText(off) +
                            ", size_bytes=" + std::to_string(width) + ")";
        if (!P.funcAnnot.count(CurFunc))
          P.funcAnnot[CurFunc] = annot;
      }
    }
    // Bit-test helpers in branch conditions yield feature-bit gates.
    if (GuardCtx) {
      auto bt = kBitTestHelpers.find(normalizeCallee(callee));
      if (bt != kBitTestHelpers.end())
        bitTestGate(CE, bt->second);
    }
    // memcpy/memmove/memset through a parameter destination: param-out with
    // the surface of the copied content (memcpy(buf, &b, ...) in vm_get).
    std::string norm = normalizeCallee(callee);
    if (norm == "memcpy" || norm == "memmove" || norm == "memset") {
      if (CE->getNumArgs() >= 2) {
        std::string dest = paramDerefName(CE->getArg(0));
        std::string srcSurface = classify(CE->getArg(1));
        if (!dest.empty() && !srcSurface.empty())
          P.paramOut[{CurFunc, dest}] = srcSurface;
      }
    }
    // Param-out surfaces propagate back to the actual target variables
    // (&ret at a config->get call receives the callee's write surface).
    auto fp = P.funcParams.find(callee);
    if (fp != P.funcParams.end()) {
      if (const char *dbg = getenv("SDG_AST_DEBUG"); dbg && *dbg &&
                                                     callee == "virtio_get_features")
        fprintf(stderr, "[dbg] pout-call %s args=%u params=%zu\n",
                callee.c_str(), CE->getNumArgs(), fp->second.size());
      unsigned n = std::min(CE->getNumArgs(),
                            (unsigned)fp->second.size());
      for (unsigned i = 0; i < n; ++i) {
        auto out = P.paramOut.find({callee, fp->second[i]});
        if (const char *dbg = getenv("SDG_AST_DEBUG");
            dbg && *dbg && callee.find("features") != std::string::npos)
          fprintf(stderr,
                  "[dbg] pout-arg %s arg %u param=%s found=%d (P has %s,%s: "
                  "%d)\n",
                  callee.c_str(), i, fp->second[i].c_str(),
                  out != P.paramOut.end(), callee.c_str(),
                  fp->second[i].c_str(),
                  P.paramOut.count({callee, fp->second[i]}));
        if (out == P.paramOut.end())
          continue;
        Expr *actual = CE->getArg(i)->IgnoreParenImpCasts();
        std::string target;
        if (auto *UO = dyn_cast<UnaryOperator>(actual)) {
          if (UO->getOpcode() == UO_AddrOf)
            target = varNameOf(UO->getSubExpr());
        } else if (auto *DRE = dyn_cast<DeclRefExpr>(actual)) {
          // Array decay: the actual is the array itself.
          target = DRE->getNameInfo().getAsString();
        }
        if (target.empty())
          continue;
        if (P.varProv[{CurFunc, target}].empty()) {
          P.varProv[{CurFunc, target}] = out->second;
          auto pa = P.paramAnnot.find({callee, fp->second[i]});
          if (pa != P.paramAnnot.end() && !pa->second.empty())
            P.varAnnot[{CurFunc, target}] = pa->second;
        }
        // Transitive param-out: when the target variable is a parameter of
        // the current function, the surface flows through it too.
        if (auto *DREDecl =
                dyn_cast<DeclRefExpr>(actual->IgnoreParenImpCasts())) {
          if (dyn_cast<ParmVarDecl>(DREDecl->getDecl())) {
            auto key = std::make_pair(CurFunc, target);
            if (!P.paramOut.count(key)) {
              P.paramOut[key] = out->second;
              auto pa = P.paramAnnot.find({callee, fp->second[i]});
              if (pa != P.paramAnnot.end() && !pa->second.empty())
                P.paramAnnot[key] = pa->second;
            }
          }
        }
      }
    }
    const FunctionDecl *FD = CE->getDirectCallee();
    if (!FD)
      return true;
    const FunctionDecl *def = FD->getDefinition();
    if (!def)
      return true;
    unsigned n = std::min(CE->getNumArgs(), def->getNumParams());
    for (unsigned i = 0; i < n; ++i) {
      std::string annot;
      std::string surface = classify(CE->getArg(i), &annot);
      if (surface.empty())
        continue;
      const ParmVarDecl *PD = def->getParamDecl(i);
      auto key = std::make_pair(def->getNameAsString(),
                                PD->getNameAsString());
      if (P.varProv[key].empty()) {
        P.varProv[key] = surface;
        if (!annot.empty())
          P.paramAnnot[key] = annot;
      }
    }
    return true;
  }
  // A function returning a surface marks its call sites' provenance.
  bool VisitReturnStmt(ReturnStmt *RS) {
    if (!RS->getRetValue() || CurFunc.empty())
      return true;
    std::string surface = classify(RS->getRetValue());
    if (surface.empty())
      return true;
    if (P.funcReturn[CurFunc].empty())
      P.funcReturn[CurFunc] = surface;
    return true;
  }

  // The callee name of a call: the direct callee, or the ops-table member's
  // implementing function for indirect calls (config->get etc.).
  std::string resolveCalleeName(CallExpr *CE) {
    const FunctionDecl *FD = CE->getDirectCallee();
    if (FD)
      return FD->getNameAsString();
    Expr *c = CE->getCallee()->IgnoreParenImpCasts();
    auto *ME = dyn_cast<MemberExpr>(c);
    if (!ME)
      return "";
    auto it = P.funcTable.find(memberKey(ME));
    return it != P.funcTable.end() ? it->second : "";
  }

  // Ops tables: `const struct X ops = { .get = fn, ... }` presets the
  // (struct, member) -> function contract used to resolve indirect calls.
  bool VisitVarDecl(VarDecl *VD) {
    if (!VD->hasInit())
      return true;
    auto *ILE = dyn_cast<InitListExpr>(VD->getInit()->IgnoreParenImpCasts());
    if (!ILE)
      return true;
    const RecordType *RT = VD->getType().split().Ty->getAsStructureType();
    if (!RT)
      return true;
    std::string structName = RT->getDecl()->getNameAsString();
    unsigned idx = 0;
    for (const FieldDecl *FD : RT->getDecl()->fields()) {
      if (idx >= ILE->getNumInits())
        break;
      Expr *init = ILE->getInit(idx)->IgnoreParenImpCasts();
      if (auto *DRE = dyn_cast<DeclRefExpr>(init)) {
        if (auto *fn = dyn_cast<FunctionDecl>(DRE->getDecl())) {
          Key k{structName, FD->getNameAsString()};
          if (!P.funcTable.count(k))
            P.funcTable[k] = fn->getNameAsString();
        }
      }
      ++idx;
    }
    return true;
  }

  // Assembly reads: the asm statement's outputs inherit the provenance of
  // its inputs (arm64 readl lowers the load to inline assembly).
  bool VisitGCCAsmStmt(GCCAsmStmt *S) {
    std::string surface;
    for (unsigned i = 0; i < S->getNumInputs() && surface.empty(); ++i)
      surface = classify(S->getInputExpr(i));
    if (surface.empty())
      return true;
    for (unsigned i = 0; i < S->getNumOutputs(); ++i) {
      Expr *out = S->getOutputExpr(i)->IgnoreParenImpCasts();
      if (auto *DRE = dyn_cast<DeclRefExpr>(out))
        P.varProv[{CurFunc, DRE->getNameInfo().getAsString()}] = surface;
    }
    return true;
  }

  bool VisitMemberExpr(MemberExpr *ME) {
    Key key = memberKey(ME);
    if (key.structName.empty())
      return true;
    // Write destinations are not reads.
    if (writtenMembers.count(ME))
      return true;
    // Flags set under gates bring their gates into the regions they gate.
    if (GuardCtx) {
      auto git = P.memberGates.find(key);
      if (git != P.memberGates.end())
        GuardCmps.insert(GuardCmps.end(), git->second.begin(),
                         git->second.end());
    }
    auto it = P.memberIndex.find(key);
    if (it == P.memberIndex.end())
      return true;
    std::string node = key.structName + "." + key.field;
    SourceManager &SM = Ctx->getSourceManager();
    SourceLocation loc = ME->getExprLoc();
    reads.push_back({it->second, CurFunc, key.structName, key.field,
                     SM.getFilename(loc).str(),
                     SM.getSpellingLineNumber(loc)});
    // Reads inside a guarded region emit head_guard cross-edges from every
    // active condition on a different variable.
    for (const auto &gate : activeGates()) {
      if (gate.first != node)
        crossEdges.push_back({gate.first, "head_guard", gate.second, node});
    }
    return true;
  }

  // All condition comparisons from enclosing guarded regions, innermost last.
  std::vector<std::pair<std::string, std::string>> activeGates() const {
    std::vector<std::pair<std::string, std::string>> out;
    for (const auto &gates : GateStack)
      out.insert(out.end(), gates.begin(), gates.end());
    return out;
  }

  // The name of the variable an address-of expression dereferences to, when
  // that variable is a function parameter (param-out writes).
  std::string paramDerefName(Expr *E) {
    E = E->IgnoreParenImpCasts();
    if (auto *UO = dyn_cast<UnaryOperator>(E)) {
      if (UO->getOpcode() == UO_Deref)
        E = UO->getSubExpr()->IgnoreParenImpCasts();
    }
    if (auto *DRE = dyn_cast<DeclRefExpr>(E)) {
      if (dyn_cast<ParmVarDecl>(DRE->getDecl()))
        return DRE->getNameInfo().getAsString();
    }
    return "";
  }

  // The raw variable name of an expression, tracked or not.
  static std::string varNameOf(Expr *E) {
    E = E->IgnoreParenImpCasts();
    if (auto *DRE = dyn_cast<DeclRefExpr>(E))
      return DRE->getNameInfo().getAsString();
    return "";
  }

  // The integer constant a local aliases (NETDEV_RSS_KEY_LEN etc.), if the
  // alias value is purely numeric.
  bool constAliasValue(Expr *E, long long &out) {
    std::string name = varNameOf(E);
    if (name.empty() || incVars.count({CurFunc, name}))
      return false;
    auto it = P.localAliases.find({CurFunc, name});
    if (it == P.localAliases.end() || it->second.empty())
      return false;
    size_t pos = 0;
    try {
      out = std::stoll(it->second, &pos);
    } catch (...) {
      return false;
    }
    return pos == it->second.size();
  }

  // The integer value of a constant expression (macro arithmetic like
  // VIRTIO_FEATURES_U64S), beyond literals and aliases.
  bool evalConst(Expr *E, long long &out) {
    Expr::EvalResult r;
    if (!E->EvaluateAsInt(r, *Ctx))
      return false;
    if (r.Val.getInt().getSignificantBits() > 63)
      return false;
    out = r.Val.getInt().getSExtValue();
    return true;
  }

  // One alias hop: writes through a local that aliases a parameter.
  std::string localAliasParam(Expr *E) {
    std::string local = varNameOf(E);
    if (local.empty())
      return "";
    auto it = P.localAliases.find({CurFunc, local});
    return it != P.localAliases.end() ? it->second : "";
  }

  bool VisitArraySubscriptExpr(ArraySubscriptExpr *AS) {
    std::string idx = trackedVar(AS->getIdx());
    if (idx.empty()) {
      // Loop counters: the bound is an offset fact (head_offset coverage).
      auto it = offsetBounds.find({CurFunc, varNameOf(AS->getIdx())});
      if (it == offsetBounds.end())
        return true;
      selfEdges.push_back(
          {it->first.second, "head_offset", it->second, CurFunc});
      return true;
    }
    auto it = cmpByVar.find(std::make_pair(CurFunc, idx));
    if (it == cmpByVar.end())
      return true;
    selfEdges.push_back({idx, "head_offset", predText(it->second), CurFunc});
    return true;
  }

  // A sink call fires when a contracted operand carries provenance.
  void discoverSinks(CallExpr *CE, const std::string &funcName) {
    auto contracts = kSinkContracts.find(normalizeCallee(funcName));
    if (contracts == kSinkContracts.end())
      return;
    SourceManager &SM = Ctx->getSourceManager();
    for (const SinkContract &c : contracts->second) {
      if (c.argIndex >= CE->getNumArgs())
        continue;
      Expr *arg = CE->getArg(c.argIndex);
      std::string surface = classify(arg);
      if (surface.empty())
        continue;
      SourceLocation loc = CE->getExprLoc();
      sinks.push_back({surface, funcName, c.role, c.argIndex,
                       SM.getFilename(loc).str(),
                       SM.getSpellingLineNumber(loc)});
      // The call contract is also a self-edge on the tracked operand, with
      // the bound established by a comparison on the same variable.
      std::string node = trackedVar(arg);
      if (node.empty())
        continue;
      auto bound = cmpByVar.find(std::make_pair(CurFunc, node));
      if (bound != cmpByVar.end())
        selfEdges.push_back({node, "head_call", predText(bound->second), CurFunc});
      // Sink operands inside a guarded region emit head_guard cross-edges.
      for (const auto &gate : activeGates()) {
        if (gate.first != node)
          crossEdges.push_back({gate.first, "head_guard", gate.second, node});
      }
    }
  }

  // The config-field node of a virtio_cread* call (S.F), with its
  // registered annotation.
  std::string creadNode(CallExpr *CE, std::string *annot) {
    if (CE->getNumArgs() < 2)
      return "";
    std::string s, f;
    long long off = 0;
    if (!creadField(CE->getArg(1), Ctx, s, f, off))
      return "";
    std::string node = s + "." + f;
    if (annot) {
      auto it = P.nodeAnnot.find(node);
      *annot = it != P.nodeAnnot.end() ? it->second : "";
    }
    return node;
  }

  // A bit-test helper call in a branch condition: the tested bitmap member
  // gates the region with one BitSet (BitClear under odd negations).
  void bitTestGate(
      CallExpr *CE,
      const std::tuple<unsigned, unsigned, std::string> &spec) {
    unsigned baseArg = std::get<0>(spec);
    unsigned fbitArg = std::get<1>(spec);
    const std::string &bitmapField = std::get<2>(spec);
    if (fbitArg >= CE->getNumArgs() || baseArg >= CE->getNumArgs())
      return;
    long long bit = 0;
    if (!literalOrAlias(CE->getArg(fbitArg), P, CurFunc, bit))
      return;
    std::string node;
    Expr *base = CE->getArg(baseArg)->IgnoreParenImpCasts();
    if (!bitmapField.empty()) {
      QualType bt = base->getType();
      bt = bt->getPointeeType();
      const RecordType *RT = bt.split().Ty->getAsStructureType();
      if (!RT)
        return;
      Key k{RT->getDecl()->getNameAsString(), bitmapField};
      if (!P.memberIndex.count(k))
        return;
      node = k.structName + "." + k.field;
    } else {
      node = trackedVar(base);
      if (node.empty())
        return;
    }
    std::string kind = (NegDepth % 2) ? "BitClear" : "BitSet";
    std::string text = kind + "(" + std::to_string(bit) + ")";
    GuardCmps.push_back({node, text});
    selfEdges.push_back({node, "head_guard", text, CurFunc});
  }

  // (surface, function, struct, field, file, line)
  std::vector<std::tuple<std::string, std::string, std::string, std::string,
                         std::string, unsigned>>
      reads;

  // (surface, function, role, argIndex, file, line)
  std::vector<std::tuple<std::string, std::string, std::string, unsigned,
                         std::string, unsigned>>
      sinks;

  std::vector<SelfEdge> selfEdges;
  std::vector<CrossEdge> crossEdges;
  std::set<const MemberExpr *> writtenMembers;

private:
  using Base = RecursiveASTVisitor<Visitor>;

  // The node name of a provenance-tracked expression, or "" when unknown.
  // Arithmetic and casts keep the base's provenance.
  std::string trackedVar(Expr *E) {
    E = E->IgnoreParenImpCasts();
    if (auto *cast = dyn_cast<CastExpr>(E)) {
      std::string r = trackedVar(cast->getSubExpr());
      if (!r.empty())
        return r;
    }
    if (auto *BO = dyn_cast<BinaryOperator>(E)) {
      std::string r = trackedVar(BO->getLHS());
      if (!r.empty())
        return r;
    }
    if (auto *UO = dyn_cast<UnaryOperator>(E)) {
      if (UO->getOpcode() == UO_AddrOf || UO->getOpcode() == UO_Deref) {
        std::string r = trackedVar(UO->getSubExpr());
        if (!r.empty())
          return r;
      }
      return "";
    }
    if (auto *DRE = dyn_cast<DeclRefExpr>(E)) {
      std::string name = DRE->getNameInfo().getAsString();
      // Alias hops first: the local aliases another tracked variable, or
      // a constant (NETDEV_RSS_KEY_LEN etc.).
      auto it = P.localAliases.find({CurFunc, name});
      if (it != P.localAliases.end() &&
          P.varProv.count({CurFunc, it->second}))
        return it->second;
      if (P.varProv.count({CurFunc, name}))
        return name;
      return "";
    }
    if (auto *CE2 = dyn_cast<CallExpr>(E)) {
      // A call with a marked return is an internal product; its node is the
      // reading function. Config-read calls resolve to the config field.
      std::string callee = resolveCalleeName(CE2);
      if (callee.empty())
        return "";
      StringRef n = callee;
      if (n.starts_with("virtio_cread")) {
        std::string node = creadNode(CE2, nullptr);
        if (!node.empty())
          return node;
      }
      auto it = P.funcReturn.find(callee);
      return it != P.funcReturn.end() ? callee : "";
    }
    if (auto *ME = dyn_cast<MemberExpr>(E)) {
      Key k = memberKey(ME);
      if (!k.structName.empty() && P.memberIndex.count(k))
        return k.structName + "." + k.field;
      return "";
    }
    if (auto *AS = dyn_cast<ArraySubscriptExpr>(E)) {
      Expr *base = AS->getBase()->IgnoreParenImpCasts();
      if (auto *ME = dyn_cast<MemberExpr>(base)) {
        Key k = memberKey(ME);
        if (!k.structName.empty() && P.memberIndex.count(k))
          return k.structName + "." + k.field;
      }
      if (auto *DRE = dyn_cast<DeclRefExpr>(base)) {
        std::string name = DRE->getNameInfo().getAsString();
        if (P.varProv.count({CurFunc, name}))
          return name;
      }
      return "";
    }
    return "";
  }

  // One side is a tracked var, the other an integer constant; or both sides
  // are tracked vars (a var-vs-var bound cross-edge).
  bool extractComparison(BinaryOperator *BO) {
    if (!BO->isComparisonOp())
      return false;
    Expr *L = BO->getLHS()->IgnoreParenImpCasts();
    Expr *R = BO->getRHS()->IgnoreParenImpCasts();
    auto *litL = dyn_cast<IntegerLiteral>(L);
    auto *litR = dyn_cast<IntegerLiteral>(R);
    std::string node;
    Pred pred;
    if (litR) {
      node = trackedVar(L);
      if (node.empty() || litR->getValue().getSignificantBits() > 63)
        return counterBound(BO, L, R);
      pred = predForOpcode(BO->getOpcode(), /*constLeft=*/false,
                           litR->getValue().getSExtValue());
    } else if (litL) {
      node = trackedVar(R);
      if (node.empty() || litL->getValue().getSignificantBits() > 63)
        return counterBound(BO, L, R);
      pred = predForOpcode(BO->getOpcode(), /*constLeft=*/true,
                           litL->getValue().getSExtValue());
    } else {
      // var-vs-var: a head_bound cross-edge between two tracked variables.
      // A side aliasing a constant (min_t's clamp operand) becomes the
      // constant of a var-vs-const self-edge instead.
      std::string nl = trackedVar(L);
      std::string nr = trackedVar(R);
      long long cl = 0, cr = 0;
      bool hasCl = constAliasValue(L, cl);
      bool hasCr = constAliasValue(R, cr);
      if (!nl.empty() && hasCr) {
        pred = predForOpcode(BO->getOpcode(), /*constLeft=*/false, cr);
        node = nl;
      } else if (!nr.empty() && hasCl) {
        pred = predForOpcode(BO->getOpcode(), /*constLeft=*/true, cl);
        node = nr;
      } else if (!nl.empty() && !nr.empty() && nl != nr) {
        crossEdges.push_back(
            {nl, "head_bound", predName(BO->getOpcode()), nr});
        degradeBound(BO->getOpcode(), nl, nr);
        return true;
      } else {
        return counterBound(BO, L, R);
      }
    }
    std::string text = predText(pred);
    auto key = std::make_pair(CurFunc, node);
    if (!cmpByVar.count(key))
      cmpByVar[key] = pred;
    if (GuardCtx)
      GuardCmps.push_back({node, text});
    selfEdges.push_back({node, GuardCtx ? "head_guard" : "head_bound", text,
                          CurFunc});
    return true;
  }

  // A loop counter's bound is an offset fact even when neither side has
  // surface provenance (i = 0; i < N; arr[i]).
  bool counterBound(BinaryOperator *BO, Expr *L, Expr *R) {
    std::string lname = varNameOf(L), rname = varNameOf(R);
    std::string counter;
    bool counterLeft = false;
    auto isCounter = [&](const std::string &n) {
      return counterVars.count({CurFunc, n}) && incVars.count({CurFunc, n});
    };
    if (isCounter(lname)) {
      counter = lname;
      counterLeft = true;
    } else if (isCounter(rname)) {
      counter = rname;
    } else {
      return false;
    }
    Expr *other = counterLeft ? R : L;
    long long c = 0;
    std::string text;
    if (constAliasValue(other, c) || evalConst(other, c)) {
      Pred p = predForOpcode(BO->getOpcode(), /*constLeft=*/!counterLeft, c);
      if (p.kind == "Unknown")
        return false;
      text = predText(p);
    } else {
      std::string bound = trackedVar(other);
      if (bound.empty())
        return false;
      Pred p = predForOpcode(BO->getOpcode(), /*constLeft=*/!counterLeft, 0);
      if (p.kind == "Unknown")
        return false;
      text = p.kind + "(" + bound + ")";
    }
    offsetBounds[{CurFunc, counter}] = text;
    return true;
  }

  // Sound boundary degrades for var-vs-var bounds against a clamped side:
  //   a >  b, b <= C  =>  Gt(C) on a        a <  b, b <= C  =>  Lt(C) on a
  //   a >  b, a <= C  =>  Lt(C) on b        a <= b, b <= C  =>  Le(C) on a
  //   a <= b, a <= C  =>  Le(C) on b        a >= b, a <= C  =>  Le(C) on b
  void degradeBound(BinaryOperator::Opcode op, const std::string &a,
                    const std::string &b) {
    auto ba = P.varBound.find(a);
    auto bb = P.varBound.find(b);
    std::string kind;
    const std::string *node = nullptr;
    long long c = 0;
    if (bb != P.varBound.end() && bb->second.first == "Le") {
      c = bb->second.second;
      if (op == BO_GT) {
        kind = "Gt";
        node = &a;
      } else if (op == BO_LT) {
        kind = "Lt";
        node = &a;
      } else if (op == BO_LE) {
        kind = "Le";
        node = &a;
      }
    }
    if (!node && ba != P.varBound.end() && ba->second.first == "Le") {
      c = ba->second.second;
      if (op == BO_GT) {
        kind = "Lt";
        node = &b;
      } else if (op == BO_GE) {
        kind = "Le";
        node = &b;
      }
    }
    if (!node || P.varBound.count(*node))
      return;
    std::string text = kind + "(" + std::to_string(c) + ")";
    auto key = std::make_pair(CurFunc, *node);
    if (!cmpByVar.count(key))
      cmpByVar[key] = Pred{kind, c, 0};
    selfEdges.push_back(
        {*node, GuardCtx ? "head_guard" : "head_bound", text, CurFunc});
  }

  // Descriptive relation name for var-vs-var bounds.
  static std::string predName(BinaryOperator::Opcode op) {
    switch (op) {
    case BO_EQ:
      return "Eq";
    case BO_NE:
      return "Ne";
    case BO_LT:
      return "Lt";
    case BO_GT:
      return "Gt";
    case BO_LE:
      return "Le";
    case BO_GE:
      return "Ge";
    default:
      return "Unknown";
    }
  }

  static Pred predForOpcode(BinaryOperator::Opcode op, bool constLeft,
                            long long value) {
    // const < var  ==  var > const, and so on: flip when const is on the left.
    switch (op) {
    case BO_EQ:
      return {"Eq", value, 0};
    case BO_NE:
      return {"Ne", value, 0};
    case BO_LT:
      return {constLeft ? "Gt" : "Lt", value, 0};
    case BO_GT:
      return {constLeft ? "Lt" : "Gt", value, 0};
    case BO_LE:
      return {constLeft ? "Ge" : "Le", value, 0};
    case BO_GE:
      return {constLeft ? "Le" : "Ge", value, 0};
    default:
      return {"Unknown", 0, 0};
    }
  }

  // var >= min && var <= max (either order) merges into InRange(min, max).
  void mergeRange(BinaryOperator *BO) {
    auto *L = dyn_cast<BinaryOperator>(BO->getLHS()->IgnoreParenImpCasts());
    auto *R = dyn_cast<BinaryOperator>(BO->getRHS()->IgnoreParenImpCasts());
    if (!L || !R || !L->isComparisonOp() || !R->isComparisonOp())
      return;
    Pred pl = predOfCmp(L);
    Pred pr = predOfCmp(R);
    if (pl.kind == "Unknown" || pr.kind == "Unknown")
      return;
    std::string nl = nodeOfCmp(L);
    std::string nr = nodeOfCmp(R);
    if (nl.empty() || nl != nr)
      return;
    Pred lower = pl, upper = pr;
    if (lower.kind == "Le" || lower.kind == "Lt")
      std::swap(lower, upper);
    if ((lower.kind != "Ge" && lower.kind != "Gt") ||
        (upper.kind != "Le" && upper.kind != "Lt"))
      return;
    Pred in{"InRange", lower.value, upper.value};
    std::string text = predText(in);
    auto key = std::make_pair(CurFunc, nl);
    if (!cmpByVar.count(key))
      cmpByVar[key] = in;
    selfEdges.push_back({nl, GuardCtx ? "head_guard" : "head_bound", text,
                           CurFunc});
  }

  // min_t/max_t clamps: a ternary in a statement expression whose condition
  // compares one operand against a constant. min_t bounds the value at the
  // constant from above (Le); max_t from below (Ge).
  bool stmtExprClamp(Expr *E, std::string &kind, long long &C) {
    E = E->IgnoreParenImpCasts();
    auto *SE = dyn_cast<StmtExpr>(E);
    if (!SE)
      return false;
    for (const Stmt *sub : SE->getSubStmt()->body()) {
      auto *subExpr = dyn_cast_or_null<Expr>(const_cast<Stmt *>(sub));
      if (!subExpr)
        continue;
      auto *CO = dyn_cast<ConditionalOperator>(subExpr->IgnoreParenImpCasts());
      if (!CO)
        continue;
      auto *BO = dyn_cast<BinaryOperator>(CO->getCond()->IgnoreParenImpCasts());
      if (!BO || !BO->isComparisonOp())
        continue;
      Expr *L = BO->getLHS()->IgnoreParenImpCasts();
      Expr *R = BO->getRHS()->IgnoreParenImpCasts();
      long long c = 0;
      if (!literalOrAlias(L, P, CurFunc, c) &&
          !literalOrAlias(R, P, CurFunc, c))
        continue;
      std::string tName = varNameOf(CO->getTrueExpr());
      std::string fName = varNameOf(CO->getFalseExpr());
      std::string lName = varNameOf(L);
      std::string rName = varNameOf(R);
      bool armsSelect =
          (tName == lName || tName == rName) &&
          (fName == lName || fName == rName || fName.empty());
      if (!armsSelect)
        continue;
      switch (BO->getOpcode()) {
      case BO_LT:
      case BO_LE:
        kind = "Le";
        C = c;
        return true;
      case BO_GT:
      case BO_GE:
        kind = "Ge";
        C = c;
        return true;
      default:
        continue;
      }
    }
    return false;
  }

  // Helpers for mergeRange: the tracked var and predicate of one comparison.
  std::string nodeOfCmp(BinaryOperator *BO) {
    std::string node;
    Pred pred;
    Pred saved;
    (void)saved;
    Expr *L = BO->getLHS()->IgnoreParenImpCasts();
    Expr *R = BO->getRHS()->IgnoreParenImpCasts();
    auto *litR = dyn_cast<IntegerLiteral>(R);
    auto *litL = dyn_cast<IntegerLiteral>(L);
    if (litR)
      return trackedVar(L);
    if (litL)
      return trackedVar(R);
    return "";
  }

  static Pred predOfCmp(BinaryOperator *BO) {
    Expr *L = BO->getLHS()->IgnoreParenImpCasts();
    Expr *R = BO->getRHS()->IgnoreParenImpCasts();
    auto *litR = dyn_cast<IntegerLiteral>(R);
    auto *litL = dyn_cast<IntegerLiteral>(L);
    if (litR && litR->getValue().getSignificantBits() <= 63)
      return predForOpcode(BO->getOpcode(), false,
                           litR->getValue().getSExtValue());
    if (litL && litL->getValue().getSignificantBits() <= 63)
      return predForOpcode(BO->getOpcode(), true,
                           litL->getValue().getSExtValue());
    return {"Unknown", 0, 0};
  }

  // A mask truth test (var & mask) yields BitSet per set bit; an odd number
  // of logical negations yields BitClear.
  void extractMask(BinaryOperator *BO) {
    if (BO->getOpcode() != BO_And)
      return;
    Expr *L = BO->getLHS()->IgnoreParenImpCasts();
    Expr *R = BO->getRHS()->IgnoreParenImpCasts();
    auto *litR = dyn_cast<IntegerLiteral>(R);
    auto *litL = dyn_cast<IntegerLiteral>(L);
    const IntegerLiteral *mask = litR ? litR : (litL ? litL : nullptr);
    if (!mask)
      return;
    std::string node = litR ? trackedVar(L) : trackedVar(R);
    if (node.empty())
      return;
    std::string kind = (NegDepth % 2) ? "BitClear" : "BitSet";
    llvm::APInt value = mask->getValue();
    for (unsigned bit = 0; bit < value.getBitWidth(); ++bit) {
      if (!value[bit])
        continue;
      std::string text = kind + "(" + std::to_string(bit) + ")";
      auto key = std::make_pair(CurFunc, node);
      Pred p{kind, (long long)bit, 0};
      if (!cmpByVar.count(key))
        cmpByVar[key] = p;
      selfEdges.push_back({node, GuardCtx ? "head_guard" : "head_bound", text,
                          CurFunc});
    }
  }

  static Key memberKey(MemberExpr *ME) {
    QualType bt = ME->getBase()->getType();
    if (ME->isArrow())
      bt = bt->getPointeeType();
    const Type *ty = bt.split().Ty;
    const RecordType *RT = ty->getAsStructureType();
    if (!RT)
      RT = ty->getAsUnionType();
    if (!RT)
      return {};
    std::string structName = RT->getDecl()->getNameAsString();
    if (structName.empty()) {
      // Anonymous record member (VIRTIO_DECLARE_FEATURES's union): resolve
      // the named record from the base's own member chain.
      Expr *base = ME->getBase()->IgnoreParenImpCasts();
      if (auto *outer = dyn_cast<MemberExpr>(base))
        structName = memberKey(const_cast<MemberExpr *>(outer)).structName;
    }
    if (structName.empty())
      return {};
    return {structName, ME->getMemberDecl()->getNameAsString()};
  }

  // The surface provenance of an expression, or "" when unknown. When
  // annot is given it receives the register-read annotation, if known.
  std::string classify(Expr *E, std::string *annot = nullptr) {
    E = E->IgnoreParenImpCasts();
    if (auto *CE = dyn_cast<CallExpr>(E)) {
      std::string callee = resolveCalleeName(CE);
      if (callee.empty())
        return "";
      StringRef n = callee;
      if (n.starts_with("virtio_cread")) {
        if (annot) {
          std::string cn = creadNode(CE, annot);
          if (!cn.empty())
            return "Mmio";
        }
      }
      if (isMmioRoot(n))
        return "Mmio";
      if (isCoherentRoot(n))
        return "Coherent";
      if (isStreamingRoot(n))
        return "Streaming";
      auto it = P.funcReturn.find(n.str());
      if (it != P.funcReturn.end()) {
        if (annot) {
          auto ai = P.funcAnnot.find(n.str());
          if (ai != P.funcAnnot.end())
            *annot = ai->second;
        }
        return it->second;
      }
      return "";
    }
    if (auto *cast = dyn_cast<CastExpr>(E))
      return classify(cast->getSubExpr(), annot);
    if (auto *SE = dyn_cast<StmtExpr>(E)) {
      // Statement expressions (min_t etc.): the first classified expression
      // in the compound carries the provenance.
      for (const Stmt *sub : SE->getSubStmt()->body()) {
        if (auto *DSt = dyn_cast<DeclStmt>(sub)) {
          for (Decl *d : DSt->decls()) {
            if (auto *VD = dyn_cast<VarDecl>(d); VD && VD->getInit()) {
              std::string s = classify(VD->getInit(), annot);
              if (!s.empty())
                return s;
            }
          }
          continue;
        }
        if (auto *AsExpr = llvm::dyn_cast<Expr>(const_cast<Stmt *>(sub))) {
          std::string s = classify(AsExpr, annot);
          if (!s.empty())
            return s;
        }
      }
      return "";
    }
    if (auto *COp = dyn_cast<ConditionalOperator>(E)) {
      std::string l = classify(COp->getTrueExpr(), annot);
      return !l.empty() ? l : classify(COp->getFalseExpr(), annot);
    }
    if (auto *BO = dyn_cast<BinaryOperator>(E)) {
      std::string surface = classify(BO->getLHS(), annot);
      return !surface.empty() ? surface : classify(BO->getRHS(), annot);
    }
    if (auto *UO = dyn_cast<UnaryOperator>(E)) {
      if (UO->getOpcode() == UO_AddrOf || UO->getOpcode() == UO_Deref)
        return classify(UO->getSubExpr(), annot);
      return "";
    }
    if (auto *ME = dyn_cast<MemberExpr>(E)) {
      auto it = P.memberIndex.find(memberKey(ME));
      if (it == P.memberIndex.end())
        return "";
      if (annot) {
        auto ai = P.memberAnnot.find(memberKey(ME));
        if (ai != P.memberAnnot.end())
          *annot = ai->second;
      }
      return it->second;
    }
    if (auto *AS = dyn_cast<ArraySubscriptExpr>(E)) {
      Expr *base = AS->getBase()->IgnoreParenImpCasts();
      if (auto *ME = dyn_cast<MemberExpr>(base)) {
        auto it = P.memberIndex.find(memberKey(ME));
        if (it == P.memberIndex.end())
          return "";
        if (annot) {
          auto ai = P.memberAnnot.find(memberKey(ME));
          if (ai != P.memberAnnot.end())
            *annot = ai->second;
        }
        return it->second;
      }
      if (auto *DRE = dyn_cast<DeclRefExpr>(base)) {
        auto it = P.varProv.find({CurFunc, DRE->getNameInfo().getAsString()});
        if (it == P.varProv.end())
          return "";
        if (annot) {
          auto ai = P.varAnnot.find({CurFunc, DRE->getNameInfo().getAsString()});
          if (ai != P.varAnnot.end())
            *annot = ai->second;
        }
        return it->second;
      }
      return "";
    }
    if (auto *DRE = dyn_cast<DeclRefExpr>(E)) {
      auto it =
          P.varProv.find({CurFunc, DRE->getNameInfo().getAsString()});
      if (it == P.varProv.end())
        return "";
      if (annot) {
        auto ai = P.varAnnot.find({CurFunc, DRE->getNameInfo().getAsString()});
        if (ai != P.varAnnot.end())
          *annot = ai->second;
      }
      return it->second;
    }
    return "";
  }

  ASTContext *Ctx;
  Provenance &P;
  std::string CurFunc;
  bool GuardCtx = false;
  unsigned NegDepth = 0;
  std::map<std::pair<std::string, std::string>, Pred> cmpByVar;
  // Comparisons collected from the condition currently being traversed, and
  // the stack of active gates for guarded regions.
  std::vector<std::pair<std::string, std::string>> GuardCmps;
  std::vector<std::vector<std::pair<std::string, std::string>>> GateStack;
  // Loop counters: locals assigned an integer constant (i = 0). Their bound
  // is an offset fact even without surface provenance. A counter varies,
  // so only incremented locals (incVars) are counters; const-assigned but
  // never-modified locals keep their alias as a true constant (clamp
  // operands like uy = 256).
  std::set<std::pair<std::string, std::string>> counterVars;
  std::set<std::pair<std::string, std::string>> incVars;
  // (func, counter) -> offset predicate text (Lt(64), Lt(rss_indir_table_size)).
  std::map<std::pair<std::string, std::string>, std::string> offsetBounds;
};

// The mutation hint for a target-state predicate kind.
static std::string hintFor(const std::string &kind, const std::string &node,
                           const std::string &value) {
  if (kind == "Gt")
    return "SetBoundary(" + node + ", Above)";
  if (kind == "Lt")
    return "SetBoundary(" + node + ", Below)";
  if (kind == "Ge")
    return "SetBoundary(" + node + ", Min)";
  if (kind == "Le")
    return "SetBoundary(" + node + ", Max)";
  if (kind == "Eq" || kind == "Ne")
    return "SetValue(" + node + ", " + value + ")";
  if (kind == "InRange")
    return "SampleRange(" + node + ", " + value + ")";
  if (kind == "BitSet")
    return "SetBits(" + node + ")";
  if (kind == "BitClear")
    return "ClearBits(" + node + ")";
  return "Keep(" + node + ")";
}

// The register-read annotation of a rule variable, where derivable.
static std::string varAnnotFor(const Provenance &P, const std::string &node,
                               const std::string &function) {
  auto na = P.nodeAnnot.find(node);
  if (na != P.nodeAnnot.end())
    return na->second;
  size_t dot = node.find('.');
  if (dot != std::string::npos) {
    Key k{node.substr(0, dot), node.substr(dot + 1)};
    auto ma = P.memberAnnot.find(k);
    if (ma != P.memberAnnot.end())
      return ma->second;
  }
  auto va = P.varAnnot.find({function, node});
  if (va != P.varAnnot.end())
    return va->second;
  return "";
}

// Assemble rules: every relational self-edge becomes a target state; its
// preconditions are the cross-edges pointing at the same node; the hint
// follows the predicate kind.
static std::vector<Rule> assembleRules(const Provenance &P,
                                       const std::vector<SelfEdge> &selfs,
                                       const std::vector<CrossEdge> &cross) {
  std::set<std::string> seen;
  std::vector<Rule> out;
  for (const SelfEdge &e : selfs) {
    size_t open = e.pred.find('(');
    if (open == std::string::npos)
      continue;
    std::string kind = e.pred.substr(0, open);
    std::string value = e.pred.substr(open + 1);
    size_t close = value.find(')');
    if (close != std::string::npos)
      value = value.substr(0, close);
    Rule r;
    r.id = "rule:" + e.function + "|target:" + e.node + "|predicate:" +
           e.pred;
    if (!seen.insert(r.id).second)
      continue;
    r.target = e;
    std::string annot = varAnnotFor(P, e.node, e.function);
    r.vars.push_back(annot.empty() ? e.node : e.node + " = " + annot);
    for (const CrossEdge &c : cross) {
      if (c.dst != e.node)
        continue;
      r.preconditions.push_back(c);
      if (c.src != e.node) {
        std::string sa = varAnnotFor(P, c.src, "");
        r.vars.push_back(sa.empty() ? c.src : c.src + " = " + sa);
      }
    }
    r.hint = hintFor(kind, e.node, value);
    out.push_back(std::move(r));
  }
  return out;
}

// Results accumulated across translation units.
struct Accumulator {
  Provenance P;
  std::vector<std::tuple<std::string, std::string, std::string, std::string,
                         std::string, unsigned>>
      reads;
  std::vector<std::tuple<std::string, std::string, std::string, unsigned,
                         std::string, unsigned>>
      sinks;
  std::vector<SelfEdge> selfEdges;
  std::vector<CrossEdge> crossEdges;
};

class Consumer : public ASTConsumer {
public:
  explicit Consumer(Accumulator &acc, bool collect)
      : acc(acc), collect(collect) {}

  void HandleTranslationUnit(ASTContext &Ctx) override {
    Visitor V(&Ctx, acc.P);
    // Repeat until the indexes stabilize so member chains that reference
    // later assignments resolve too.
    for (int pass = 0; pass < 64; ++pass) {
      size_t before = acc.P.size();
      V.TraverseDecl(Ctx.getTranslationUnitDecl());
      size_t after = acc.P.size();
      if (const char *dbg = getenv("SDG_AST_DEBUG"); dbg && *dbg)
        fprintf(stderr,
                "[dbg] pass %d: memberIndex=%zu funcReturn=%zu varProv=%zu "
                "paramOut=%zu\n",
                pass, acc.P.memberIndex.size(), acc.P.funcReturn.size(),
                acc.P.varProv.size(), acc.P.paramOut.size());
      if (after == before)
        break;
    }
    if (!collect)
      return;
    V.reads.clear();
    V.sinks.clear();
    V.selfEdges.clear();
    V.crossEdges.clear();
    V.writtenMembers.clear();
    V.TraverseDecl(Ctx.getTranslationUnitDecl());
    acc.reads.insert(acc.reads.end(), V.reads.begin(), V.reads.end());
    acc.sinks.insert(acc.sinks.end(), V.sinks.begin(), V.sinks.end());
    acc.selfEdges.insert(acc.selfEdges.end(), V.selfEdges.begin(),
                         V.selfEdges.end());
    acc.crossEdges.insert(acc.crossEdges.end(), V.crossEdges.begin(),
                          V.crossEdges.end());
  }

private:
  Accumulator &acc;
  bool collect;
};

class Action : public ASTFrontendAction {
public:
  explicit Action(Accumulator &acc, bool collect)
      : acc(acc), collect(collect) {}

  std::unique_ptr<ASTConsumer>
  CreateASTConsumer(CompilerInstance &, StringRef) override {
    return std::make_unique<Consumer>(acc, collect);
  }

private:
  Accumulator &acc;
  bool collect;
};

class AccActionFactory : public clang::tooling::FrontendActionFactory {
public:
  explicit AccActionFactory(Accumulator &acc, bool collect)
      : acc(acc), collect(collect) {}

  std::unique_ptr<clang::FrontendAction> create() override {
    return std::make_unique<Action>(acc, collect);
  }

private:
  Accumulator &acc;
  bool collect;
};

// One tool round over all sources. Converge-only rounds fill the shared
// provenance; the collection round gathers edges with converged tables.
static int runScan(const std::vector<std::string> &Args,
                   const std::vector<std::string> &Sources,
                   Accumulator &acc, bool collect) {
  clang::tooling::FixedCompilationDatabase Compilations(".", Args);
  clang::tooling::ClangTool Tool(Compilations, Sources);
  Tool.appendArgumentsAdjuster(
      clang::tooling::getInsertArgumentAdjuster("-Wno-everything",
                                                clang::tooling::ArgumentInsertPosition::BEGIN));
  AccActionFactory factory(acc, collect);
  return Tool.run(&factory);
}

static void printSummary(const Accumulator &acc) {
  std::map<std::string, int> bySurface;
  std::map<std::string, int> sinksBySurface;
  std::map<std::string, int> edgesByHead;
  std::map<std::string, int> crossByHead;
  std::map<std::string, int> selfByPred;
  std::map<std::string, int> crossByPred;
  for (const auto &r : acc.reads)
    bySurface[std::get<0>(r)]++;
  for (const auto &s : acc.sinks)
    sinksBySurface[std::get<0>(s)]++;
  for (const auto &e : acc.selfEdges) {
    edgesByHead[e.head]++;
    selfByPred[predKind(e.pred)]++;
  }
  for (const auto &e : acc.crossEdges) {
    crossByHead[e.head]++;
    crossByPred[predKind(e.pred)]++;
  }
  printf("reads classified: %zu\n", acc.reads.size());
  for (const auto &kv : bySurface)
    printf("  %s: %d\n", kv.first.c_str(), kv.second);
  printf("sinks discovered: %zu\n", acc.sinks.size());
  for (const auto &kv : sinksBySurface)
    printf("  %s: %d\n", kv.first.c_str(), kv.second);
  printf("self-edges built: %zu\n", acc.selfEdges.size());
  for (const auto &kv : edgesByHead)
    printf("  %s: %d\n", kv.first.c_str(), kv.second);
  for (const auto &kv : selfByPred)
    printf("  predicate %s: %d\n", kv.first.c_str(), kv.second);
  printf("cross-edges built: %zu\n", acc.crossEdges.size());
  for (const auto &kv : crossByHead)
    printf("  %s: %d\n", kv.first.c_str(), kv.second);
  for (const auto &kv : crossByPred)
    printf("  predicate %s: %d\n", kv.first.c_str(), kv.second);

  // Head and predicate coverage against the model enumerations.
  const std::vector<std::string> selfHeads = {"head_guard", "head_bound",
                                              "head_offset", "head_call"};
  const std::vector<std::string> crossHeads = {"head_guard", "head_dataflow",
                                               "head_bound"};
  const std::vector<std::string> modelPreds = {"BitSet", "BitClear", "Eq",
                                               "Lt",     "Gt",       "Le",
                                               "Ge",     "InRange",  "Identity"};
  printf("head coverage:\n");
  int covered = 0;
  printf("  self:");
  for (const auto &h : selfHeads) {
    auto it = edgesByHead.find(h);
    int n = it != edgesByHead.end() ? it->second : 0;
    printf(" %s %d", h.c_str(), n);
    if (n)
      covered++;
  }
  printf("  (%d/%zu)\n", covered, selfHeads.size());
  covered = 0;
  printf("  cross:");
  for (const auto &h : crossHeads) {
    auto it = crossByHead.find(h);
    int n = it != crossByHead.end() ? it->second : 0;
    printf(" %s %d", h.c_str(), n);
    if (n)
      covered++;
  }
  printf("  (%d/%zu)\n", covered, crossHeads.size());
  covered = 0;
  printf("predicate coverage:");
  for (const auto &k : modelPreds) {
    int n = selfByPred.count(k) ? selfByPred.at(k) : 0;
    n += crossByPred.count(k) ? crossByPred.at(k) : 0;
    printf(" %s %d", k.c_str(), n);
    if (n)
      covered++;
  }
  printf("  (%d/%zu)\n", covered, modelPreds.size());
  for (const auto &kv : selfByPred)
    if (std::find(modelPreds.begin(), modelPreds.end(), kv.first) ==
        modelPreds.end())
      printf("  outside contract: %s %d (self)\n", kv.first.c_str(),
             kv.second);
  for (const auto &kv : crossByPred)
    if (std::find(modelPreds.begin(), modelPreds.end(), kv.first) ==
        modelPreds.end())
      printf("  outside contract: %s %d (cross)\n", kv.first.c_str(),
             kv.second);
  int shown = 0;
  for (const auto &r : acc.reads) {
    if (shown++ >= 4000)
      break;
    printf("  [%s] %s:%u %s.%s (in %s)\n", std::get<0>(r).c_str(),
           std::get<4>(r).c_str(), std::get<5>(r), std::get<2>(r).c_str(),
           std::get<3>(r).c_str(), std::get<1>(r).c_str());
  }
  shown = 0;
  for (const auto &s : acc.sinks) {
    if (shown++ >= 4000)
      break;
    printf("  sink[%s] %s:%u %s arg%u role=%s\n", std::get<0>(s).c_str(),
           std::get<4>(s).c_str(), std::get<5>(s), std::get<1>(s).c_str(),
           std::get<3>(s), std::get<2>(s).c_str());
  }
  shown = 0;
  for (const auto &e : acc.selfEdges) {
    if (shown++ >= 4000)
      break;
    printf("  %s --[%s, %s]--> %s\n", e.node.c_str(), e.head.c_str(),
           e.pred.c_str(), e.node.c_str());
  }
  shown = 0;
  for (const auto &e : acc.crossEdges) {
    if (shown++ >= 4000)
      break;
    printf("  %s --[%s, %s]--> %s\n", e.src.c_str(), e.head.c_str(),
           e.pred.c_str(), e.dst.c_str());
  }

  std::vector<Rule> rules =
      assembleRules(acc.P, acc.selfEdges, acc.crossEdges);
  printf("rules assembled: %zu\n", rules.size());
  for (const Rule &r : rules) {
    printf("\nrule: %s\n", r.id.c_str());
    printf("vars:\n");
    for (const auto &v : r.vars)
      printf("  %s\n", v.c_str());
    if (!r.preconditions.empty()) {
      printf("preconditions:\n");
      for (const auto &c : r.preconditions)
        printf("  %s --[%s, %s]--> %s\n", c.src.c_str(), c.head.c_str(),
               c.pred.c_str(), c.dst.c_str());
    }
    printf("target_state:\n  %s --[%s, %s]--> %s\n",
           r.target.node.c_str(), r.target.head.c_str(),
           r.target.pred.c_str(), r.target.node.c_str());
    printf("mutation_hint:\n  %s\n", r.hint.c_str());
  }
}

} // namespace

// argv[1]: compile-args file (one flag per line); argv[2..]: source files
// (related translation units analyzed together share the provenance).
int main(int argc, const char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <compile-args-file> <source.c>...\n", argv[0]);
    return 1;
  }
  std::vector<std::string> Args;
  FILE *f = fopen(argv[1], "r");
  if (!f) {
    fprintf(stderr, "error: cannot read args file %s\n", argv[1]);
    return 1;
  }
  char line[4096];
  while (fgets(line, sizeof(line), f)) {
    std::string s(line);
    while (!s.empty() && (s.back() == '\n' || s.back() == ' '))
      s.pop_back();
    if (!s.empty())
      Args.push_back(s);
  }
  fclose(f);

  std::vector<std::string> Sources(argv + 2, argv + argc);
  Accumulator acc;
  // Phase A: converge the shared provenance over all sources until it
  // stabilizes, so chains that cross translation units (ops tables,
  // transports feeding consumers) close regardless of the source order.
  size_t last = 0;
  int rc = 0;
  for (int round = 0; round < 8; ++round) {
    rc = runScan(Args, Sources, acc, /*collect=*/false);
    size_t now = acc.P.size();
    if (now == last)
      break;
    last = now;
  }
  // Phase B: collect edges with converged provenance.
  runScan(Args, Sources, acc, /*collect=*/true);
  if (const char *dbg = getenv("SDG_AST_DEBUG"); dbg && *dbg) {
    fprintf(stderr, "[dbg] ALL paramOut (%zu):\n", acc.P.paramOut.size());
    for (const auto &kv : acc.P.paramOut)
      fprintf(stderr, "[dbg]   (%s, %s) -> %s\n",
              kv.first.first.c_str(), kv.first.second.c_str(),
              kv.second.c_str());
    fprintf(stderr, "[dbg] funcTable:\n");
    for (const auto &kv : acc.P.funcTable)
      fprintf(stderr, "[dbg]   (%s, %s) -> %s\n",
              kv.first.structName.c_str(), kv.first.field.c_str(),
              kv.second.c_str());
    for (const std::string &fn :
         {"vm_get", "readl", "readb", "virtio_cread8", "virtio_cread16"})
      fprintf(stderr, "[dbg] funcParams %s: %zu\n", fn.c_str(),
              acc.P.funcParams.count(fn) ? acc.P.funcParams.at(fn).size() : 0);
    for (const std::string &fn :
         {"vm_get", "readl", "readb", "virtio_cread8", "virtio_cread16"}) {
      auto fr = acc.P.funcReturn.find(fn);
      fprintf(stderr, "[dbg] funcReturn %s -> %s\n", fn.c_str(),
              fr != acc.P.funcReturn.end() ? fr->second.c_str() : "(none)");
    }
    for (const auto &kv : acc.P.paramOut)
      if (kv.first.first == "vm_get")
        fprintf(stderr, "[dbg] paramOut (vm_get, %s) -> %s\n",
                kv.first.second.c_str(), kv.second.c_str());
    for (const std::string &var :
         {"key_sz", "vi", "val", "ret", "device_features", "features_out",
          "features"})
      for (const auto &kv : acc.P.varProv)
        if (kv.first.second == var)
          fprintf(stderr, "[dbg] varProv (%s, %s) -> %s\n",
                  kv.first.first.c_str(), kv.first.second.c_str(),
                  kv.second.c_str());
    for (const auto &kv : acc.P.memberIndex)
      if (kv.first.structName.find("virtnet_info") != std::string::npos ||
          kv.first.structName.find("virtio") != std::string::npos)
        fprintf(stderr, "[dbg] memberIndex (%s, %s) -> %s\n",
                kv.first.structName.c_str(), kv.first.field.c_str(),
                kv.second.c_str());
    for (const std::string &fn : {"netdev_priv", "virtio_has_feature",
                                  "__virtio_test_bit"})
      for (const auto &kv : acc.P.varProv)
        if (kv.first.first == fn)
          fprintf(stderr, "[dbg] varProv (%s, %s) -> %s\n",
                  kv.first.first.c_str(), kv.first.second.c_str(),
                  kv.second.c_str());
    for (const std::string &fn :
         {"vm_get_features", "virtio_get_features",
          "virtio_features_from_u64", "virtio_features_set_bit",
          "virtio_features_test_bit", "__virtio_test_bit"}) {
      auto fr = acc.P.funcReturn.find(fn);
      fprintf(stderr, "[dbg] funcReturn %s -> %s\n", fn.c_str(),
              fr != acc.P.funcReturn.end() ? fr->second.c_str() : "(none)");
      for (const auto &kv : acc.P.varProv)
        if (kv.first.first == fn)
          fprintf(stderr, "[dbg] varProv (%s, %s) -> %s\n",
                  kv.first.first.c_str(), kv.first.second.c_str(),
                  kv.second.c_str());
      for (const auto &kv : acc.P.paramOut)
        if (kv.first.first == fn)
          fprintf(stderr, "[dbg] paramOut (%s, %s) -> %s\n",
                  kv.first.first.c_str(), kv.first.second.c_str(),
                  kv.second.c_str());
    }
  }
  printSummary(acc);
  return rc;
}
