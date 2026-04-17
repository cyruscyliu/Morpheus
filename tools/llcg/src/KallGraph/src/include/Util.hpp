#ifndef UNIAS_UTIL_H
#define UNIAS_UTIL_H

#define THRESHOLD 10000
#define DEFCONFIG 50
#define ALLYESCONFIG 50

#include "SVF-LLVM/LLVMUtil.h"
#include "SVF-LLVM/LLVMModule.h"
#include "SVF-LLVM/SVFIRBuilder.h"
#include <fstream>
#include <string>

using namespace SVF;
using namespace llvm;
using namespace std;

using SVFModule = LLVMModuleSet;
StructType *ifPointToStruct(const Type *tp);

inline LLVMModuleSet *llvmModuleSet() {
  return LLVMModuleSet::getLLVMModuleSet();
}

inline NodeID getValueNode(const Value *value) {
  return llvmModuleSet()->getValueNode(value);
}

inline bool hasValueNode(const Value *value) {
  return llvmModuleSet()->hasValueNode(value);
}

inline const Value *getLLVMValue(const SVFValue *value) {
  if (!value || !llvmModuleSet()->hasLLVMValue(value)) {
    return nullptr;
  }
  return llvmModuleSet()->getLLVMValue(value);
}

inline const Type *getLLVMType(const SVFType *type) {
  return type ? llvmModuleSet()->getLLVMType(type) : nullptr;
}

inline Type *getLLVMType(SVFType *type) {
  return const_cast<Type *>(getLLVMType(const_cast<const SVFType *>(type)));
}

inline uint64_t getTypeSizeInBytes(const Type *type) {
  return LLVMUtil::getDataLayout(llvmModuleSet()->getMainLLVMModule())
      ->getTypeStoreSize(const_cast<Type *>(type));
}

extern int baseNum;

extern llvm::cl::opt<std::string> SpecifyInput;

extern unordered_set<string> NewInitFuncstr;

extern unordered_set<NodeID> BlockedNodes;

extern unordered_map<NodeID, unordered_map<SVFStmt *, unordered_set<NodeID>>>
    phiIn;
extern unordered_map<NodeID, unordered_map<SVFStmt *, unordered_set<NodeID>>>
    phiOut;

extern unordered_map<NodeID, unordered_map<SVFStmt *, unordered_set<NodeID>>>
    selectIn;
extern unordered_map<NodeID, unordered_map<SVFStmt *, unordered_set<NodeID>>>
    selectOut;

extern unordered_set<NodeID> traceNodes;
extern unordered_set<const CallInst *> traceiCalls;

extern unordered_set<const Function *> SELinuxfuncs;
extern unordered_set<NodeID> SELinuxNodes;
extern unordered_set<const CallInst *> SELinuxicalls;

extern unordered_map<string, unordered_set<Function *>> type2funcs;

extern unordered_map<string, unordered_map<u32_t, unordered_set<PAGEdge *>>>
    typebasedShortcuts;
extern unordered_map<
    string, unordered_map<u32_t, unordered_set<unordered_set<PAGEdge *> *>>>
    additionalShortcuts;
extern unordered_map<string, unordered_set<PAGEdge *>> castSites;
extern unordered_map<PAGEdge *, unordered_map<u32_t, unordered_set<string>>>
    reverseShortcuts;
extern unordered_map<PAGNode *, PAGEdge *> gepIn;

extern unordered_map<const PAGEdge *, long> gep2byteoffset;
extern unordered_set<const PAGEdge *> variantGep;

extern unordered_map<StructType *, string> deAnonymousStructs;

extern unordered_map<const Function *, unordered_set<CallInst *>>
    GlobalDepFuncs;
extern unordered_map<CallInst *, unordered_set<CallInst *>> GlobalDepiCalls;
extern unordered_set<const Function *> newTargets;
extern unordered_set<CallInst *> fixediCalls;
extern unordered_set<CallInst *> newiCalls;
extern unordered_map<const CallInst *, unordered_set<const Function *>>
    callgraph;
extern size_t callgraph_size;

extern unordered_map<NodeID, unordered_set<NodeID>> Real2Formal;
extern unordered_map<NodeID, unordered_set<NodeID>> Formal2Real;
extern unordered_map<NodeID, unordered_set<NodeID>> Ret2Call;
extern unordered_map<NodeID, unordered_set<NodeID>> Call2Ret;

extern unordered_map<NodeID, const Function *> Param2Funcs;
extern unordered_map<NodeID, CallInst *> Arg2iCalls;

inline Type *getPointeeType(const Type *type) {
  auto *ptrType = dyn_cast<PointerType>(type);
  if (!ptrType || ptrType->isOpaque()) {
    return nullptr;
  }
  return ptrType->getNonOpaquePointerElementType();
}

inline StructType *ifPointToStruct(const SVFType *tp) {
  return ifPointToStruct(getLLVMType(tp));
}

void sortMap(std::vector<pair<PAGNode *, u64_t>> &sorted,
             unordered_map<PAGNode *, u64_t> &before, int k);

void getNewInitFuncs(llvm::Module *module);

void getBlockedNodes(SVFIR *pag);

void setupPhiEdges(SVFIR *pag);

void setupSelectEdges(SVFIR *pag);

string printVal(const Value *val);

string printType(const Type *val);

string getStructName(StructType *sttype);

bool checkIfAddrTaken(SVFIR *pag, PAGNode *node);

void addSVFAddrFuncs(SVFModule *svfModule, SVFIR *pag);

void handleAnonymousStruct(SVFModule *svfModule, SVFIR *pag);

long varStructVisit(GEPOperator *gepop);

long regularStructVisit(StructType *sttype, s32_t idx, PAGEdge *gep);

void getSrcNodes(PAGNode *node, unordered_set<PAGNode *> &visitedNodes);

void setupStores(SVFIR *pag);

StructType *gotStructSrc(PAGNode *node, unordered_set<PAGNode *> &visitedNodes);

void collectByteoffset(SVFIR *pag);

void processCastSites(SVFIR *pag, SVFModule *);

void readCallGraph(string filename, SVFModule *mod, SVFIR *pag);

void setupDependence(SVFIR *pag, SVFModule *mod);

void setupCallGraph(SVFIR *_pag);

bool checkTwoTypes(
    Type *src, Type *dst,
    unordered_map<const Type *, unordered_set<const Type *>> &castmap);

void processCastMap(SVFIR *pag);

bool checkIfMatch(const CallInst *callinst, const Function *callee);

void processArguments(int argc, char **argv, int &arg_num, char **arg_value,
                      std::vector<std::string> &moduleNameVec);

#endif
