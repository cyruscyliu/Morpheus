
// Generated from devilang.g4 by ANTLR 4.9.2

#pragma once


#include "antlr4-runtime.h"
#include "devilangListener.h"


/**
 * This class provides an empty implementation of devilangListener,
 * which can be extended to create a listener which only needs to handle a subset
 * of the available methods.
 */
class  devilangBaseListener : public devilangListener {
public:

  virtual void enterProgram(devilangParser::ProgramContext * /*ctx*/) override { }
  virtual void exitProgram(devilangParser::ProgramContext * /*ctx*/) override { }

  virtual void enterDecl(devilangParser::DeclContext * /*ctx*/) override { }
  virtual void exitDecl(devilangParser::DeclContext * /*ctx*/) override { }

  virtual void enterStructDecl(devilangParser::StructDeclContext * /*ctx*/) override { }
  virtual void exitStructDecl(devilangParser::StructDeclContext * /*ctx*/) override { }

  virtual void enterField(devilangParser::FieldContext * /*ctx*/) override { }
  virtual void exitField(devilangParser::FieldContext * /*ctx*/) override { }

  virtual void enterIdent(devilangParser::IdentContext * /*ctx*/) override { }
  virtual void exitIdent(devilangParser::IdentContext * /*ctx*/) override { }

  virtual void enterType_(devilangParser::Type_Context * /*ctx*/) override { }
  virtual void exitType_(devilangParser::Type_Context * /*ctx*/) override { }

  virtual void enterBaseType(devilangParser::BaseTypeContext * /*ctx*/) override { }
  virtual void exitBaseType(devilangParser::BaseTypeContext * /*ctx*/) override { }

  virtual void enterPtrType(devilangParser::PtrTypeContext * /*ctx*/) override { }
  virtual void exitPtrType(devilangParser::PtrTypeContext * /*ctx*/) override { }

  virtual void enterBytesType(devilangParser::BytesTypeContext * /*ctx*/) override { }
  virtual void exitBytesType(devilangParser::BytesTypeContext * /*ctx*/) override { }

  virtual void enterModifier(devilangParser::ModifierContext * /*ctx*/) override { }
  virtual void exitModifier(devilangParser::ModifierContext * /*ctx*/) override { }

  virtual void enterBitBlock(devilangParser::BitBlockContext * /*ctx*/) override { }
  virtual void exitBitBlock(devilangParser::BitBlockContext * /*ctx*/) override { }

  virtual void enterBitEntry(devilangParser::BitEntryContext * /*ctx*/) override { }
  virtual void exitBitEntry(devilangParser::BitEntryContext * /*ctx*/) override { }

  virtual void enterBitRange(devilangParser::BitRangeContext * /*ctx*/) override { }
  virtual void exitBitRange(devilangParser::BitRangeContext * /*ctx*/) override { }

  virtual void enterBitValue(devilangParser::BitValueContext * /*ctx*/) override { }
  virtual void exitBitValue(devilangParser::BitValueContext * /*ctx*/) override { }

  virtual void enterBitSep(devilangParser::BitSepContext * /*ctx*/) override { }
  virtual void exitBitSep(devilangParser::BitSepContext * /*ctx*/) override { }

  virtual void enterImmBlock(devilangParser::ImmBlockContext * /*ctx*/) override { }
  virtual void exitImmBlock(devilangParser::ImmBlockContext * /*ctx*/) override { }

  virtual void enterImmEntry(devilangParser::ImmEntryContext * /*ctx*/) override { }
  virtual void exitImmEntry(devilangParser::ImmEntryContext * /*ctx*/) override { }

  virtual void enterImmSep(devilangParser::ImmSepContext * /*ctx*/) override { }
  virtual void exitImmSep(devilangParser::ImmSepContext * /*ctx*/) override { }

  virtual void enterTopologyDecl(devilangParser::TopologyDeclContext * /*ctx*/) override { }
  virtual void exitTopologyDecl(devilangParser::TopologyDeclContext * /*ctx*/) override { }

  virtual void enterPointerDecl(devilangParser::PointerDeclContext * /*ctx*/) override { }
  virtual void exitPointerDecl(devilangParser::PointerDeclContext * /*ctx*/) override { }

  virtual void enterPointerField(devilangParser::PointerFieldContext * /*ctx*/) override { }
  virtual void exitPointerField(devilangParser::PointerFieldContext * /*ctx*/) override { }

  virtual void enterBitRefList(devilangParser::BitRefListContext * /*ctx*/) override { }
  virtual void exitBitRefList(devilangParser::BitRefListContext * /*ctx*/) override { }

  virtual void enterListDecl(devilangParser::ListDeclContext * /*ctx*/) override { }
  virtual void exitListDecl(devilangParser::ListDeclContext * /*ctx*/) override { }

  virtual void enterDlistDecl(devilangParser::DlistDeclContext * /*ctx*/) override { }
  virtual void exitDlistDecl(devilangParser::DlistDeclContext * /*ctx*/) override { }

  virtual void enterRingDecl(devilangParser::RingDeclContext * /*ctx*/) override { }
  virtual void exitRingDecl(devilangParser::RingDeclContext * /*ctx*/) override { }

  virtual void enterRingbufDecl(devilangParser::RingbufDeclContext * /*ctx*/) override { }
  virtual void exitRingbufDecl(devilangParser::RingbufDeclContext * /*ctx*/) override { }

  virtual void enterTypeList(devilangParser::TypeListContext * /*ctx*/) override { }
  virtual void exitTypeList(devilangParser::TypeListContext * /*ctx*/) override { }

  virtual void enterSpaceTypeList(devilangParser::SpaceTypeListContext * /*ctx*/) override { }
  virtual void exitSpaceTypeList(devilangParser::SpaceTypeListContext * /*ctx*/) override { }

  virtual void enterListBody(devilangParser::ListBodyContext * /*ctx*/) override { }
  virtual void exitListBody(devilangParser::ListBodyContext * /*ctx*/) override { }

  virtual void enterDlistBody(devilangParser::DlistBodyContext * /*ctx*/) override { }
  virtual void exitDlistBody(devilangParser::DlistBodyContext * /*ctx*/) override { }

  virtual void enterRingBody(devilangParser::RingBodyContext * /*ctx*/) override { }
  virtual void exitRingBody(devilangParser::RingBodyContext * /*ctx*/) override { }

  virtual void enterFieldRefOrList(devilangParser::FieldRefOrListContext * /*ctx*/) override { }
  virtual void exitFieldRefOrList(devilangParser::FieldRefOrListContext * /*ctx*/) override { }

  virtual void enterRingbufBody(devilangParser::RingbufBodyContext * /*ctx*/) override { }
  virtual void exitRingbufBody(devilangParser::RingbufBodyContext * /*ctx*/) override { }

  virtual void enterHeadDecl(devilangParser::HeadDeclContext * /*ctx*/) override { }
  virtual void exitHeadDecl(devilangParser::HeadDeclContext * /*ctx*/) override { }

  virtual void enterHeadName(devilangParser::HeadNameContext * /*ctx*/) override { }
  virtual void exitHeadName(devilangParser::HeadNameContext * /*ctx*/) override { }

  virtual void enterHeadField(devilangParser::HeadFieldContext * /*ctx*/) override { }
  virtual void exitHeadField(devilangParser::HeadFieldContext * /*ctx*/) override { }

  virtual void enterHeadPosition(devilangParser::HeadPositionContext * /*ctx*/) override { }
  virtual void exitHeadPosition(devilangParser::HeadPositionContext * /*ctx*/) override { }

  virtual void enterHeadLocation(devilangParser::HeadLocationContext * /*ctx*/) override { }
  virtual void exitHeadLocation(devilangParser::HeadLocationContext * /*ctx*/) override { }

  virtual void enterHeadKeyValue(devilangParser::HeadKeyValueContext * /*ctx*/) override { }
  virtual void exitHeadKeyValue(devilangParser::HeadKeyValueContext * /*ctx*/) override { }

  virtual void enterHeadAtom(devilangParser::HeadAtomContext * /*ctx*/) override { }
  virtual void exitHeadAtom(devilangParser::HeadAtomContext * /*ctx*/) override { }

  virtual void enterActionDecl(devilangParser::ActionDeclContext * /*ctx*/) override { }
  virtual void exitActionDecl(devilangParser::ActionDeclContext * /*ctx*/) override { }

  virtual void enterOpDecl(devilangParser::OpDeclContext * /*ctx*/) override { }
  virtual void exitOpDecl(devilangParser::OpDeclContext * /*ctx*/) override { }

  virtual void enterOpBody(devilangParser::OpBodyContext * /*ctx*/) override { }
  virtual void exitOpBody(devilangParser::OpBodyContext * /*ctx*/) override { }

  virtual void enterCallOp(devilangParser::CallOpContext * /*ctx*/) override { }
  virtual void exitCallOp(devilangParser::CallOpContext * /*ctx*/) override { }

  virtual void enterMmioOpDecl(devilangParser::MmioOpDeclContext * /*ctx*/) override { }
  virtual void exitMmioOpDecl(devilangParser::MmioOpDeclContext * /*ctx*/) override { }

  virtual void enterExtendedName(devilangParser::ExtendedNameContext * /*ctx*/) override { }
  virtual void exitExtendedName(devilangParser::ExtendedNameContext * /*ctx*/) override { }

  virtual void enterMmioField(devilangParser::MmioFieldContext * /*ctx*/) override { }
  virtual void exitMmioField(devilangParser::MmioFieldContext * /*ctx*/) override { }

  virtual void enterMmioDir(devilangParser::MmioDirContext * /*ctx*/) override { }
  virtual void exitMmioDir(devilangParser::MmioDirContext * /*ctx*/) override { }

  virtual void enterTopBbDecl(devilangParser::TopBbDeclContext * /*ctx*/) override { }
  virtual void exitTopBbDecl(devilangParser::TopBbDeclContext * /*ctx*/) override { }

  virtual void enterTopBbItem(devilangParser::TopBbItemContext * /*ctx*/) override { }
  virtual void exitTopBbItem(devilangParser::TopBbItemContext * /*ctx*/) override { }

  virtual void enterTopPathDecl(devilangParser::TopPathDeclContext * /*ctx*/) override { }
  virtual void exitTopPathDecl(devilangParser::TopPathDeclContext * /*ctx*/) override { }

  virtual void enterTopPathItem(devilangParser::TopPathItemContext * /*ctx*/) override { }
  virtual void exitTopPathItem(devilangParser::TopPathItemContext * /*ctx*/) override { }

  virtual void enterTopFuncDecl(devilangParser::TopFuncDeclContext * /*ctx*/) override { }
  virtual void exitTopFuncDecl(devilangParser::TopFuncDeclContext * /*ctx*/) override { }

  virtual void enterTopFuncItem(devilangParser::TopFuncItemContext * /*ctx*/) override { }
  virtual void exitTopFuncItem(devilangParser::TopFuncItemContext * /*ctx*/) override { }

  virtual void enterStateDecl(devilangParser::StateDeclContext * /*ctx*/) override { }
  virtual void exitStateDecl(devilangParser::StateDeclContext * /*ctx*/) override { }

  virtual void enterStateStmt(devilangParser::StateStmtContext * /*ctx*/) override { }
  virtual void exitStateStmt(devilangParser::StateStmtContext * /*ctx*/) override { }

  virtual void enterStateBlock(devilangParser::StateBlockContext * /*ctx*/) override { }
  virtual void exitStateBlock(devilangParser::StateBlockContext * /*ctx*/) override { }

  virtual void enterStateStep(devilangParser::StateStepContext * /*ctx*/) override { }
  virtual void exitStateStep(devilangParser::StateStepContext * /*ctx*/) override { }

  virtual void enterStateTerminator(devilangParser::StateTerminatorContext * /*ctx*/) override { }
  virtual void exitStateTerminator(devilangParser::StateTerminatorContext * /*ctx*/) override { }

  virtual void enterIoStateStep(devilangParser::IoStateStepContext * /*ctx*/) override { }
  virtual void exitIoStateStep(devilangParser::IoStateStepContext * /*ctx*/) override { }

  virtual void enterIoVerb(devilangParser::IoVerbContext * /*ctx*/) override { }
  virtual void exitIoVerb(devilangParser::IoVerbContext * /*ctx*/) override { }

  virtual void enterIoValue(devilangParser::IoValueContext * /*ctx*/) override { }
  virtual void exitIoValue(devilangParser::IoValueContext * /*ctx*/) override { }

  virtual void enterCallStateStep(devilangParser::CallStateStepContext * /*ctx*/) override { }
  virtual void exitCallStateStep(devilangParser::CallStateStepContext * /*ctx*/) override { }

  virtual void enterEllipsisStateStep(devilangParser::EllipsisStateStepContext * /*ctx*/) override { }
  virtual void exitEllipsisStateStep(devilangParser::EllipsisStateStepContext * /*ctx*/) override { }

  virtual void enterOpExpr(devilangParser::OpExprContext * /*ctx*/) override { }
  virtual void exitOpExpr(devilangParser::OpExprContext * /*ctx*/) override { }

  virtual void enterOpOrExpr(devilangParser::OpOrExprContext * /*ctx*/) override { }
  virtual void exitOpOrExpr(devilangParser::OpOrExprContext * /*ctx*/) override { }

  virtual void enterOpAndExpr(devilangParser::OpAndExprContext * /*ctx*/) override { }
  virtual void exitOpAndExpr(devilangParser::OpAndExprContext * /*ctx*/) override { }

  virtual void enterOpAddExpr(devilangParser::OpAddExprContext * /*ctx*/) override { }
  virtual void exitOpAddExpr(devilangParser::OpAddExprContext * /*ctx*/) override { }

  virtual void enterOpShiftExpr(devilangParser::OpShiftExprContext * /*ctx*/) override { }
  virtual void exitOpShiftExpr(devilangParser::OpShiftExprContext * /*ctx*/) override { }

  virtual void enterOpPrimaryExpr(devilangParser::OpPrimaryExprContext * /*ctx*/) override { }
  virtual void exitOpPrimaryExpr(devilangParser::OpPrimaryExprContext * /*ctx*/) override { }

  virtual void enterFuncCall(devilangParser::FuncCallContext * /*ctx*/) override { }
  virtual void exitFuncCall(devilangParser::FuncCallContext * /*ctx*/) override { }

  virtual void enterFuncArgs(devilangParser::FuncArgsContext * /*ctx*/) override { }
  virtual void exitFuncArgs(devilangParser::FuncArgsContext * /*ctx*/) override { }

  virtual void enterQualifiedName(devilangParser::QualifiedNameContext * /*ctx*/) override { }
  virtual void exitQualifiedName(devilangParser::QualifiedNameContext * /*ctx*/) override { }

  virtual void enterFileName(devilangParser::FileNameContext * /*ctx*/) override { }
  virtual void exitFileName(devilangParser::FileNameContext * /*ctx*/) override { }

  virtual void enterRef(devilangParser::RefContext * /*ctx*/) override { }
  virtual void exitRef(devilangParser::RefContext * /*ctx*/) override { }

  virtual void enterFieldRef(devilangParser::FieldRefContext * /*ctx*/) override { }
  virtual void exitFieldRef(devilangParser::FieldRefContext * /*ctx*/) override { }

  virtual void enterBitRef(devilangParser::BitRefContext * /*ctx*/) override { }
  virtual void exitBitRef(devilangParser::BitRefContext * /*ctx*/) override { }

  virtual void enterExpr(devilangParser::ExprContext * /*ctx*/) override { }
  virtual void exitExpr(devilangParser::ExprContext * /*ctx*/) override { }

  virtual void enterPrimary(devilangParser::PrimaryContext * /*ctx*/) override { }
  virtual void exitPrimary(devilangParser::PrimaryContext * /*ctx*/) override { }

  virtual void enterBoolLiteral(devilangParser::BoolLiteralContext * /*ctx*/) override { }
  virtual void exitBoolLiteral(devilangParser::BoolLiteralContext * /*ctx*/) override { }


  virtual void enterEveryRule(antlr4::ParserRuleContext * /*ctx*/) override { }
  virtual void exitEveryRule(antlr4::ParserRuleContext * /*ctx*/) override { }
  virtual void visitTerminal(antlr4::tree::TerminalNode * /*node*/) override { }
  virtual void visitErrorNode(antlr4::tree::ErrorNode * /*node*/) override { }

};

