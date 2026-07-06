
// Generated from devilang.g4 by ANTLR 4.9.2

#pragma once


#include "antlr4-runtime.h"
#include "devilangParser.h"


/**
 * This interface defines an abstract listener for a parse tree produced by devilangParser.
 */
class  devilangListener : public antlr4::tree::ParseTreeListener {
public:

  virtual void enterProgram(devilangParser::ProgramContext *ctx) = 0;
  virtual void exitProgram(devilangParser::ProgramContext *ctx) = 0;

  virtual void enterDecl(devilangParser::DeclContext *ctx) = 0;
  virtual void exitDecl(devilangParser::DeclContext *ctx) = 0;

  virtual void enterStructDecl(devilangParser::StructDeclContext *ctx) = 0;
  virtual void exitStructDecl(devilangParser::StructDeclContext *ctx) = 0;

  virtual void enterField(devilangParser::FieldContext *ctx) = 0;
  virtual void exitField(devilangParser::FieldContext *ctx) = 0;

  virtual void enterIdent(devilangParser::IdentContext *ctx) = 0;
  virtual void exitIdent(devilangParser::IdentContext *ctx) = 0;

  virtual void enterType_(devilangParser::Type_Context *ctx) = 0;
  virtual void exitType_(devilangParser::Type_Context *ctx) = 0;

  virtual void enterBaseType(devilangParser::BaseTypeContext *ctx) = 0;
  virtual void exitBaseType(devilangParser::BaseTypeContext *ctx) = 0;

  virtual void enterPtrType(devilangParser::PtrTypeContext *ctx) = 0;
  virtual void exitPtrType(devilangParser::PtrTypeContext *ctx) = 0;

  virtual void enterBytesType(devilangParser::BytesTypeContext *ctx) = 0;
  virtual void exitBytesType(devilangParser::BytesTypeContext *ctx) = 0;

  virtual void enterModifier(devilangParser::ModifierContext *ctx) = 0;
  virtual void exitModifier(devilangParser::ModifierContext *ctx) = 0;

  virtual void enterBitBlock(devilangParser::BitBlockContext *ctx) = 0;
  virtual void exitBitBlock(devilangParser::BitBlockContext *ctx) = 0;

  virtual void enterBitEntry(devilangParser::BitEntryContext *ctx) = 0;
  virtual void exitBitEntry(devilangParser::BitEntryContext *ctx) = 0;

  virtual void enterBitRange(devilangParser::BitRangeContext *ctx) = 0;
  virtual void exitBitRange(devilangParser::BitRangeContext *ctx) = 0;

  virtual void enterBitValue(devilangParser::BitValueContext *ctx) = 0;
  virtual void exitBitValue(devilangParser::BitValueContext *ctx) = 0;

  virtual void enterBitSep(devilangParser::BitSepContext *ctx) = 0;
  virtual void exitBitSep(devilangParser::BitSepContext *ctx) = 0;

  virtual void enterImmBlock(devilangParser::ImmBlockContext *ctx) = 0;
  virtual void exitImmBlock(devilangParser::ImmBlockContext *ctx) = 0;

  virtual void enterImmEntry(devilangParser::ImmEntryContext *ctx) = 0;
  virtual void exitImmEntry(devilangParser::ImmEntryContext *ctx) = 0;

  virtual void enterImmSep(devilangParser::ImmSepContext *ctx) = 0;
  virtual void exitImmSep(devilangParser::ImmSepContext *ctx) = 0;

  virtual void enterTopologyDecl(devilangParser::TopologyDeclContext *ctx) = 0;
  virtual void exitTopologyDecl(devilangParser::TopologyDeclContext *ctx) = 0;

  virtual void enterPointerDecl(devilangParser::PointerDeclContext *ctx) = 0;
  virtual void exitPointerDecl(devilangParser::PointerDeclContext *ctx) = 0;

  virtual void enterPointerField(devilangParser::PointerFieldContext *ctx) = 0;
  virtual void exitPointerField(devilangParser::PointerFieldContext *ctx) = 0;

  virtual void enterBitRefList(devilangParser::BitRefListContext *ctx) = 0;
  virtual void exitBitRefList(devilangParser::BitRefListContext *ctx) = 0;

  virtual void enterListDecl(devilangParser::ListDeclContext *ctx) = 0;
  virtual void exitListDecl(devilangParser::ListDeclContext *ctx) = 0;

  virtual void enterDlistDecl(devilangParser::DlistDeclContext *ctx) = 0;
  virtual void exitDlistDecl(devilangParser::DlistDeclContext *ctx) = 0;

  virtual void enterRingDecl(devilangParser::RingDeclContext *ctx) = 0;
  virtual void exitRingDecl(devilangParser::RingDeclContext *ctx) = 0;

  virtual void enterRingbufDecl(devilangParser::RingbufDeclContext *ctx) = 0;
  virtual void exitRingbufDecl(devilangParser::RingbufDeclContext *ctx) = 0;

  virtual void enterTypeList(devilangParser::TypeListContext *ctx) = 0;
  virtual void exitTypeList(devilangParser::TypeListContext *ctx) = 0;

  virtual void enterSpaceTypeList(devilangParser::SpaceTypeListContext *ctx) = 0;
  virtual void exitSpaceTypeList(devilangParser::SpaceTypeListContext *ctx) = 0;

  virtual void enterListBody(devilangParser::ListBodyContext *ctx) = 0;
  virtual void exitListBody(devilangParser::ListBodyContext *ctx) = 0;

  virtual void enterDlistBody(devilangParser::DlistBodyContext *ctx) = 0;
  virtual void exitDlistBody(devilangParser::DlistBodyContext *ctx) = 0;

  virtual void enterRingBody(devilangParser::RingBodyContext *ctx) = 0;
  virtual void exitRingBody(devilangParser::RingBodyContext *ctx) = 0;

  virtual void enterFieldRefOrList(devilangParser::FieldRefOrListContext *ctx) = 0;
  virtual void exitFieldRefOrList(devilangParser::FieldRefOrListContext *ctx) = 0;

  virtual void enterRingbufBody(devilangParser::RingbufBodyContext *ctx) = 0;
  virtual void exitRingbufBody(devilangParser::RingbufBodyContext *ctx) = 0;

  virtual void enterHeadDecl(devilangParser::HeadDeclContext *ctx) = 0;
  virtual void exitHeadDecl(devilangParser::HeadDeclContext *ctx) = 0;

  virtual void enterHeadName(devilangParser::HeadNameContext *ctx) = 0;
  virtual void exitHeadName(devilangParser::HeadNameContext *ctx) = 0;

  virtual void enterHeadField(devilangParser::HeadFieldContext *ctx) = 0;
  virtual void exitHeadField(devilangParser::HeadFieldContext *ctx) = 0;

  virtual void enterHeadPosition(devilangParser::HeadPositionContext *ctx) = 0;
  virtual void exitHeadPosition(devilangParser::HeadPositionContext *ctx) = 0;

  virtual void enterHeadLocation(devilangParser::HeadLocationContext *ctx) = 0;
  virtual void exitHeadLocation(devilangParser::HeadLocationContext *ctx) = 0;

  virtual void enterHeadKeyValue(devilangParser::HeadKeyValueContext *ctx) = 0;
  virtual void exitHeadKeyValue(devilangParser::HeadKeyValueContext *ctx) = 0;

  virtual void enterHeadAtom(devilangParser::HeadAtomContext *ctx) = 0;
  virtual void exitHeadAtom(devilangParser::HeadAtomContext *ctx) = 0;

  virtual void enterActionDecl(devilangParser::ActionDeclContext *ctx) = 0;
  virtual void exitActionDecl(devilangParser::ActionDeclContext *ctx) = 0;

  virtual void enterOpDecl(devilangParser::OpDeclContext *ctx) = 0;
  virtual void exitOpDecl(devilangParser::OpDeclContext *ctx) = 0;

  virtual void enterOpBody(devilangParser::OpBodyContext *ctx) = 0;
  virtual void exitOpBody(devilangParser::OpBodyContext *ctx) = 0;

  virtual void enterCallOp(devilangParser::CallOpContext *ctx) = 0;
  virtual void exitCallOp(devilangParser::CallOpContext *ctx) = 0;

  virtual void enterMmioOpDecl(devilangParser::MmioOpDeclContext *ctx) = 0;
  virtual void exitMmioOpDecl(devilangParser::MmioOpDeclContext *ctx) = 0;

  virtual void enterExtendedName(devilangParser::ExtendedNameContext *ctx) = 0;
  virtual void exitExtendedName(devilangParser::ExtendedNameContext *ctx) = 0;

  virtual void enterMmioField(devilangParser::MmioFieldContext *ctx) = 0;
  virtual void exitMmioField(devilangParser::MmioFieldContext *ctx) = 0;

  virtual void enterMmioDir(devilangParser::MmioDirContext *ctx) = 0;
  virtual void exitMmioDir(devilangParser::MmioDirContext *ctx) = 0;

  virtual void enterTopBbDecl(devilangParser::TopBbDeclContext *ctx) = 0;
  virtual void exitTopBbDecl(devilangParser::TopBbDeclContext *ctx) = 0;

  virtual void enterTopBbItem(devilangParser::TopBbItemContext *ctx) = 0;
  virtual void exitTopBbItem(devilangParser::TopBbItemContext *ctx) = 0;

  virtual void enterTopPathDecl(devilangParser::TopPathDeclContext *ctx) = 0;
  virtual void exitTopPathDecl(devilangParser::TopPathDeclContext *ctx) = 0;

  virtual void enterTopPathItem(devilangParser::TopPathItemContext *ctx) = 0;
  virtual void exitTopPathItem(devilangParser::TopPathItemContext *ctx) = 0;

  virtual void enterTopFuncDecl(devilangParser::TopFuncDeclContext *ctx) = 0;
  virtual void exitTopFuncDecl(devilangParser::TopFuncDeclContext *ctx) = 0;

  virtual void enterTopFuncItem(devilangParser::TopFuncItemContext *ctx) = 0;
  virtual void exitTopFuncItem(devilangParser::TopFuncItemContext *ctx) = 0;

  virtual void enterMachineDecl(devilangParser::MachineDeclContext *ctx) = 0;
  virtual void exitMachineDecl(devilangParser::MachineDeclContext *ctx) = 0;

  virtual void enterMachineItem(devilangParser::MachineItemContext *ctx) = 0;
  virtual void exitMachineItem(devilangParser::MachineItemContext *ctx) = 0;

  virtual void enterImportDecl(devilangParser::ImportDeclContext *ctx) = 0;
  virtual void exitImportDecl(devilangParser::ImportDeclContext *ctx) = 0;

  virtual void enterInitialDecl(devilangParser::InitialDeclContext *ctx) = 0;
  virtual void exitInitialDecl(devilangParser::InitialDeclContext *ctx) = 0;

  virtual void enterScratchDecl(devilangParser::ScratchDeclContext *ctx) = 0;
  virtual void exitScratchDecl(devilangParser::ScratchDeclContext *ctx) = 0;

  virtual void enterScratchField(devilangParser::ScratchFieldContext *ctx) = 0;
  virtual void exitScratchField(devilangParser::ScratchFieldContext *ctx) = 0;

  virtual void enterMachineStateDecl(devilangParser::MachineStateDeclContext *ctx) = 0;
  virtual void exitMachineStateDecl(devilangParser::MachineStateDeclContext *ctx) = 0;

  virtual void enterTraceDecl(devilangParser::TraceDeclContext *ctx) = 0;
  virtual void exitTraceDecl(devilangParser::TraceDeclContext *ctx) = 0;

  virtual void enterTraceItem(devilangParser::TraceItemContext *ctx) = 0;
  virtual void exitTraceItem(devilangParser::TraceItemContext *ctx) = 0;

  virtual void enterTraceBlock(devilangParser::TraceBlockContext *ctx) = 0;
  virtual void exitTraceBlock(devilangParser::TraceBlockContext *ctx) = 0;

  virtual void enterTraceLabelBlock(devilangParser::TraceLabelBlockContext *ctx) = 0;
  virtual void exitTraceLabelBlock(devilangParser::TraceLabelBlockContext *ctx) = 0;

  virtual void enterTraceInstr(devilangParser::TraceInstrContext *ctx) = 0;
  virtual void exitTraceInstr(devilangParser::TraceInstrContext *ctx) = 0;

  virtual void enterTraceAssign(devilangParser::TraceAssignContext *ctx) = 0;
  virtual void exitTraceAssign(devilangParser::TraceAssignContext *ctx) = 0;

  virtual void enterTraceWrite(devilangParser::TraceWriteContext *ctx) = 0;
  virtual void exitTraceWrite(devilangParser::TraceWriteContext *ctx) = 0;

  virtual void enterTraceCall(devilangParser::TraceCallContext *ctx) = 0;
  virtual void exitTraceCall(devilangParser::TraceCallContext *ctx) = 0;

  virtual void enterTraceArgs(devilangParser::TraceArgsContext *ctx) = 0;
  virtual void exitTraceArgs(devilangParser::TraceArgsContext *ctx) = 0;

  virtual void enterTraceNeqj(devilangParser::TraceNeqjContext *ctx) = 0;
  virtual void exitTraceNeqj(devilangParser::TraceNeqjContext *ctx) = 0;

  virtual void enterTraceBug(devilangParser::TraceBugContext *ctx) = 0;
  virtual void exitTraceBug(devilangParser::TraceBugContext *ctx) = 0;

  virtual void enterTraceWarn(devilangParser::TraceWarnContext *ctx) = 0;
  virtual void exitTraceWarn(devilangParser::TraceWarnContext *ctx) = 0;

  virtual void enterEllipsisInstr(devilangParser::EllipsisInstrContext *ctx) = 0;
  virtual void exitEllipsisInstr(devilangParser::EllipsisInstrContext *ctx) = 0;

  virtual void enterLabelRef(devilangParser::LabelRefContext *ctx) = 0;
  virtual void exitLabelRef(devilangParser::LabelRefContext *ctx) = 0;

  virtual void enterTransitionDecl(devilangParser::TransitionDeclContext *ctx) = 0;
  virtual void exitTransitionDecl(devilangParser::TransitionDeclContext *ctx) = 0;

  virtual void enterTraceExpr(devilangParser::TraceExprContext *ctx) = 0;
  virtual void exitTraceExpr(devilangParser::TraceExprContext *ctx) = 0;

  virtual void enterTraceOrExpr(devilangParser::TraceOrExprContext *ctx) = 0;
  virtual void exitTraceOrExpr(devilangParser::TraceOrExprContext *ctx) = 0;

  virtual void enterTraceShiftExpr(devilangParser::TraceShiftExprContext *ctx) = 0;
  virtual void exitTraceShiftExpr(devilangParser::TraceShiftExprContext *ctx) = 0;

  virtual void enterTraceAddExpr(devilangParser::TraceAddExprContext *ctx) = 0;
  virtual void exitTraceAddExpr(devilangParser::TraceAddExprContext *ctx) = 0;

  virtual void enterTracePrimaryExpr(devilangParser::TracePrimaryExprContext *ctx) = 0;
  virtual void exitTracePrimaryExpr(devilangParser::TracePrimaryExprContext *ctx) = 0;

  virtual void enterReadExpr(devilangParser::ReadExprContext *ctx) = 0;
  virtual void exitReadExpr(devilangParser::ReadExprContext *ctx) = 0;

  virtual void enterOpExpr(devilangParser::OpExprContext *ctx) = 0;
  virtual void exitOpExpr(devilangParser::OpExprContext *ctx) = 0;

  virtual void enterOpOrExpr(devilangParser::OpOrExprContext *ctx) = 0;
  virtual void exitOpOrExpr(devilangParser::OpOrExprContext *ctx) = 0;

  virtual void enterOpAndExpr(devilangParser::OpAndExprContext *ctx) = 0;
  virtual void exitOpAndExpr(devilangParser::OpAndExprContext *ctx) = 0;

  virtual void enterOpAddExpr(devilangParser::OpAddExprContext *ctx) = 0;
  virtual void exitOpAddExpr(devilangParser::OpAddExprContext *ctx) = 0;

  virtual void enterOpShiftExpr(devilangParser::OpShiftExprContext *ctx) = 0;
  virtual void exitOpShiftExpr(devilangParser::OpShiftExprContext *ctx) = 0;

  virtual void enterOpPrimaryExpr(devilangParser::OpPrimaryExprContext *ctx) = 0;
  virtual void exitOpPrimaryExpr(devilangParser::OpPrimaryExprContext *ctx) = 0;

  virtual void enterFuncCall(devilangParser::FuncCallContext *ctx) = 0;
  virtual void exitFuncCall(devilangParser::FuncCallContext *ctx) = 0;

  virtual void enterFuncArgs(devilangParser::FuncArgsContext *ctx) = 0;
  virtual void exitFuncArgs(devilangParser::FuncArgsContext *ctx) = 0;

  virtual void enterQualifiedName(devilangParser::QualifiedNameContext *ctx) = 0;
  virtual void exitQualifiedName(devilangParser::QualifiedNameContext *ctx) = 0;

  virtual void enterFileName(devilangParser::FileNameContext *ctx) = 0;
  virtual void exitFileName(devilangParser::FileNameContext *ctx) = 0;

  virtual void enterRef(devilangParser::RefContext *ctx) = 0;
  virtual void exitRef(devilangParser::RefContext *ctx) = 0;

  virtual void enterFieldRef(devilangParser::FieldRefContext *ctx) = 0;
  virtual void exitFieldRef(devilangParser::FieldRefContext *ctx) = 0;

  virtual void enterBitRef(devilangParser::BitRefContext *ctx) = 0;
  virtual void exitBitRef(devilangParser::BitRefContext *ctx) = 0;

  virtual void enterExpr(devilangParser::ExprContext *ctx) = 0;
  virtual void exitExpr(devilangParser::ExprContext *ctx) = 0;

  virtual void enterPrimary(devilangParser::PrimaryContext *ctx) = 0;
  virtual void exitPrimary(devilangParser::PrimaryContext *ctx) = 0;

  virtual void enterBoolLiteral(devilangParser::BoolLiteralContext *ctx) = 0;
  virtual void exitBoolLiteral(devilangParser::BoolLiteralContext *ctx) = 0;


};

