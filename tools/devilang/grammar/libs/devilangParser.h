
// Generated from devilang.g4 by ANTLR 4.9.2

#pragma once


#include "antlr4-runtime.h"




class  devilangParser : public antlr4::Parser {
public:
  enum {
    T__0 = 1, T__1 = 2, T__2 = 3, T__3 = 4, T__4 = 5, T__5 = 6, T__6 = 7, 
    T__7 = 8, T__8 = 9, T__9 = 10, T__10 = 11, T__11 = 12, T__12 = 13, T__13 = 14, 
    T__14 = 15, T__15 = 16, T__16 = 17, T__17 = 18, T__18 = 19, T__19 = 20, 
    T__20 = 21, T__21 = 22, T__22 = 23, T__23 = 24, T__24 = 25, T__25 = 26, 
    T__26 = 27, T__27 = 28, T__28 = 29, T__29 = 30, T__30 = 31, T__31 = 32, 
    T__32 = 33, T__33 = 34, T__34 = 35, T__35 = 36, T__36 = 37, T__37 = 38, 
    T__38 = 39, T__39 = 40, T__40 = 41, T__41 = 42, T__42 = 43, T__43 = 44, 
    T__44 = 45, T__45 = 46, T__46 = 47, T__47 = 48, T__48 = 49, T__49 = 50, 
    T__50 = 51, T__51 = 52, T__52 = 53, T__53 = 54, T__54 = 55, T__55 = 56, 
    T__56 = 57, T__57 = 58, T__58 = 59, T__59 = 60, T__60 = 61, T__61 = 62, 
    T__62 = 63, T__63 = 64, T__64 = 65, T__65 = 66, T__66 = 67, T__67 = 68, 
    T__68 = 69, T__69 = 70, T__70 = 71, T__71 = 72, T__72 = 73, T__73 = 74, 
    T__74 = 75, T__75 = 76, T__76 = 77, T__77 = 78, T__78 = 79, T__79 = 80, 
    T__80 = 81, T__81 = 82, T__82 = 83, T__83 = 84, T__84 = 85, T__85 = 86, 
    T__86 = 87, T__87 = 88, T__88 = 89, T__89 = 90, T__90 = 91, T__91 = 92, 
    T__92 = 93, T__93 = 94, T__94 = 95, T__95 = 96, T__96 = 97, T__97 = 98, 
    T__98 = 99, T__99 = 100, T__100 = 101, T__101 = 102, T__102 = 103, T__103 = 104, 
    T__104 = 105, T__105 = 106, T__106 = 107, IDENT = 108, INT = 109, WS = 110, 
    LINE_COMMENT = 111, BLOCK_COMMENT = 112
  };

  enum {
    RuleProgram = 0, RuleDecl = 1, RuleStructDecl = 2, RuleField = 3, RuleIdent = 4, 
    RuleType_ = 5, RuleBaseType = 6, RulePtrType = 7, RuleBytesType = 8, 
    RuleModifier = 9, RuleBitBlock = 10, RuleBitEntry = 11, RuleBitRange = 12, 
    RuleBitValue = 13, RuleBitSep = 14, RuleImmBlock = 15, RuleImmEntry = 16, 
    RuleImmSep = 17, RuleTopologyDecl = 18, RulePointerDecl = 19, RulePointerField = 20, 
    RuleBitRefList = 21, RuleListDecl = 22, RuleDlistDecl = 23, RuleRingDecl = 24, 
    RuleRingbufDecl = 25, RuleTypeList = 26, RuleSpaceTypeList = 27, RuleListBody = 28, 
    RuleDlistBody = 29, RuleRingBody = 30, RuleFieldRefOrList = 31, RuleRingbufBody = 32, 
    RuleHeadDecl = 33, RuleHeadName = 34, RuleHeadField = 35, RuleHeadPosition = 36, 
    RuleHeadLocation = 37, RuleHeadKeyValue = 38, RuleHeadAtom = 39, RuleActionDecl = 40, 
    RuleOpDecl = 41, RuleOpBody = 42, RuleCallOp = 43, RuleMmioOpDecl = 44, 
    RuleExtendedName = 45, RuleMmioField = 46, RuleMmioDir = 47, RuleTopBbDecl = 48, 
    RuleTopBbItem = 49, RuleTopPathDecl = 50, RuleTopPathItem = 51, RuleTopFuncDecl = 52, 
    RuleTopFuncItem = 53, RuleStateDecl = 54, RuleStateStmt = 55, RuleStateBlock = 56, 
    RuleStateStep = 57, RuleStateTerminator = 58, RuleIoStateStep = 59, 
    RuleIoVerb = 60, RuleIoValue = 61, RuleCallStateStep = 62, RuleEllipsisStateStep = 63, 
    RuleOpExpr = 64, RuleOpOrExpr = 65, RuleOpAndExpr = 66, RuleOpAddExpr = 67, 
    RuleOpShiftExpr = 68, RuleOpPrimaryExpr = 69, RuleFuncCall = 70, RuleFuncArgs = 71, 
    RuleQualifiedName = 72, RuleFileName = 73, RuleRef = 74, RuleFieldRef = 75, 
    RuleBitRef = 76, RuleExpr = 77, RulePrimary = 78, RuleBoolLiteral = 79
  };

  explicit devilangParser(antlr4::TokenStream *input);
  ~devilangParser();

  virtual std::string getGrammarFileName() const override;
  virtual const antlr4::atn::ATN& getATN() const override { return _atn; };
  virtual const std::vector<std::string>& getTokenNames() const override { return _tokenNames; }; // deprecated: use vocabulary instead.
  virtual const std::vector<std::string>& getRuleNames() const override;
  virtual antlr4::dfa::Vocabulary& getVocabulary() const override;


  class ProgramContext;
  class DeclContext;
  class StructDeclContext;
  class FieldContext;
  class IdentContext;
  class Type_Context;
  class BaseTypeContext;
  class PtrTypeContext;
  class BytesTypeContext;
  class ModifierContext;
  class BitBlockContext;
  class BitEntryContext;
  class BitRangeContext;
  class BitValueContext;
  class BitSepContext;
  class ImmBlockContext;
  class ImmEntryContext;
  class ImmSepContext;
  class TopologyDeclContext;
  class PointerDeclContext;
  class PointerFieldContext;
  class BitRefListContext;
  class ListDeclContext;
  class DlistDeclContext;
  class RingDeclContext;
  class RingbufDeclContext;
  class TypeListContext;
  class SpaceTypeListContext;
  class ListBodyContext;
  class DlistBodyContext;
  class RingBodyContext;
  class FieldRefOrListContext;
  class RingbufBodyContext;
  class HeadDeclContext;
  class HeadNameContext;
  class HeadFieldContext;
  class HeadPositionContext;
  class HeadLocationContext;
  class HeadKeyValueContext;
  class HeadAtomContext;
  class ActionDeclContext;
  class OpDeclContext;
  class OpBodyContext;
  class CallOpContext;
  class MmioOpDeclContext;
  class ExtendedNameContext;
  class MmioFieldContext;
  class MmioDirContext;
  class TopBbDeclContext;
  class TopBbItemContext;
  class TopPathDeclContext;
  class TopPathItemContext;
  class TopFuncDeclContext;
  class TopFuncItemContext;
  class StateDeclContext;
  class StateStmtContext;
  class StateBlockContext;
  class StateStepContext;
  class StateTerminatorContext;
  class IoStateStepContext;
  class IoVerbContext;
  class IoValueContext;
  class CallStateStepContext;
  class EllipsisStateStepContext;
  class OpExprContext;
  class OpOrExprContext;
  class OpAndExprContext;
  class OpAddExprContext;
  class OpShiftExprContext;
  class OpPrimaryExprContext;
  class FuncCallContext;
  class FuncArgsContext;
  class QualifiedNameContext;
  class FileNameContext;
  class RefContext;
  class FieldRefContext;
  class BitRefContext;
  class ExprContext;
  class PrimaryContext;
  class BoolLiteralContext; 

  class  ProgramContext : public antlr4::ParserRuleContext {
  public:
    ProgramContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *EOF();
    std::vector<DeclContext *> decl();
    DeclContext* decl(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ProgramContext* program();

  class  DeclContext : public antlr4::ParserRuleContext {
  public:
    DeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    StructDeclContext *structDecl();
    TopologyDeclContext *topologyDecl();
    ActionDeclContext *actionDecl();
    OpDeclContext *opDecl();
    TopBbDeclContext *topBbDecl();
    TopPathDeclContext *topPathDecl();
    TopFuncDeclContext *topFuncDecl();
    StateDeclContext *stateDecl();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  DeclContext* decl();

  class  StructDeclContext : public antlr4::ParserRuleContext {
  public:
    StructDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IdentContext *ident();
    std::vector<FieldContext *> field();
    FieldContext* field(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  StructDeclContext* structDecl();

  class  FieldContext : public antlr4::ParserRuleContext {
  public:
    FieldContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IdentContext *ident();
    Type_Context *type_();
    std::vector<ModifierContext *> modifier();
    ModifierContext* modifier(size_t i);
    BitBlockContext *bitBlock();
    ImmBlockContext *immBlock();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  FieldContext* field();

  class  IdentContext : public antlr4::ParserRuleContext {
  public:
    IdentContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *IDENT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  IdentContext* ident();

  class  Type_Context : public antlr4::ParserRuleContext {
  public:
    Type_Context(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    BaseTypeContext *baseType();
    PtrTypeContext *ptrType();
    BytesTypeContext *bytesType();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  Type_Context* type_();

  class  BaseTypeContext : public antlr4::ParserRuleContext {
  public:
    BaseTypeContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BaseTypeContext* baseType();

  class  PtrTypeContext : public antlr4::ParserRuleContext {
  public:
    PtrTypeContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    Type_Context *type_();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  PtrTypeContext* ptrType();

  class  BytesTypeContext : public antlr4::ParserRuleContext {
  public:
    BytesTypeContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BytesTypeContext* bytesType();

  class  ModifierContext : public antlr4::ParserRuleContext {
  public:
    ModifierContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ModifierContext* modifier();

  class  BitBlockContext : public antlr4::ParserRuleContext {
  public:
    BitBlockContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<BitEntryContext *> bitEntry();
    BitEntryContext* bitEntry(size_t i);
    std::vector<BitSepContext *> bitSep();
    BitSepContext* bitSep(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitBlockContext* bitBlock();

  class  BitEntryContext : public antlr4::ParserRuleContext {
  public:
    BitEntryContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    BitRangeContext *bitRange();
    BitValueContext *bitValue();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitEntryContext* bitEntry();

  class  BitRangeContext : public antlr4::ParserRuleContext {
  public:
    BitRangeContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<antlr4::tree::TerminalNode *> INT();
    antlr4::tree::TerminalNode* INT(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitRangeContext* bitRange();

  class  BitValueContext : public antlr4::ParserRuleContext {
  public:
    BitValueContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitValueContext* bitValue();

  class  BitSepContext : public antlr4::ParserRuleContext {
  public:
    BitSepContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitSepContext* bitSep();

  class  ImmBlockContext : public antlr4::ParserRuleContext {
  public:
    ImmBlockContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<ImmEntryContext *> immEntry();
    ImmEntryContext* immEntry(size_t i);
    std::vector<ImmSepContext *> immSep();
    ImmSepContext* immSep(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ImmBlockContext* immBlock();

  class  ImmEntryContext : public antlr4::ParserRuleContext {
  public:
    ImmEntryContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<antlr4::tree::TerminalNode *> INT();
    antlr4::tree::TerminalNode* INT(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ImmEntryContext* immEntry();

  class  ImmSepContext : public antlr4::ParserRuleContext {
  public:
    ImmSepContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ImmSepContext* immSep();

  class  TopologyDeclContext : public antlr4::ParserRuleContext {
  public:
    TopologyDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    PointerDeclContext *pointerDecl();
    ListDeclContext *listDecl();
    DlistDeclContext *dlistDecl();
    RingDeclContext *ringDecl();
    RingbufDeclContext *ringbufDecl();
    HeadDeclContext *headDecl();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopologyDeclContext* topologyDecl();

  class  PointerDeclContext : public antlr4::ParserRuleContext {
  public:
    PointerDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<PointerFieldContext *> pointerField();
    PointerFieldContext* pointerField(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  PointerDeclContext* pointerDecl();

  class  PointerFieldContext : public antlr4::ParserRuleContext {
  public:
    PointerFieldContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    RefContext *ref();
    TypeListContext *typeList();
    antlr4::tree::TerminalNode *INT();
    BoolLiteralContext *boolLiteral();
    BitRefListContext *bitRefList();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  PointerFieldContext* pointerField();

  class  BitRefListContext : public antlr4::ParserRuleContext {
  public:
    BitRefListContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<BitRefContext *> bitRef();
    BitRefContext* bitRef(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitRefListContext* bitRefList();

  class  ListDeclContext : public antlr4::ParserRuleContext {
  public:
    ListDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    TypeListContext *typeList();
    ListBodyContext *listBody();
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ListDeclContext* listDecl();

  class  DlistDeclContext : public antlr4::ParserRuleContext {
  public:
    DlistDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    TypeListContext *typeList();
    DlistBodyContext *dlistBody();
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  DlistDeclContext* dlistDecl();

  class  RingDeclContext : public antlr4::ParserRuleContext {
  public:
    RingDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    TypeListContext *typeList();
    RingBodyContext *ringBody();
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  RingDeclContext* ringDecl();

  class  RingbufDeclContext : public antlr4::ParserRuleContext {
  public:
    RingbufDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    Type_Context *type_();
    RingbufBodyContext *ringbufBody();
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  RingbufDeclContext* ringbufDecl();

  class  TypeListContext : public antlr4::ParserRuleContext {
  public:
    TypeListContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<IdentContext *> ident();
    IdentContext* ident(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TypeListContext* typeList();

  class  SpaceTypeListContext : public antlr4::ParserRuleContext {
  public:
    SpaceTypeListContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<IdentContext *> ident();
    IdentContext* ident(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  SpaceTypeListContext* spaceTypeList();

  class  ListBodyContext : public antlr4::ParserRuleContext {
  public:
    ListBodyContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<RefContext *> ref();
    RefContext* ref(size_t i);
    FieldRefOrListContext *fieldRefOrList();
    BitRefListContext *bitRefList();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ListBodyContext* listBody();

  class  DlistBodyContext : public antlr4::ParserRuleContext {
  public:
    DlistBodyContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<RefContext *> ref();
    RefContext* ref(size_t i);
    std::vector<FieldRefOrListContext *> fieldRefOrList();
    FieldRefOrListContext* fieldRefOrList(size_t i);
    BitRefListContext *bitRefList();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  DlistBodyContext* dlistBody();

  class  RingBodyContext : public antlr4::ParserRuleContext {
  public:
    RingBodyContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    RefContext *ref();
    FieldRefOrListContext *fieldRefOrList();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  RingBodyContext* ringBody();

  class  FieldRefOrListContext : public antlr4::ParserRuleContext {
  public:
    FieldRefOrListContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<FieldRefContext *> fieldRef();
    FieldRefContext* fieldRef(size_t i);
    std::vector<IdentContext *> ident();
    IdentContext* ident(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  FieldRefOrListContext* fieldRefOrList();

  class  RingbufBodyContext : public antlr4::ParserRuleContext {
  public:
    RingbufBodyContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExprContext *expr();
    std::vector<RefContext *> ref();
    RefContext* ref(size_t i);
    std::vector<antlr4::tree::TerminalNode *> INT();
    antlr4::tree::TerminalNode* INT(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  RingbufBodyContext* ringbufBody();

  class  HeadDeclContext : public antlr4::ParserRuleContext {
  public:
    HeadDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    HeadNameContext *headName();
    std::vector<HeadFieldContext *> headField();
    HeadFieldContext* headField(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadDeclContext* headDecl();

  class  HeadNameContext : public antlr4::ParserRuleContext {
  public:
    HeadNameContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadNameContext* headName();

  class  HeadFieldContext : public antlr4::ParserRuleContext {
  public:
    HeadFieldContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    HeadPositionContext *headPosition();
    SpaceTypeListContext *spaceTypeList();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadFieldContext* headField();

  class  HeadPositionContext : public antlr4::ParserRuleContext {
  public:
    HeadPositionContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<HeadLocationContext *> headLocation();
    HeadLocationContext* headLocation(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadPositionContext* headPosition();

  class  HeadLocationContext : public antlr4::ParserRuleContext {
  public:
    HeadLocationContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<HeadKeyValueContext *> headKeyValue();
    HeadKeyValueContext* headKeyValue(size_t i);
    std::vector<HeadAtomContext *> headAtom();
    HeadAtomContext* headAtom(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadLocationContext* headLocation();

  class  HeadKeyValueContext : public antlr4::ParserRuleContext {
  public:
    HeadKeyValueContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    QualifiedNameContext *qualifiedName();
    FileNameContext *fileName();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadKeyValueContext* headKeyValue();

  class  HeadAtomContext : public antlr4::ParserRuleContext {
  public:
    HeadAtomContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    QualifiedNameContext *qualifiedName();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  HeadAtomContext* headAtom();

  class  ActionDeclContext : public antlr4::ParserRuleContext {
  public:
    ActionDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ActionDeclContext* actionDecl();

  class  OpDeclContext : public antlr4::ParserRuleContext {
  public:
    OpDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IdentContext *ident();
    OpBodyContext *opBody();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpDeclContext* opDecl();

  class  OpBodyContext : public antlr4::ParserRuleContext {
  public:
    OpBodyContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    CallOpContext *callOp();
    MmioOpDeclContext *mmioOpDecl();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpBodyContext* opBody();

  class  CallOpContext : public antlr4::ParserRuleContext {
  public:
    CallOpContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  CallOpContext* callOp();

  class  MmioOpDeclContext : public antlr4::ParserRuleContext {
  public:
    MmioOpDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();
    std::vector<MmioFieldContext *> mmioField();
    MmioFieldContext* mmioField(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  MmioOpDeclContext* mmioOpDecl();

  class  ExtendedNameContext : public antlr4::ParserRuleContext {
  public:
    ExtendedNameContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<IdentContext *> ident();
    IdentContext* ident(size_t i);
    std::vector<antlr4::tree::TerminalNode *> INT();
    antlr4::tree::TerminalNode* INT(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ExtendedNameContext* extendedName();

  class  MmioFieldContext : public antlr4::ParserRuleContext {
  public:
    MmioFieldContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    MmioDirContext *mmioDir();
    antlr4::tree::TerminalNode *INT();
    OpExprContext *opExpr();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  MmioFieldContext* mmioField();

  class  MmioDirContext : public antlr4::ParserRuleContext {
  public:
    MmioDirContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  MmioDirContext* mmioDir();

  class  TopBbDeclContext : public antlr4::ParserRuleContext {
  public:
    TopBbDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();
    std::vector<TopBbItemContext *> topBbItem();
    TopBbItemContext* topBbItem(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopBbDeclContext* topBbDecl();

  class  TopBbItemContext : public antlr4::ParserRuleContext {
  public:
    TopBbItemContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopBbItemContext* topBbItem();

  class  TopPathDeclContext : public antlr4::ParserRuleContext {
  public:
    TopPathDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();
    std::vector<TopPathItemContext *> topPathItem();
    TopPathItemContext* topPathItem(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopPathDeclContext* topPathDecl();

  class  TopPathItemContext : public antlr4::ParserRuleContext {
  public:
    TopPathItemContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopPathItemContext* topPathItem();

  class  TopFuncDeclContext : public antlr4::ParserRuleContext {
  public:
    TopFuncDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();
    std::vector<TopFuncItemContext *> topFuncItem();
    TopFuncItemContext* topFuncItem(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopFuncDeclContext* topFuncDecl();

  class  TopFuncItemContext : public antlr4::ParserRuleContext {
  public:
    TopFuncItemContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  TopFuncItemContext* topFuncItem();

  class  StateDeclContext : public antlr4::ParserRuleContext {
  public:
    StateDeclContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();
    std::vector<StateStmtContext *> stateStmt();
    StateStmtContext* stateStmt(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  StateDeclContext* stateDecl();

  class  StateStmtContext : public antlr4::ParserRuleContext {
  public:
    StateStmtContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    StateBlockContext *stateBlock();
    StateStepContext *stateStep();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  StateStmtContext* stateStmt();

  class  StateBlockContext : public antlr4::ParserRuleContext {
  public:
    StateBlockContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<StateStmtContext *> stateStmt();
    StateStmtContext* stateStmt(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  StateBlockContext* stateBlock();

  class  StateStepContext : public antlr4::ParserRuleContext {
  public:
    StateStepContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IoStateStepContext *ioStateStep();
    StateTerminatorContext *stateTerminator();
    CallStateStepContext *callStateStep();
    EllipsisStateStepContext *ellipsisStateStep();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  StateStepContext* stateStep();

  class  StateTerminatorContext : public antlr4::ParserRuleContext {
  public:
    StateTerminatorContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  StateTerminatorContext* stateTerminator();

  class  IoStateStepContext : public antlr4::ParserRuleContext {
  public:
    IoStateStepContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IoVerbContext *ioVerb();
    OpExprContext *opExpr();
    IoValueContext *ioValue();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  IoStateStepContext* ioStateStep();

  class  IoVerbContext : public antlr4::ParserRuleContext {
  public:
    IoVerbContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  IoVerbContext* ioVerb();

  class  IoValueContext : public antlr4::ParserRuleContext {
  public:
    IoValueContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    OpExprContext *opExpr();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  IoValueContext* ioValue();

  class  CallStateStepContext : public antlr4::ParserRuleContext {
  public:
    CallStateStepContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    ExtendedNameContext *extendedName();
    FuncArgsContext *funcArgs();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  CallStateStepContext* callStateStep();

  class  EllipsisStateStepContext : public antlr4::ParserRuleContext {
  public:
    EllipsisStateStepContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  EllipsisStateStepContext* ellipsisStateStep();

  class  OpExprContext : public antlr4::ParserRuleContext {
  public:
    OpExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    OpOrExprContext *opOrExpr();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpExprContext* opExpr();

  class  OpOrExprContext : public antlr4::ParserRuleContext {
  public:
    OpOrExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<OpAndExprContext *> opAndExpr();
    OpAndExprContext* opAndExpr(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpOrExprContext* opOrExpr();

  class  OpAndExprContext : public antlr4::ParserRuleContext {
  public:
    OpAndExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<OpAddExprContext *> opAddExpr();
    OpAddExprContext* opAddExpr(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpAndExprContext* opAndExpr();

  class  OpAddExprContext : public antlr4::ParserRuleContext {
  public:
    OpAddExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<OpShiftExprContext *> opShiftExpr();
    OpShiftExprContext* opShiftExpr(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpAddExprContext* opAddExpr();

  class  OpShiftExprContext : public antlr4::ParserRuleContext {
  public:
    OpShiftExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<OpPrimaryExprContext *> opPrimaryExpr();
    OpPrimaryExprContext* opPrimaryExpr(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpShiftExprContext* opShiftExpr();

  class  OpPrimaryExprContext : public antlr4::ParserRuleContext {
  public:
    OpPrimaryExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *INT();
    RefContext *ref();
    FuncCallContext *funcCall();
    OpExprContext *opExpr();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  OpPrimaryExprContext* opPrimaryExpr();

  class  FuncCallContext : public antlr4::ParserRuleContext {
  public:
    FuncCallContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    QualifiedNameContext *qualifiedName();
    FuncArgsContext *funcArgs();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  FuncCallContext* funcCall();

  class  FuncArgsContext : public antlr4::ParserRuleContext {
  public:
    FuncArgsContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<OpExprContext *> opExpr();
    OpExprContext* opExpr(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  FuncArgsContext* funcArgs();

  class  QualifiedNameContext : public antlr4::ParserRuleContext {
  public:
    QualifiedNameContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<IdentContext *> ident();
    IdentContext* ident(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  QualifiedNameContext* qualifiedName();

  class  FileNameContext : public antlr4::ParserRuleContext {
  public:
    FileNameContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<IdentContext *> ident();
    IdentContext* ident(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  FileNameContext* fileName();

  class  RefContext : public antlr4::ParserRuleContext {
  public:
    RefContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    QualifiedNameContext *qualifiedName();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  RefContext* ref();

  class  FieldRefContext : public antlr4::ParserRuleContext {
  public:
    FieldRefContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    IdentContext *ident();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  FieldRefContext* fieldRef();

  class  BitRefContext : public antlr4::ParserRuleContext {
  public:
    BitRefContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    RefContext *ref();
    antlr4::tree::TerminalNode *INT();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BitRefContext* bitRef();

  class  ExprContext : public antlr4::ParserRuleContext {
  public:
    ExprContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    std::vector<PrimaryContext *> primary();
    PrimaryContext* primary(size_t i);

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  ExprContext* expr();

  class  PrimaryContext : public antlr4::ParserRuleContext {
  public:
    PrimaryContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;
    antlr4::tree::TerminalNode *INT();
    RefContext *ref();
    ExprContext *expr();

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  PrimaryContext* primary();

  class  BoolLiteralContext : public antlr4::ParserRuleContext {
  public:
    BoolLiteralContext(antlr4::ParserRuleContext *parent, size_t invokingState);
    virtual size_t getRuleIndex() const override;

    virtual void enterRule(antlr4::tree::ParseTreeListener *listener) override;
    virtual void exitRule(antlr4::tree::ParseTreeListener *listener) override;
   
  };

  BoolLiteralContext* boolLiteral();


private:
  static std::vector<antlr4::dfa::DFA> _decisionToDFA;
  static antlr4::atn::PredictionContextCache _sharedContextCache;
  static std::vector<std::string> _ruleNames;
  static std::vector<std::string> _tokenNames;

  static std::vector<std::string> _literalNames;
  static std::vector<std::string> _symbolicNames;
  static antlr4::dfa::Vocabulary _vocabulary;
  static antlr4::atn::ATN _atn;
  static std::vector<uint16_t> _serializedATN;


  struct Initializer {
    Initializer();
  };
  static Initializer _init;
};

