
// Generated from devilang.g4 by ANTLR 4.9.2


#include "devilangListener.h"

#include "devilangParser.h"


using namespace antlrcpp;
using namespace antlr4;

devilangParser::devilangParser(TokenStream *input) : Parser(input) {
  _interpreter = new atn::ParserATNSimulator(this, _atn, _decisionToDFA, _sharedContextCache);
}

devilangParser::~devilangParser() {
  delete _interpreter;
}

std::string devilangParser::getGrammarFileName() const {
  return "devilang.g4";
}

const std::vector<std::string>& devilangParser::getRuleNames() const {
  return _ruleNames;
}

dfa::Vocabulary& devilangParser::getVocabulary() const {
  return _vocabulary;
}


//----------------- ProgramContext ------------------------------------------------------------------

devilangParser::ProgramContext::ProgramContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::ProgramContext::EOF() {
  return getToken(devilangParser::EOF, 0);
}

std::vector<devilangParser::DeclContext *> devilangParser::ProgramContext::decl() {
  return getRuleContexts<devilangParser::DeclContext>();
}

devilangParser::DeclContext* devilangParser::ProgramContext::decl(size_t i) {
  return getRuleContext<devilangParser::DeclContext>(i);
}


size_t devilangParser::ProgramContext::getRuleIndex() const {
  return devilangParser::RuleProgram;
}

void devilangParser::ProgramContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterProgram(this);
}

void devilangParser::ProgramContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitProgram(this);
}

devilangParser::ProgramContext* devilangParser::program() {
  ProgramContext *_localctx = _tracker.createInstance<ProgramContext>(_ctx, getState());
  enterRule(_localctx, 0, devilangParser::RuleProgram);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(163);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__0)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__50))) != 0) || ((((_la - 71) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 71)) & ((1ULL << (devilangParser::T__70 - 71))
      | (1ULL << (devilangParser::T__72 - 71))
      | (1ULL << (devilangParser::T__73 - 71))
      | (1ULL << (devilangParser::T__74 - 71))
      | (1ULL << (devilangParser::T__75 - 71))
      | (1ULL << (devilangParser::T__85 - 71)))) != 0)) {
      setState(160);
      decl();
      setState(165);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(166);
    match(devilangParser::EOF);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- DeclContext ------------------------------------------------------------------

devilangParser::DeclContext::DeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::StructDeclContext* devilangParser::DeclContext::structDecl() {
  return getRuleContext<devilangParser::StructDeclContext>(0);
}

devilangParser::TopologyDeclContext* devilangParser::DeclContext::topologyDecl() {
  return getRuleContext<devilangParser::TopologyDeclContext>(0);
}

devilangParser::ActionDeclContext* devilangParser::DeclContext::actionDecl() {
  return getRuleContext<devilangParser::ActionDeclContext>(0);
}

devilangParser::OpDeclContext* devilangParser::DeclContext::opDecl() {
  return getRuleContext<devilangParser::OpDeclContext>(0);
}

devilangParser::TopBbDeclContext* devilangParser::DeclContext::topBbDecl() {
  return getRuleContext<devilangParser::TopBbDeclContext>(0);
}

devilangParser::TopPathDeclContext* devilangParser::DeclContext::topPathDecl() {
  return getRuleContext<devilangParser::TopPathDeclContext>(0);
}

devilangParser::TopFuncDeclContext* devilangParser::DeclContext::topFuncDecl() {
  return getRuleContext<devilangParser::TopFuncDeclContext>(0);
}

devilangParser::StateDeclContext* devilangParser::DeclContext::stateDecl() {
  return getRuleContext<devilangParser::StateDeclContext>(0);
}


size_t devilangParser::DeclContext::getRuleIndex() const {
  return devilangParser::RuleDecl;
}

void devilangParser::DeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterDecl(this);
}

void devilangParser::DeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitDecl(this);
}

devilangParser::DeclContext* devilangParser::decl() {
  DeclContext *_localctx = _tracker.createInstance<DeclContext>(_ctx, getState());
  enterRule(_localctx, 2, devilangParser::RuleDecl);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(176);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__0: {
        enterOuterAlt(_localctx, 1);
        setState(168);
        structDecl();
        break;
      }

      case devilangParser::T__7:
      case devilangParser::T__70:
      case devilangParser::T__72:
      case devilangParser::T__73:
      case devilangParser::T__74:
      case devilangParser::T__75: {
        enterOuterAlt(_localctx, 2);
        setState(169);
        topologyDecl();
        break;
      }

      case devilangParser::T__85: {
        enterOuterAlt(_localctx, 3);
        setState(170);
        actionDecl();
        break;
      }

      case devilangParser::T__34: {
        enterOuterAlt(_localctx, 4);
        setState(171);
        opDecl();
        break;
      }

      case devilangParser::T__35: {
        enterOuterAlt(_localctx, 5);
        setState(172);
        topBbDecl();
        break;
      }

      case devilangParser::T__36: {
        enterOuterAlt(_localctx, 6);
        setState(173);
        topPathDecl();
        break;
      }

      case devilangParser::T__37: {
        enterOuterAlt(_localctx, 7);
        setState(174);
        topFuncDecl();
        break;
      }

      case devilangParser::T__50: {
        enterOuterAlt(_localctx, 8);
        setState(175);
        stateDecl();
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- StructDeclContext ------------------------------------------------------------------

devilangParser::StructDeclContext::StructDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::StructDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}

std::vector<devilangParser::FieldContext *> devilangParser::StructDeclContext::field() {
  return getRuleContexts<devilangParser::FieldContext>();
}

devilangParser::FieldContext* devilangParser::StructDeclContext::field(size_t i) {
  return getRuleContext<devilangParser::FieldContext>(i);
}


size_t devilangParser::StructDeclContext::getRuleIndex() const {
  return devilangParser::RuleStructDecl;
}

void devilangParser::StructDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterStructDecl(this);
}

void devilangParser::StructDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitStructDecl(this);
}

devilangParser::StructDeclContext* devilangParser::structDecl() {
  StructDeclContext *_localctx = _tracker.createInstance<StructDeclContext>(_ctx, getState());
  enterRule(_localctx, 4, devilangParser::RuleStructDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(178);
    match(devilangParser::T__0);
    setState(179);
    ident();
    setState(180);
    match(devilangParser::T__1);
    setState(184);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT) {
      setState(181);
      field();
      setState(186);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(187);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- FieldContext ------------------------------------------------------------------

devilangParser::FieldContext::FieldContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::FieldContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}

devilangParser::Type_Context* devilangParser::FieldContext::type_() {
  return getRuleContext<devilangParser::Type_Context>(0);
}

std::vector<devilangParser::ModifierContext *> devilangParser::FieldContext::modifier() {
  return getRuleContexts<devilangParser::ModifierContext>();
}

devilangParser::ModifierContext* devilangParser::FieldContext::modifier(size_t i) {
  return getRuleContext<devilangParser::ModifierContext>(i);
}

devilangParser::BitBlockContext* devilangParser::FieldContext::bitBlock() {
  return getRuleContext<devilangParser::BitBlockContext>(0);
}

devilangParser::ImmBlockContext* devilangParser::FieldContext::immBlock() {
  return getRuleContext<devilangParser::ImmBlockContext>(0);
}


size_t devilangParser::FieldContext::getRuleIndex() const {
  return devilangParser::RuleField;
}

void devilangParser::FieldContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterField(this);
}

void devilangParser::FieldContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitField(this);
}

devilangParser::FieldContext* devilangParser::field() {
  FieldContext *_localctx = _tracker.createInstance<FieldContext>(_ctx, getState());
  enterRule(_localctx, 6, devilangParser::RuleField);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(189);
    ident();
    setState(190);
    match(devilangParser::T__3);
    setState(191);
    type_();
    setState(195);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49))) != 0)) {
      setState(192);
      modifier();
      setState(197);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(199);
    _errHandler->sync(this);

    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 4, _ctx)) {
    case 1: {
      setState(198);
      bitBlock();
      break;
    }

    default:
      break;
    }
    setState(202);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__62) {
      setState(201);
      immBlock();
    }
    setState(204);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- IdentContext ------------------------------------------------------------------

devilangParser::IdentContext::IdentContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::IdentContext::IDENT() {
  return getToken(devilangParser::IDENT, 0);
}


size_t devilangParser::IdentContext::getRuleIndex() const {
  return devilangParser::RuleIdent;
}

void devilangParser::IdentContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterIdent(this);
}

void devilangParser::IdentContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitIdent(this);
}

devilangParser::IdentContext* devilangParser::ident() {
  IdentContext *_localctx = _tracker.createInstance<IdentContext>(_ctx, getState());
  enterRule(_localctx, 8, devilangParser::RuleIdent);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(206);
    _la = _input->LA(1);
    if (!((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT)) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- Type_Context ------------------------------------------------------------------

devilangParser::Type_Context::Type_Context(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::BaseTypeContext* devilangParser::Type_Context::baseType() {
  return getRuleContext<devilangParser::BaseTypeContext>(0);
}

devilangParser::PtrTypeContext* devilangParser::Type_Context::ptrType() {
  return getRuleContext<devilangParser::PtrTypeContext>(0);
}

devilangParser::BytesTypeContext* devilangParser::Type_Context::bytesType() {
  return getRuleContext<devilangParser::BytesTypeContext>(0);
}


size_t devilangParser::Type_Context::getRuleIndex() const {
  return devilangParser::RuleType_;
}

void devilangParser::Type_Context::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterType_(this);
}

void devilangParser::Type_Context::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitType_(this);
}

devilangParser::Type_Context* devilangParser::type_() {
  Type_Context *_localctx = _tracker.createInstance<Type_Context>(_ctx, getState());
  enterRule(_localctx, 10, devilangParser::RuleType_);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(211);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__54:
      case devilangParser::T__55:
      case devilangParser::T__56:
      case devilangParser::T__57: {
        enterOuterAlt(_localctx, 1);
        setState(208);
        baseType();
        break;
      }

      case devilangParser::T__58: {
        enterOuterAlt(_localctx, 2);
        setState(209);
        ptrType();
        break;
      }

      case devilangParser::T__61: {
        enterOuterAlt(_localctx, 3);
        setState(210);
        bytesType();
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BaseTypeContext ------------------------------------------------------------------

devilangParser::BaseTypeContext::BaseTypeContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::BaseTypeContext::getRuleIndex() const {
  return devilangParser::RuleBaseType;
}

void devilangParser::BaseTypeContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBaseType(this);
}

void devilangParser::BaseTypeContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBaseType(this);
}

devilangParser::BaseTypeContext* devilangParser::baseType() {
  BaseTypeContext *_localctx = _tracker.createInstance<BaseTypeContext>(_ctx, getState());
  enterRule(_localctx, 12, devilangParser::RuleBaseType);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(213);
    _la = _input->LA(1);
    if (!((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57))) != 0))) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- PtrTypeContext ------------------------------------------------------------------

devilangParser::PtrTypeContext::PtrTypeContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::Type_Context* devilangParser::PtrTypeContext::type_() {
  return getRuleContext<devilangParser::Type_Context>(0);
}


size_t devilangParser::PtrTypeContext::getRuleIndex() const {
  return devilangParser::RulePtrType;
}

void devilangParser::PtrTypeContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterPtrType(this);
}

void devilangParser::PtrTypeContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitPtrType(this);
}

devilangParser::PtrTypeContext* devilangParser::ptrType() {
  PtrTypeContext *_localctx = _tracker.createInstance<PtrTypeContext>(_ctx, getState());
  enterRule(_localctx, 14, devilangParser::RulePtrType);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(215);
    match(devilangParser::T__58);
    setState(216);
    match(devilangParser::T__59);
    setState(217);
    type_();
    setState(218);
    match(devilangParser::T__60);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BytesTypeContext ------------------------------------------------------------------

devilangParser::BytesTypeContext::BytesTypeContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::BytesTypeContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::BytesTypeContext::getRuleIndex() const {
  return devilangParser::RuleBytesType;
}

void devilangParser::BytesTypeContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBytesType(this);
}

void devilangParser::BytesTypeContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBytesType(this);
}

devilangParser::BytesTypeContext* devilangParser::bytesType() {
  BytesTypeContext *_localctx = _tracker.createInstance<BytesTypeContext>(_ctx, getState());
  enterRule(_localctx, 16, devilangParser::RuleBytesType);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(220);
    match(devilangParser::T__61);
    setState(221);
    match(devilangParser::T__62);
    setState(222);
    match(devilangParser::INT);
    setState(223);
    match(devilangParser::T__63);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ModifierContext ------------------------------------------------------------------

devilangParser::ModifierContext::ModifierContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::ModifierContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::ModifierContext::getRuleIndex() const {
  return devilangParser::RuleModifier;
}

void devilangParser::ModifierContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterModifier(this);
}

void devilangParser::ModifierContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitModifier(this);
}

devilangParser::ModifierContext* devilangParser::modifier() {
  ModifierContext *_localctx = _tracker.createInstance<ModifierContext>(_ctx, getState());
  enterRule(_localctx, 18, devilangParser::RuleModifier);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(230);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__47: {
        enterOuterAlt(_localctx, 1);
        setState(225);
        match(devilangParser::T__47);
        break;
      }

      case devilangParser::T__48: {
        enterOuterAlt(_localctx, 2);
        setState(226);
        match(devilangParser::T__48);
        break;
      }

      case devilangParser::T__49: {
        enterOuterAlt(_localctx, 3);
        setState(227);
        match(devilangParser::T__49);
        break;
      }

      case devilangParser::T__12: {
        enterOuterAlt(_localctx, 4);
        setState(228);
        match(devilangParser::T__12);
        setState(229);
        match(devilangParser::INT);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitBlockContext ------------------------------------------------------------------

devilangParser::BitBlockContext::BitBlockContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::BitEntryContext *> devilangParser::BitBlockContext::bitEntry() {
  return getRuleContexts<devilangParser::BitEntryContext>();
}

devilangParser::BitEntryContext* devilangParser::BitBlockContext::bitEntry(size_t i) {
  return getRuleContext<devilangParser::BitEntryContext>(i);
}

std::vector<devilangParser::BitSepContext *> devilangParser::BitBlockContext::bitSep() {
  return getRuleContexts<devilangParser::BitSepContext>();
}

devilangParser::BitSepContext* devilangParser::BitBlockContext::bitSep(size_t i) {
  return getRuleContext<devilangParser::BitSepContext>(i);
}


size_t devilangParser::BitBlockContext::getRuleIndex() const {
  return devilangParser::RuleBitBlock;
}

void devilangParser::BitBlockContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitBlock(this);
}

void devilangParser::BitBlockContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitBlock(this);
}

devilangParser::BitBlockContext* devilangParser::bitBlock() {
  BitBlockContext *_localctx = _tracker.createInstance<BitBlockContext>(_ctx, getState());
  enterRule(_localctx, 20, devilangParser::RuleBitBlock);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    size_t alt;
    enterOuterAlt(_localctx, 1);
    setState(232);
    match(devilangParser::T__62);
    setState(245);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__64

    || _la == devilangParser::INT) {
      setState(233);
      bitEntry();
      setState(239);
      _errHandler->sync(this);
      alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 8, _ctx);
      while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER) {
        if (alt == 1) {
          setState(234);
          bitSep();
          setState(235);
          bitEntry(); 
        }
        setState(241);
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 8, _ctx);
      }
      setState(243);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if (_la == devilangParser::T__4

      || _la == devilangParser::T__67) {
        setState(242);
        bitSep();
      }
    }
    setState(247);
    match(devilangParser::T__63);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitEntryContext ------------------------------------------------------------------

devilangParser::BitEntryContext::BitEntryContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::BitRangeContext* devilangParser::BitEntryContext::bitRange() {
  return getRuleContext<devilangParser::BitRangeContext>(0);
}

devilangParser::BitValueContext* devilangParser::BitEntryContext::bitValue() {
  return getRuleContext<devilangParser::BitValueContext>(0);
}


size_t devilangParser::BitEntryContext::getRuleIndex() const {
  return devilangParser::RuleBitEntry;
}

void devilangParser::BitEntryContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitEntry(this);
}

void devilangParser::BitEntryContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitEntry(this);
}

devilangParser::BitEntryContext* devilangParser::bitEntry() {
  BitEntryContext *_localctx = _tracker.createInstance<BitEntryContext>(_ctx, getState());
  enterRule(_localctx, 22, devilangParser::RuleBitEntry);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(249);
    bitRange();
    setState(251);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__66) {
      setState(250);
      bitValue();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitRangeContext ------------------------------------------------------------------

devilangParser::BitRangeContext::BitRangeContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<tree::TerminalNode *> devilangParser::BitRangeContext::INT() {
  return getTokens(devilangParser::INT);
}

tree::TerminalNode* devilangParser::BitRangeContext::INT(size_t i) {
  return getToken(devilangParser::INT, i);
}


size_t devilangParser::BitRangeContext::getRuleIndex() const {
  return devilangParser::RuleBitRange;
}

void devilangParser::BitRangeContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitRange(this);
}

void devilangParser::BitRangeContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitRange(this);
}

devilangParser::BitRangeContext* devilangParser::bitRange() {
  BitRangeContext *_localctx = _tracker.createInstance<BitRangeContext>(_ctx, getState());
  enterRule(_localctx, 24, devilangParser::RuleBitRange);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(260);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__64: {
        enterOuterAlt(_localctx, 1);
        setState(253);
        match(devilangParser::T__64);
        setState(254);
        match(devilangParser::INT);
        setState(255);
        match(devilangParser::T__65);
        setState(256);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::INT: {
        enterOuterAlt(_localctx, 2);
        setState(257);
        match(devilangParser::INT);
        setState(258);
        match(devilangParser::T__65);
        setState(259);
        match(devilangParser::INT);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitValueContext ------------------------------------------------------------------

devilangParser::BitValueContext::BitValueContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::BitValueContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::BitValueContext::getRuleIndex() const {
  return devilangParser::RuleBitValue;
}

void devilangParser::BitValueContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitValue(this);
}

void devilangParser::BitValueContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitValue(this);
}

devilangParser::BitValueContext* devilangParser::bitValue() {
  BitValueContext *_localctx = _tracker.createInstance<BitValueContext>(_ctx, getState());
  enterRule(_localctx, 26, devilangParser::RuleBitValue);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(262);
    match(devilangParser::T__66);
    setState(263);
    match(devilangParser::INT);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitSepContext ------------------------------------------------------------------

devilangParser::BitSepContext::BitSepContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::BitSepContext::getRuleIndex() const {
  return devilangParser::RuleBitSep;
}

void devilangParser::BitSepContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitSep(this);
}

void devilangParser::BitSepContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitSep(this);
}

devilangParser::BitSepContext* devilangParser::bitSep() {
  BitSepContext *_localctx = _tracker.createInstance<BitSepContext>(_ctx, getState());
  enterRule(_localctx, 28, devilangParser::RuleBitSep);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(265);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__4

    || _la == devilangParser::T__67)) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ImmBlockContext ------------------------------------------------------------------

devilangParser::ImmBlockContext::ImmBlockContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::ImmEntryContext *> devilangParser::ImmBlockContext::immEntry() {
  return getRuleContexts<devilangParser::ImmEntryContext>();
}

devilangParser::ImmEntryContext* devilangParser::ImmBlockContext::immEntry(size_t i) {
  return getRuleContext<devilangParser::ImmEntryContext>(i);
}

std::vector<devilangParser::ImmSepContext *> devilangParser::ImmBlockContext::immSep() {
  return getRuleContexts<devilangParser::ImmSepContext>();
}

devilangParser::ImmSepContext* devilangParser::ImmBlockContext::immSep(size_t i) {
  return getRuleContext<devilangParser::ImmSepContext>(i);
}


size_t devilangParser::ImmBlockContext::getRuleIndex() const {
  return devilangParser::RuleImmBlock;
}

void devilangParser::ImmBlockContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterImmBlock(this);
}

void devilangParser::ImmBlockContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitImmBlock(this);
}

devilangParser::ImmBlockContext* devilangParser::immBlock() {
  ImmBlockContext *_localctx = _tracker.createInstance<ImmBlockContext>(_ctx, getState());
  enterRule(_localctx, 30, devilangParser::RuleImmBlock);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    size_t alt;
    enterOuterAlt(_localctx, 1);
    setState(267);
    match(devilangParser::T__62);
    setState(280);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (((((_la - 69) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 69)) & ((1ULL << (devilangParser::T__68 - 69))
      | (1ULL << (devilangParser::T__69 - 69))
      | (1ULL << (devilangParser::INT - 69)))) != 0)) {
      setState(268);
      immEntry();
      setState(274);
      _errHandler->sync(this);
      alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 13, _ctx);
      while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER) {
        if (alt == 1) {
          setState(269);
          immSep();
          setState(270);
          immEntry(); 
        }
        setState(276);
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 13, _ctx);
      }
      setState(278);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if (_la == devilangParser::T__4

      || _la == devilangParser::T__67) {
        setState(277);
        immSep();
      }
    }
    setState(282);
    match(devilangParser::T__63);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ImmEntryContext ------------------------------------------------------------------

devilangParser::ImmEntryContext::ImmEntryContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<tree::TerminalNode *> devilangParser::ImmEntryContext::INT() {
  return getTokens(devilangParser::INT);
}

tree::TerminalNode* devilangParser::ImmEntryContext::INT(size_t i) {
  return getToken(devilangParser::INT, i);
}


size_t devilangParser::ImmEntryContext::getRuleIndex() const {
  return devilangParser::RuleImmEntry;
}

void devilangParser::ImmEntryContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterImmEntry(this);
}

void devilangParser::ImmEntryContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitImmEntry(this);
}

devilangParser::ImmEntryContext* devilangParser::immEntry() {
  ImmEntryContext *_localctx = _tracker.createInstance<ImmEntryContext>(_ctx, getState());
  enterRule(_localctx, 32, devilangParser::RuleImmEntry);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(294);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 16, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(284);
      match(devilangParser::T__68);
      setState(285);
      match(devilangParser::INT);
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(286);
      match(devilangParser::T__69);
      setState(287);
      match(devilangParser::INT);
      setState(288);
      match(devilangParser::T__65);
      setState(289);
      match(devilangParser::INT);
      break;
    }

    case 3: {
      enterOuterAlt(_localctx, 3);
      setState(290);
      match(devilangParser::INT);
      break;
    }

    case 4: {
      enterOuterAlt(_localctx, 4);
      setState(291);
      match(devilangParser::INT);
      setState(292);
      match(devilangParser::T__65);
      setState(293);
      match(devilangParser::INT);
      break;
    }

    default:
      break;
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ImmSepContext ------------------------------------------------------------------

devilangParser::ImmSepContext::ImmSepContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::ImmSepContext::getRuleIndex() const {
  return devilangParser::RuleImmSep;
}

void devilangParser::ImmSepContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterImmSep(this);
}

void devilangParser::ImmSepContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitImmSep(this);
}

devilangParser::ImmSepContext* devilangParser::immSep() {
  ImmSepContext *_localctx = _tracker.createInstance<ImmSepContext>(_ctx, getState());
  enterRule(_localctx, 34, devilangParser::RuleImmSep);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(296);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__4

    || _la == devilangParser::T__67)) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopologyDeclContext ------------------------------------------------------------------

devilangParser::TopologyDeclContext::TopologyDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::PointerDeclContext* devilangParser::TopologyDeclContext::pointerDecl() {
  return getRuleContext<devilangParser::PointerDeclContext>(0);
}

devilangParser::ListDeclContext* devilangParser::TopologyDeclContext::listDecl() {
  return getRuleContext<devilangParser::ListDeclContext>(0);
}

devilangParser::DlistDeclContext* devilangParser::TopologyDeclContext::dlistDecl() {
  return getRuleContext<devilangParser::DlistDeclContext>(0);
}

devilangParser::RingDeclContext* devilangParser::TopologyDeclContext::ringDecl() {
  return getRuleContext<devilangParser::RingDeclContext>(0);
}

devilangParser::RingbufDeclContext* devilangParser::TopologyDeclContext::ringbufDecl() {
  return getRuleContext<devilangParser::RingbufDeclContext>(0);
}

devilangParser::HeadDeclContext* devilangParser::TopologyDeclContext::headDecl() {
  return getRuleContext<devilangParser::HeadDeclContext>(0);
}


size_t devilangParser::TopologyDeclContext::getRuleIndex() const {
  return devilangParser::RuleTopologyDecl;
}

void devilangParser::TopologyDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopologyDecl(this);
}

void devilangParser::TopologyDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopologyDecl(this);
}

devilangParser::TopologyDeclContext* devilangParser::topologyDecl() {
  TopologyDeclContext *_localctx = _tracker.createInstance<TopologyDeclContext>(_ctx, getState());
  enterRule(_localctx, 36, devilangParser::RuleTopologyDecl);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(304);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__70: {
        enterOuterAlt(_localctx, 1);
        setState(298);
        pointerDecl();
        break;
      }

      case devilangParser::T__72: {
        enterOuterAlt(_localctx, 2);
        setState(299);
        listDecl();
        break;
      }

      case devilangParser::T__73: {
        enterOuterAlt(_localctx, 3);
        setState(300);
        dlistDecl();
        break;
      }

      case devilangParser::T__74: {
        enterOuterAlt(_localctx, 4);
        setState(301);
        ringDecl();
        break;
      }

      case devilangParser::T__75: {
        enterOuterAlt(_localctx, 5);
        setState(302);
        ringbufDecl();
        break;
      }

      case devilangParser::T__7: {
        enterOuterAlt(_localctx, 6);
        setState(303);
        headDecl();
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- PointerDeclContext ------------------------------------------------------------------

devilangParser::PointerDeclContext::PointerDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::PointerFieldContext *> devilangParser::PointerDeclContext::pointerField() {
  return getRuleContexts<devilangParser::PointerFieldContext>();
}

devilangParser::PointerFieldContext* devilangParser::PointerDeclContext::pointerField(size_t i) {
  return getRuleContext<devilangParser::PointerFieldContext>(i);
}


size_t devilangParser::PointerDeclContext::getRuleIndex() const {
  return devilangParser::RulePointerDecl;
}

void devilangParser::PointerDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterPointerDecl(this);
}

void devilangParser::PointerDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitPointerDecl(this);
}

devilangParser::PointerDeclContext* devilangParser::pointerDecl() {
  PointerDeclContext *_localctx = _tracker.createInstance<PointerDeclContext>(_ctx, getState());
  enterRule(_localctx, 38, devilangParser::RulePointerDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(306);
    match(devilangParser::T__70);
    setState(307);
    match(devilangParser::T__1);
    setState(311);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__49))) != 0)) {
      setState(308);
      pointerField();
      setState(313);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(314);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- PointerFieldContext ------------------------------------------------------------------

devilangParser::PointerFieldContext::PointerFieldContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::RefContext* devilangParser::PointerFieldContext::ref() {
  return getRuleContext<devilangParser::RefContext>(0);
}

devilangParser::TypeListContext* devilangParser::PointerFieldContext::typeList() {
  return getRuleContext<devilangParser::TypeListContext>(0);
}

tree::TerminalNode* devilangParser::PointerFieldContext::INT() {
  return getToken(devilangParser::INT, 0);
}

devilangParser::BoolLiteralContext* devilangParser::PointerFieldContext::boolLiteral() {
  return getRuleContext<devilangParser::BoolLiteralContext>(0);
}

devilangParser::BitRefListContext* devilangParser::PointerFieldContext::bitRefList() {
  return getRuleContext<devilangParser::BitRefListContext>(0);
}


size_t devilangParser::PointerFieldContext::getRuleIndex() const {
  return devilangParser::RulePointerField;
}

void devilangParser::PointerFieldContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterPointerField(this);
}

void devilangParser::PointerFieldContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitPointerField(this);
}

devilangParser::PointerFieldContext* devilangParser::pointerField() {
  PointerFieldContext *_localctx = _tracker.createInstance<PointerFieldContext>(_ctx, getState());
  enterRule(_localctx, 40, devilangParser::RulePointerField);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(344);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__13: {
        enterOuterAlt(_localctx, 1);
        setState(316);
        match(devilangParser::T__13);
        setState(317);
        match(devilangParser::T__66);
        setState(318);
        ref();
        setState(319);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__14: {
        enterOuterAlt(_localctx, 2);
        setState(321);
        match(devilangParser::T__14);
        setState(322);
        match(devilangParser::T__66);
        setState(323);
        typeList();
        setState(324);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__12: {
        enterOuterAlt(_localctx, 3);
        setState(326);
        match(devilangParser::T__12);
        setState(327);
        match(devilangParser::T__66);
        setState(328);
        match(devilangParser::INT);
        setState(329);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__49: {
        enterOuterAlt(_localctx, 4);
        setState(330);
        match(devilangParser::T__49);
        setState(331);
        match(devilangParser::T__66);
        setState(332);
        boolLiteral();
        setState(333);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__5: {
        enterOuterAlt(_localctx, 5);
        setState(335);
        match(devilangParser::T__5);
        setState(336);
        match(devilangParser::T__66);
        setState(337);
        match(devilangParser::INT);
        setState(338);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__15: {
        enterOuterAlt(_localctx, 6);
        setState(339);
        match(devilangParser::T__15);
        setState(340);
        match(devilangParser::T__66);
        setState(341);
        bitRefList();
        setState(342);
        match(devilangParser::T__4);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitRefListContext ------------------------------------------------------------------

devilangParser::BitRefListContext::BitRefListContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::BitRefContext *> devilangParser::BitRefListContext::bitRef() {
  return getRuleContexts<devilangParser::BitRefContext>();
}

devilangParser::BitRefContext* devilangParser::BitRefListContext::bitRef(size_t i) {
  return getRuleContext<devilangParser::BitRefContext>(i);
}


size_t devilangParser::BitRefListContext::getRuleIndex() const {
  return devilangParser::RuleBitRefList;
}

void devilangParser::BitRefListContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitRefList(this);
}

void devilangParser::BitRefListContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitRefList(this);
}

devilangParser::BitRefListContext* devilangParser::bitRefList() {
  BitRefListContext *_localctx = _tracker.createInstance<BitRefListContext>(_ctx, getState());
  enterRule(_localctx, 42, devilangParser::RuleBitRefList);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(346);
    bitRef();
    setState(351);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__71) {
      setState(347);
      match(devilangParser::T__71);
      setState(348);
      bitRef();
      setState(353);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ListDeclContext ------------------------------------------------------------------

devilangParser::ListDeclContext::ListDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TypeListContext* devilangParser::ListDeclContext::typeList() {
  return getRuleContext<devilangParser::TypeListContext>(0);
}

devilangParser::ListBodyContext* devilangParser::ListDeclContext::listBody() {
  return getRuleContext<devilangParser::ListBodyContext>(0);
}

devilangParser::IdentContext* devilangParser::ListDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::ListDeclContext::getRuleIndex() const {
  return devilangParser::RuleListDecl;
}

void devilangParser::ListDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterListDecl(this);
}

void devilangParser::ListDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitListDecl(this);
}

devilangParser::ListDeclContext* devilangParser::listDecl() {
  ListDeclContext *_localctx = _tracker.createInstance<ListDeclContext>(_ctx, getState());
  enterRule(_localctx, 44, devilangParser::RuleListDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(354);
    match(devilangParser::T__72);
    setState(355);
    match(devilangParser::T__59);
    setState(356);
    typeList();
    setState(357);
    match(devilangParser::T__60);
    setState(359);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT) {
      setState(358);
      ident();
    }
    setState(361);
    match(devilangParser::T__1);
    setState(362);
    listBody();
    setState(363);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- DlistDeclContext ------------------------------------------------------------------

devilangParser::DlistDeclContext::DlistDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TypeListContext* devilangParser::DlistDeclContext::typeList() {
  return getRuleContext<devilangParser::TypeListContext>(0);
}

devilangParser::DlistBodyContext* devilangParser::DlistDeclContext::dlistBody() {
  return getRuleContext<devilangParser::DlistBodyContext>(0);
}

devilangParser::IdentContext* devilangParser::DlistDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::DlistDeclContext::getRuleIndex() const {
  return devilangParser::RuleDlistDecl;
}

void devilangParser::DlistDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterDlistDecl(this);
}

void devilangParser::DlistDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitDlistDecl(this);
}

devilangParser::DlistDeclContext* devilangParser::dlistDecl() {
  DlistDeclContext *_localctx = _tracker.createInstance<DlistDeclContext>(_ctx, getState());
  enterRule(_localctx, 46, devilangParser::RuleDlistDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(365);
    match(devilangParser::T__73);
    setState(366);
    match(devilangParser::T__59);
    setState(367);
    typeList();
    setState(368);
    match(devilangParser::T__60);
    setState(370);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT) {
      setState(369);
      ident();
    }
    setState(372);
    match(devilangParser::T__1);
    setState(373);
    dlistBody();
    setState(374);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- RingDeclContext ------------------------------------------------------------------

devilangParser::RingDeclContext::RingDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TypeListContext* devilangParser::RingDeclContext::typeList() {
  return getRuleContext<devilangParser::TypeListContext>(0);
}

devilangParser::RingBodyContext* devilangParser::RingDeclContext::ringBody() {
  return getRuleContext<devilangParser::RingBodyContext>(0);
}

devilangParser::IdentContext* devilangParser::RingDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::RingDeclContext::getRuleIndex() const {
  return devilangParser::RuleRingDecl;
}

void devilangParser::RingDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterRingDecl(this);
}

void devilangParser::RingDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitRingDecl(this);
}

devilangParser::RingDeclContext* devilangParser::ringDecl() {
  RingDeclContext *_localctx = _tracker.createInstance<RingDeclContext>(_ctx, getState());
  enterRule(_localctx, 48, devilangParser::RuleRingDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(376);
    match(devilangParser::T__74);
    setState(377);
    match(devilangParser::T__59);
    setState(378);
    typeList();
    setState(379);
    match(devilangParser::T__60);
    setState(381);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT) {
      setState(380);
      ident();
    }
    setState(383);
    match(devilangParser::T__1);
    setState(384);
    ringBody();
    setState(385);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- RingbufDeclContext ------------------------------------------------------------------

devilangParser::RingbufDeclContext::RingbufDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::Type_Context* devilangParser::RingbufDeclContext::type_() {
  return getRuleContext<devilangParser::Type_Context>(0);
}

devilangParser::RingbufBodyContext* devilangParser::RingbufDeclContext::ringbufBody() {
  return getRuleContext<devilangParser::RingbufBodyContext>(0);
}

devilangParser::IdentContext* devilangParser::RingbufDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::RingbufDeclContext::getRuleIndex() const {
  return devilangParser::RuleRingbufDecl;
}

void devilangParser::RingbufDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterRingbufDecl(this);
}

void devilangParser::RingbufDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitRingbufDecl(this);
}

devilangParser::RingbufDeclContext* devilangParser::ringbufDecl() {
  RingbufDeclContext *_localctx = _tracker.createInstance<RingbufDeclContext>(_ctx, getState());
  enterRule(_localctx, 50, devilangParser::RuleRingbufDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(387);
    match(devilangParser::T__75);
    setState(388);
    match(devilangParser::T__59);
    setState(389);
    type_();
    setState(390);
    match(devilangParser::T__60);
    setState(392);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT) {
      setState(391);
      ident();
    }
    setState(394);
    match(devilangParser::T__1);
    setState(395);
    ringbufBody();
    setState(396);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TypeListContext ------------------------------------------------------------------

devilangParser::TypeListContext::TypeListContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::IdentContext *> devilangParser::TypeListContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::TypeListContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}


size_t devilangParser::TypeListContext::getRuleIndex() const {
  return devilangParser::RuleTypeList;
}

void devilangParser::TypeListContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTypeList(this);
}

void devilangParser::TypeListContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTypeList(this);
}

devilangParser::TypeListContext* devilangParser::typeList() {
  TypeListContext *_localctx = _tracker.createInstance<TypeListContext>(_ctx, getState());
  enterRule(_localctx, 52, devilangParser::RuleTypeList);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(398);
    ident();
    setState(403);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__71) {
      setState(399);
      match(devilangParser::T__71);
      setState(400);
      ident();
      setState(405);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- SpaceTypeListContext ------------------------------------------------------------------

devilangParser::SpaceTypeListContext::SpaceTypeListContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::IdentContext *> devilangParser::SpaceTypeListContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::SpaceTypeListContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}


size_t devilangParser::SpaceTypeListContext::getRuleIndex() const {
  return devilangParser::RuleSpaceTypeList;
}

void devilangParser::SpaceTypeListContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterSpaceTypeList(this);
}

void devilangParser::SpaceTypeListContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitSpaceTypeList(this);
}

devilangParser::SpaceTypeListContext* devilangParser::spaceTypeList() {
  SpaceTypeListContext *_localctx = _tracker.createInstance<SpaceTypeListContext>(_ctx, getState());
  enterRule(_localctx, 54, devilangParser::RuleSpaceTypeList);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(407); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(406);
      ident();
      setState(409); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ListBodyContext ------------------------------------------------------------------

devilangParser::ListBodyContext::ListBodyContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::RefContext *> devilangParser::ListBodyContext::ref() {
  return getRuleContexts<devilangParser::RefContext>();
}

devilangParser::RefContext* devilangParser::ListBodyContext::ref(size_t i) {
  return getRuleContext<devilangParser::RefContext>(i);
}

devilangParser::FieldRefOrListContext* devilangParser::ListBodyContext::fieldRefOrList() {
  return getRuleContext<devilangParser::FieldRefOrListContext>(0);
}

devilangParser::BitRefListContext* devilangParser::ListBodyContext::bitRefList() {
  return getRuleContext<devilangParser::BitRefListContext>(0);
}

tree::TerminalNode* devilangParser::ListBodyContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::ListBodyContext::getRuleIndex() const {
  return devilangParser::RuleListBody;
}

void devilangParser::ListBodyContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterListBody(this);
}

void devilangParser::ListBodyContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitListBody(this);
}

devilangParser::ListBodyContext* devilangParser::listBody() {
  ListBodyContext *_localctx = _tracker.createInstance<ListBodyContext>(_ctx, getState());
  enterRule(_localctx, 56, devilangParser::RuleListBody);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(411);
    match(devilangParser::T__7);
    setState(412);
    match(devilangParser::T__66);
    setState(413);
    ref();
    setState(414);
    match(devilangParser::T__4);
    setState(415);
    match(devilangParser::T__8);
    setState(416);
    match(devilangParser::T__66);
    setState(417);
    ref();
    setState(418);
    match(devilangParser::T__4);
    setState(419);
    match(devilangParser::T__9);
    setState(420);
    match(devilangParser::T__66);
    setState(421);
    fieldRefOrList();
    setState(422);
    match(devilangParser::T__4);
    setState(428);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__15) {
      setState(423);
      match(devilangParser::T__15);
      setState(424);
      match(devilangParser::T__66);
      setState(425);
      bitRefList();
      setState(426);
      match(devilangParser::T__4);
    }
    setState(434);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(430);
      match(devilangParser::T__12);
      setState(431);
      match(devilangParser::T__66);
      setState(432);
      match(devilangParser::INT);
      setState(433);
      match(devilangParser::T__4);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- DlistBodyContext ------------------------------------------------------------------

devilangParser::DlistBodyContext::DlistBodyContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::RefContext *> devilangParser::DlistBodyContext::ref() {
  return getRuleContexts<devilangParser::RefContext>();
}

devilangParser::RefContext* devilangParser::DlistBodyContext::ref(size_t i) {
  return getRuleContext<devilangParser::RefContext>(i);
}

std::vector<devilangParser::FieldRefOrListContext *> devilangParser::DlistBodyContext::fieldRefOrList() {
  return getRuleContexts<devilangParser::FieldRefOrListContext>();
}

devilangParser::FieldRefOrListContext* devilangParser::DlistBodyContext::fieldRefOrList(size_t i) {
  return getRuleContext<devilangParser::FieldRefOrListContext>(i);
}

devilangParser::BitRefListContext* devilangParser::DlistBodyContext::bitRefList() {
  return getRuleContext<devilangParser::BitRefListContext>(0);
}

tree::TerminalNode* devilangParser::DlistBodyContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::DlistBodyContext::getRuleIndex() const {
  return devilangParser::RuleDlistBody;
}

void devilangParser::DlistBodyContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterDlistBody(this);
}

void devilangParser::DlistBodyContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitDlistBody(this);
}

devilangParser::DlistBodyContext* devilangParser::dlistBody() {
  DlistBodyContext *_localctx = _tracker.createInstance<DlistBodyContext>(_ctx, getState());
  enterRule(_localctx, 58, devilangParser::RuleDlistBody);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(436);
    match(devilangParser::T__7);
    setState(437);
    match(devilangParser::T__66);
    setState(438);
    ref();
    setState(439);
    match(devilangParser::T__4);
    setState(440);
    match(devilangParser::T__8);
    setState(441);
    match(devilangParser::T__66);
    setState(442);
    ref();
    setState(443);
    match(devilangParser::T__4);
    setState(444);
    match(devilangParser::T__9);
    setState(445);
    match(devilangParser::T__66);
    setState(446);
    fieldRefOrList();
    setState(447);
    match(devilangParser::T__4);
    setState(448);
    match(devilangParser::T__10);
    setState(449);
    match(devilangParser::T__66);
    setState(450);
    fieldRefOrList();
    setState(451);
    match(devilangParser::T__4);
    setState(457);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__15) {
      setState(452);
      match(devilangParser::T__15);
      setState(453);
      match(devilangParser::T__66);
      setState(454);
      bitRefList();
      setState(455);
      match(devilangParser::T__4);
    }
    setState(463);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(459);
      match(devilangParser::T__12);
      setState(460);
      match(devilangParser::T__66);
      setState(461);
      match(devilangParser::INT);
      setState(462);
      match(devilangParser::T__4);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- RingBodyContext ------------------------------------------------------------------

devilangParser::RingBodyContext::RingBodyContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::RefContext* devilangParser::RingBodyContext::ref() {
  return getRuleContext<devilangParser::RefContext>(0);
}

devilangParser::FieldRefOrListContext* devilangParser::RingBodyContext::fieldRefOrList() {
  return getRuleContext<devilangParser::FieldRefOrListContext>(0);
}

tree::TerminalNode* devilangParser::RingBodyContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::RingBodyContext::getRuleIndex() const {
  return devilangParser::RuleRingBody;
}

void devilangParser::RingBodyContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterRingBody(this);
}

void devilangParser::RingBodyContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitRingBody(this);
}

devilangParser::RingBodyContext* devilangParser::ringBody() {
  RingBodyContext *_localctx = _tracker.createInstance<RingBodyContext>(_ctx, getState());
  enterRule(_localctx, 60, devilangParser::RuleRingBody);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(465);
    match(devilangParser::T__7);
    setState(466);
    match(devilangParser::T__66);
    setState(467);
    ref();
    setState(468);
    match(devilangParser::T__4);
    setState(469);
    match(devilangParser::T__9);
    setState(470);
    match(devilangParser::T__66);
    setState(471);
    fieldRefOrList();
    setState(472);
    match(devilangParser::T__4);
    setState(477);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(473);
      match(devilangParser::T__12);
      setState(474);
      match(devilangParser::T__66);
      setState(475);
      match(devilangParser::INT);
      setState(476);
      match(devilangParser::T__4);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- FieldRefOrListContext ------------------------------------------------------------------

devilangParser::FieldRefOrListContext::FieldRefOrListContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::FieldRefContext *> devilangParser::FieldRefOrListContext::fieldRef() {
  return getRuleContexts<devilangParser::FieldRefContext>();
}

devilangParser::FieldRefContext* devilangParser::FieldRefOrListContext::fieldRef(size_t i) {
  return getRuleContext<devilangParser::FieldRefContext>(i);
}

std::vector<devilangParser::IdentContext *> devilangParser::FieldRefOrListContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::FieldRefOrListContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}


size_t devilangParser::FieldRefOrListContext::getRuleIndex() const {
  return devilangParser::RuleFieldRefOrList;
}

void devilangParser::FieldRefOrListContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterFieldRefOrList(this);
}

void devilangParser::FieldRefOrListContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitFieldRefOrList(this);
}

devilangParser::FieldRefOrListContext* devilangParser::fieldRefOrList() {
  FieldRefOrListContext *_localctx = _tracker.createInstance<FieldRefOrListContext>(_ctx, getState());
  enterRule(_localctx, 62, devilangParser::RuleFieldRefOrList);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(495);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__86: {
        enterOuterAlt(_localctx, 1);
        setState(479);
        fieldRef();
        setState(484);
        _errHandler->sync(this);
        _la = _input->LA(1);
        while (_la == devilangParser::T__71) {
          setState(480);
          match(devilangParser::T__71);
          setState(481);
          fieldRef();
          setState(486);
          _errHandler->sync(this);
          _la = _input->LA(1);
        }
        break;
      }

      case devilangParser::T__5:
      case devilangParser::T__6:
      case devilangParser::T__7:
      case devilangParser::T__8:
      case devilangParser::T__9:
      case devilangParser::T__10:
      case devilangParser::T__11:
      case devilangParser::T__12:
      case devilangParser::T__13:
      case devilangParser::T__14:
      case devilangParser::T__15:
      case devilangParser::T__16:
      case devilangParser::T__17:
      case devilangParser::T__18:
      case devilangParser::T__19:
      case devilangParser::T__20:
      case devilangParser::T__21:
      case devilangParser::T__22:
      case devilangParser::T__23:
      case devilangParser::T__24:
      case devilangParser::T__25:
      case devilangParser::T__26:
      case devilangParser::T__27:
      case devilangParser::T__28:
      case devilangParser::T__29:
      case devilangParser::T__30:
      case devilangParser::T__31:
      case devilangParser::T__32:
      case devilangParser::T__33:
      case devilangParser::T__34:
      case devilangParser::T__35:
      case devilangParser::T__36:
      case devilangParser::T__37:
      case devilangParser::T__38:
      case devilangParser::T__39:
      case devilangParser::T__40:
      case devilangParser::T__41:
      case devilangParser::T__42:
      case devilangParser::T__43:
      case devilangParser::T__44:
      case devilangParser::T__45:
      case devilangParser::T__46:
      case devilangParser::T__47:
      case devilangParser::T__48:
      case devilangParser::T__49:
      case devilangParser::T__50:
      case devilangParser::T__51:
      case devilangParser::T__52:
      case devilangParser::T__53:
      case devilangParser::IDENT: {
        enterOuterAlt(_localctx, 2);
        setState(487);
        ident();
        setState(492);
        _errHandler->sync(this);
        _la = _input->LA(1);
        while (_la == devilangParser::T__71) {
          setState(488);
          match(devilangParser::T__71);
          setState(489);
          ident();
          setState(494);
          _errHandler->sync(this);
          _la = _input->LA(1);
        }
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- RingbufBodyContext ------------------------------------------------------------------

devilangParser::RingbufBodyContext::RingbufBodyContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExprContext* devilangParser::RingbufBodyContext::expr() {
  return getRuleContext<devilangParser::ExprContext>(0);
}

std::vector<devilangParser::RefContext *> devilangParser::RingbufBodyContext::ref() {
  return getRuleContexts<devilangParser::RefContext>();
}

devilangParser::RefContext* devilangParser::RingbufBodyContext::ref(size_t i) {
  return getRuleContext<devilangParser::RefContext>(i);
}

std::vector<tree::TerminalNode *> devilangParser::RingbufBodyContext::INT() {
  return getTokens(devilangParser::INT);
}

tree::TerminalNode* devilangParser::RingbufBodyContext::INT(size_t i) {
  return getToken(devilangParser::INT, i);
}


size_t devilangParser::RingbufBodyContext::getRuleIndex() const {
  return devilangParser::RuleRingbufBody;
}

void devilangParser::RingbufBodyContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterRingbufBody(this);
}

void devilangParser::RingbufBodyContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitRingbufBody(this);
}

devilangParser::RingbufBodyContext* devilangParser::ringbufBody() {
  RingbufBodyContext *_localctx = _tracker.createInstance<RingbufBodyContext>(_ctx, getState());
  enterRule(_localctx, 64, devilangParser::RuleRingbufBody);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(497);
    match(devilangParser::T__11);
    setState(498);
    match(devilangParser::T__66);
    setState(499);
    expr();
    setState(500);
    match(devilangParser::T__4);
    setState(510);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__6: {
        setState(501);
        match(devilangParser::T__6);
        setState(502);
        match(devilangParser::T__66);
        setState(503);
        match(devilangParser::INT);
        setState(504);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__5: {
        setState(505);
        match(devilangParser::T__5);
        setState(506);
        match(devilangParser::T__66);
        setState(507);
        ref();
        setState(508);
        match(devilangParser::T__4);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
    setState(512);
    match(devilangParser::T__7);
    setState(513);
    match(devilangParser::T__66);
    setState(514);
    ref();
    setState(515);
    match(devilangParser::T__4);
    setState(516);
    match(devilangParser::T__8);
    setState(517);
    match(devilangParser::T__66);
    setState(518);
    ref();
    setState(519);
    match(devilangParser::T__4);
    setState(524);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(520);
      match(devilangParser::T__12);
      setState(521);
      match(devilangParser::T__66);
      setState(522);
      match(devilangParser::INT);
      setState(523);
      match(devilangParser::T__4);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadDeclContext ------------------------------------------------------------------

devilangParser::HeadDeclContext::HeadDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::HeadNameContext* devilangParser::HeadDeclContext::headName() {
  return getRuleContext<devilangParser::HeadNameContext>(0);
}

std::vector<devilangParser::HeadFieldContext *> devilangParser::HeadDeclContext::headField() {
  return getRuleContexts<devilangParser::HeadFieldContext>();
}

devilangParser::HeadFieldContext* devilangParser::HeadDeclContext::headField(size_t i) {
  return getRuleContext<devilangParser::HeadFieldContext>(i);
}


size_t devilangParser::HeadDeclContext::getRuleIndex() const {
  return devilangParser::RuleHeadDecl;
}

void devilangParser::HeadDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadDecl(this);
}

void devilangParser::HeadDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadDecl(this);
}

devilangParser::HeadDeclContext* devilangParser::headDecl() {
  HeadDeclContext *_localctx = _tracker.createInstance<HeadDeclContext>(_ctx, getState());
  enterRule(_localctx, 66, devilangParser::RuleHeadDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(526);
    match(devilangParser::T__7);
    setState(528);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || _la == devilangParser::IDENT) {
      setState(527);
      headName();
    }
    setState(530);
    match(devilangParser::T__1);
    setState(534);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__16))) != 0)) {
      setState(531);
      headField();
      setState(536);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(537);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadNameContext ------------------------------------------------------------------

devilangParser::HeadNameContext::HeadNameContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::HeadNameContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::HeadNameContext::getRuleIndex() const {
  return devilangParser::RuleHeadName;
}

void devilangParser::HeadNameContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadName(this);
}

void devilangParser::HeadNameContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadName(this);
}

devilangParser::HeadNameContext* devilangParser::headName() {
  HeadNameContext *_localctx = _tracker.createInstance<HeadNameContext>(_ctx, getState());
  enterRule(_localctx, 68, devilangParser::RuleHeadName);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(539);
    ident();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadFieldContext ------------------------------------------------------------------

devilangParser::HeadFieldContext::HeadFieldContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::HeadPositionContext* devilangParser::HeadFieldContext::headPosition() {
  return getRuleContext<devilangParser::HeadPositionContext>(0);
}

devilangParser::SpaceTypeListContext* devilangParser::HeadFieldContext::spaceTypeList() {
  return getRuleContext<devilangParser::SpaceTypeListContext>(0);
}

tree::TerminalNode* devilangParser::HeadFieldContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::HeadFieldContext::getRuleIndex() const {
  return devilangParser::RuleHeadField;
}

void devilangParser::HeadFieldContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadField(this);
}

void devilangParser::HeadFieldContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadField(this);
}

devilangParser::HeadFieldContext* devilangParser::headField() {
  HeadFieldContext *_localctx = _tracker.createInstance<HeadFieldContext>(_ctx, getState());
  enterRule(_localctx, 70, devilangParser::RuleHeadField);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(553);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__16: {
        enterOuterAlt(_localctx, 1);
        setState(541);
        match(devilangParser::T__16);
        setState(542);
        match(devilangParser::T__66);
        setState(543);
        headPosition();
        break;
      }

      case devilangParser::T__14: {
        enterOuterAlt(_localctx, 2);
        setState(544);
        match(devilangParser::T__14);
        setState(545);
        match(devilangParser::T__66);
        setState(546);
        spaceTypeList();
        setState(547);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__12: {
        enterOuterAlt(_localctx, 3);
        setState(549);
        match(devilangParser::T__12);
        setState(550);
        match(devilangParser::T__66);
        setState(551);
        match(devilangParser::INT);
        setState(552);
        match(devilangParser::T__4);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadPositionContext ------------------------------------------------------------------

devilangParser::HeadPositionContext::HeadPositionContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::HeadLocationContext *> devilangParser::HeadPositionContext::headLocation() {
  return getRuleContexts<devilangParser::HeadLocationContext>();
}

devilangParser::HeadLocationContext* devilangParser::HeadPositionContext::headLocation(size_t i) {
  return getRuleContext<devilangParser::HeadLocationContext>(i);
}


size_t devilangParser::HeadPositionContext::getRuleIndex() const {
  return devilangParser::RuleHeadPosition;
}

void devilangParser::HeadPositionContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadPosition(this);
}

void devilangParser::HeadPositionContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadPosition(this);
}

devilangParser::HeadPositionContext* devilangParser::headPosition() {
  HeadPositionContext *_localctx = _tracker.createInstance<HeadPositionContext>(_ctx, getState());
  enterRule(_localctx, 72, devilangParser::RuleHeadPosition);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(555);
    headLocation();
    setState(560);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__71) {
      setState(556);
      match(devilangParser::T__71);
      setState(557);
      headLocation();
      setState(562);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadLocationContext ------------------------------------------------------------------

devilangParser::HeadLocationContext::HeadLocationContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::HeadKeyValueContext *> devilangParser::HeadLocationContext::headKeyValue() {
  return getRuleContexts<devilangParser::HeadKeyValueContext>();
}

devilangParser::HeadKeyValueContext* devilangParser::HeadLocationContext::headKeyValue(size_t i) {
  return getRuleContext<devilangParser::HeadKeyValueContext>(i);
}

std::vector<devilangParser::HeadAtomContext *> devilangParser::HeadLocationContext::headAtom() {
  return getRuleContexts<devilangParser::HeadAtomContext>();
}

devilangParser::HeadAtomContext* devilangParser::HeadLocationContext::headAtom(size_t i) {
  return getRuleContext<devilangParser::HeadAtomContext>(i);
}


size_t devilangParser::HeadLocationContext::getRuleIndex() const {
  return devilangParser::RuleHeadLocation;
}

void devilangParser::HeadLocationContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadLocation(this);
}

void devilangParser::HeadLocationContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadLocation(this);
}

devilangParser::HeadLocationContext* devilangParser::headLocation() {
  HeadLocationContext *_localctx = _tracker.createInstance<HeadLocationContext>(_ctx, getState());
  enterRule(_localctx, 74, devilangParser::RuleHeadLocation);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    size_t alt;
    enterOuterAlt(_localctx, 1);
    setState(563);
    match(devilangParser::T__62);
    setState(583);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 44, _ctx)) {
    case 1: {
      setState(564);
      headKeyValue();
      setState(569);
      _errHandler->sync(this);
      alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 41, _ctx);
      while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER) {
        if (alt == 1) {
          setState(565);
          match(devilangParser::T__4);
          setState(566);
          headKeyValue(); 
        }
        setState(571);
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 41, _ctx);
      }
      setState(573);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if (_la == devilangParser::T__4) {
        setState(572);
        match(devilangParser::T__4);
      }
      break;
    }

    case 2: {
      setState(575);
      headAtom();
      setState(580);
      _errHandler->sync(this);
      _la = _input->LA(1);
      while (_la == devilangParser::T__67) {
        setState(576);
        match(devilangParser::T__67);
        setState(577);
        headAtom();
        setState(582);
        _errHandler->sync(this);
        _la = _input->LA(1);
      }
      break;
    }

    default:
      break;
    }
    setState(585);
    match(devilangParser::T__63);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadKeyValueContext ------------------------------------------------------------------

devilangParser::HeadKeyValueContext::HeadKeyValueContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::HeadKeyValueContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}

devilangParser::FileNameContext* devilangParser::HeadKeyValueContext::fileName() {
  return getRuleContext<devilangParser::FileNameContext>(0);
}

tree::TerminalNode* devilangParser::HeadKeyValueContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::HeadKeyValueContext::getRuleIndex() const {
  return devilangParser::RuleHeadKeyValue;
}

void devilangParser::HeadKeyValueContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadKeyValue(this);
}

void devilangParser::HeadKeyValueContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadKeyValue(this);
}

devilangParser::HeadKeyValueContext* devilangParser::headKeyValue() {
  HeadKeyValueContext *_localctx = _tracker.createInstance<HeadKeyValueContext>(_ctx, getState());
  enterRule(_localctx, 76, devilangParser::RuleHeadKeyValue);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(620);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__76: {
        enterOuterAlt(_localctx, 1);
        setState(587);
        match(devilangParser::T__76);
        setState(588);
        match(devilangParser::T__66);
        setState(589);
        qualifiedName();
        break;
      }

      case devilangParser::T__77: {
        enterOuterAlt(_localctx, 2);
        setState(590);
        match(devilangParser::T__77);
        setState(591);
        match(devilangParser::T__66);
        setState(592);
        fileName();
        break;
      }

      case devilangParser::T__78: {
        enterOuterAlt(_localctx, 3);
        setState(593);
        match(devilangParser::T__78);
        setState(594);
        match(devilangParser::T__66);
        setState(595);
        fileName();
        break;
      }

      case devilangParser::T__37: {
        enterOuterAlt(_localctx, 4);
        setState(596);
        match(devilangParser::T__37);
        setState(597);
        match(devilangParser::T__66);
        setState(598);
        qualifiedName();
        break;
      }

      case devilangParser::T__79: {
        enterOuterAlt(_localctx, 5);
        setState(599);
        match(devilangParser::T__79);
        setState(600);
        match(devilangParser::T__66);
        setState(601);
        qualifiedName();
        break;
      }

      case devilangParser::T__80: {
        enterOuterAlt(_localctx, 6);
        setState(602);
        match(devilangParser::T__80);
        setState(603);
        match(devilangParser::T__66);
        setState(604);
        qualifiedName();
        break;
      }

      case devilangParser::T__81: {
        enterOuterAlt(_localctx, 7);
        setState(605);
        match(devilangParser::T__81);
        setState(606);
        match(devilangParser::T__66);
        setState(607);
        qualifiedName();
        break;
      }

      case devilangParser::T__82: {
        enterOuterAlt(_localctx, 8);
        setState(608);
        match(devilangParser::T__82);
        setState(609);
        match(devilangParser::T__66);
        setState(610);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__83: {
        enterOuterAlt(_localctx, 9);
        setState(611);
        match(devilangParser::T__83);
        setState(612);
        match(devilangParser::T__66);
        setState(613);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__32: {
        enterOuterAlt(_localctx, 10);
        setState(614);
        match(devilangParser::T__32);
        setState(615);
        match(devilangParser::T__66);
        setState(616);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__84: {
        enterOuterAlt(_localctx, 11);
        setState(617);
        match(devilangParser::T__84);
        setState(618);
        match(devilangParser::T__66);
        setState(619);
        match(devilangParser::INT);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- HeadAtomContext ------------------------------------------------------------------

devilangParser::HeadAtomContext::HeadAtomContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::HeadAtomContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}

tree::TerminalNode* devilangParser::HeadAtomContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::HeadAtomContext::getRuleIndex() const {
  return devilangParser::RuleHeadAtom;
}

void devilangParser::HeadAtomContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterHeadAtom(this);
}

void devilangParser::HeadAtomContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitHeadAtom(this);
}

devilangParser::HeadAtomContext* devilangParser::headAtom() {
  HeadAtomContext *_localctx = _tracker.createInstance<HeadAtomContext>(_ctx, getState());
  enterRule(_localctx, 78, devilangParser::RuleHeadAtom);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(624);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__5:
      case devilangParser::T__6:
      case devilangParser::T__7:
      case devilangParser::T__8:
      case devilangParser::T__9:
      case devilangParser::T__10:
      case devilangParser::T__11:
      case devilangParser::T__12:
      case devilangParser::T__13:
      case devilangParser::T__14:
      case devilangParser::T__15:
      case devilangParser::T__16:
      case devilangParser::T__17:
      case devilangParser::T__18:
      case devilangParser::T__19:
      case devilangParser::T__20:
      case devilangParser::T__21:
      case devilangParser::T__22:
      case devilangParser::T__23:
      case devilangParser::T__24:
      case devilangParser::T__25:
      case devilangParser::T__26:
      case devilangParser::T__27:
      case devilangParser::T__28:
      case devilangParser::T__29:
      case devilangParser::T__30:
      case devilangParser::T__31:
      case devilangParser::T__32:
      case devilangParser::T__33:
      case devilangParser::T__34:
      case devilangParser::T__35:
      case devilangParser::T__36:
      case devilangParser::T__37:
      case devilangParser::T__38:
      case devilangParser::T__39:
      case devilangParser::T__40:
      case devilangParser::T__41:
      case devilangParser::T__42:
      case devilangParser::T__43:
      case devilangParser::T__44:
      case devilangParser::T__45:
      case devilangParser::T__46:
      case devilangParser::T__47:
      case devilangParser::T__48:
      case devilangParser::T__49:
      case devilangParser::T__50:
      case devilangParser::T__51:
      case devilangParser::T__52:
      case devilangParser::T__53:
      case devilangParser::IDENT: {
        enterOuterAlt(_localctx, 1);
        setState(622);
        qualifiedName();
        break;
      }

      case devilangParser::INT: {
        enterOuterAlt(_localctx, 2);
        setState(623);
        match(devilangParser::INT);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ActionDeclContext ------------------------------------------------------------------

devilangParser::ActionDeclContext::ActionDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::ActionDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::ActionDeclContext::getRuleIndex() const {
  return devilangParser::RuleActionDecl;
}

void devilangParser::ActionDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterActionDecl(this);
}

void devilangParser::ActionDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitActionDecl(this);
}

devilangParser::ActionDeclContext* devilangParser::actionDecl() {
  ActionDeclContext *_localctx = _tracker.createInstance<ActionDeclContext>(_ctx, getState());
  enterRule(_localctx, 80, devilangParser::RuleActionDecl);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(626);
    match(devilangParser::T__85);
    setState(627);
    ident();
    setState(628);
    match(devilangParser::T__1);
    setState(629);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpDeclContext ------------------------------------------------------------------

devilangParser::OpDeclContext::OpDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::OpDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}

devilangParser::OpBodyContext* devilangParser::OpDeclContext::opBody() {
  return getRuleContext<devilangParser::OpBodyContext>(0);
}


size_t devilangParser::OpDeclContext::getRuleIndex() const {
  return devilangParser::RuleOpDecl;
}

void devilangParser::OpDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpDecl(this);
}

void devilangParser::OpDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpDecl(this);
}

devilangParser::OpDeclContext* devilangParser::opDecl() {
  OpDeclContext *_localctx = _tracker.createInstance<OpDeclContext>(_ctx, getState());
  enterRule(_localctx, 82, devilangParser::RuleOpDecl);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(631);
    match(devilangParser::T__34);
    setState(632);
    ident();
    setState(633);
    match(devilangParser::T__1);
    setState(634);
    opBody();
    setState(635);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpBodyContext ------------------------------------------------------------------

devilangParser::OpBodyContext::OpBodyContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::CallOpContext* devilangParser::OpBodyContext::callOp() {
  return getRuleContext<devilangParser::CallOpContext>(0);
}

devilangParser::MmioOpDeclContext* devilangParser::OpBodyContext::mmioOpDecl() {
  return getRuleContext<devilangParser::MmioOpDeclContext>(0);
}


size_t devilangParser::OpBodyContext::getRuleIndex() const {
  return devilangParser::RuleOpBody;
}

void devilangParser::OpBodyContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpBody(this);
}

void devilangParser::OpBodyContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpBody(this);
}

devilangParser::OpBodyContext* devilangParser::opBody() {
  OpBodyContext *_localctx = _tracker.createInstance<OpBodyContext>(_ctx, getState());
  enterRule(_localctx, 84, devilangParser::RuleOpBody);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(639);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__33: {
        enterOuterAlt(_localctx, 1);
        setState(637);
        callOp();
        break;
      }

      case devilangParser::T__38: {
        enterOuterAlt(_localctx, 2);
        setState(638);
        mmioOpDecl();
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- CallOpContext ------------------------------------------------------------------

devilangParser::CallOpContext::CallOpContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::CallOpContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}


size_t devilangParser::CallOpContext::getRuleIndex() const {
  return devilangParser::RuleCallOp;
}

void devilangParser::CallOpContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterCallOp(this);
}

void devilangParser::CallOpContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitCallOp(this);
}

devilangParser::CallOpContext* devilangParser::callOp() {
  CallOpContext *_localctx = _tracker.createInstance<CallOpContext>(_ctx, getState());
  enterRule(_localctx, 86, devilangParser::RuleCallOp);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(641);
    match(devilangParser::T__33);
    setState(642);
    extendedName();
    setState(643);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- MmioOpDeclContext ------------------------------------------------------------------

devilangParser::MmioOpDeclContext::MmioOpDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::MmioOpDeclContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}

std::vector<devilangParser::MmioFieldContext *> devilangParser::MmioOpDeclContext::mmioField() {
  return getRuleContexts<devilangParser::MmioFieldContext>();
}

devilangParser::MmioFieldContext* devilangParser::MmioOpDeclContext::mmioField(size_t i) {
  return getRuleContext<devilangParser::MmioFieldContext>(i);
}


size_t devilangParser::MmioOpDeclContext::getRuleIndex() const {
  return devilangParser::RuleMmioOpDecl;
}

void devilangParser::MmioOpDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterMmioOpDecl(this);
}

void devilangParser::MmioOpDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitMmioOpDecl(this);
}

devilangParser::MmioOpDeclContext* devilangParser::mmioOpDecl() {
  MmioOpDeclContext *_localctx = _tracker.createInstance<MmioOpDeclContext>(_ctx, getState());
  enterRule(_localctx, 88, devilangParser::RuleMmioOpDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(645);
    match(devilangParser::T__38);
    setState(646);
    extendedName();
    setState(647);
    match(devilangParser::T__1);
    setState(651);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41))) != 0)) {
      setState(648);
      mmioField();
      setState(653);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(654);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ExtendedNameContext ------------------------------------------------------------------

devilangParser::ExtendedNameContext::ExtendedNameContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::IdentContext *> devilangParser::ExtendedNameContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::ExtendedNameContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}

std::vector<tree::TerminalNode *> devilangParser::ExtendedNameContext::INT() {
  return getTokens(devilangParser::INT);
}

tree::TerminalNode* devilangParser::ExtendedNameContext::INT(size_t i) {
  return getToken(devilangParser::INT, i);
}


size_t devilangParser::ExtendedNameContext::getRuleIndex() const {
  return devilangParser::RuleExtendedName;
}

void devilangParser::ExtendedNameContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterExtendedName(this);
}

void devilangParser::ExtendedNameContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitExtendedName(this);
}

devilangParser::ExtendedNameContext* devilangParser::extendedName() {
  ExtendedNameContext *_localctx = _tracker.createInstance<ExtendedNameContext>(_ctx, getState());
  enterRule(_localctx, 90, devilangParser::RuleExtendedName);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    size_t alt;
    enterOuterAlt(_localctx, 1);
    setState(656);
    ident();
    setState(666);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__86) {
      setState(657);
      match(devilangParser::T__86);
      setState(660); 
      _errHandler->sync(this);
      alt = 1;
      do {
        switch (alt) {
          case 1: {
                setState(660);
                _errHandler->sync(this);
                switch (_input->LA(1)) {
                  case devilangParser::T__5:
                  case devilangParser::T__6:
                  case devilangParser::T__7:
                  case devilangParser::T__8:
                  case devilangParser::T__9:
                  case devilangParser::T__10:
                  case devilangParser::T__11:
                  case devilangParser::T__12:
                  case devilangParser::T__13:
                  case devilangParser::T__14:
                  case devilangParser::T__15:
                  case devilangParser::T__16:
                  case devilangParser::T__17:
                  case devilangParser::T__18:
                  case devilangParser::T__19:
                  case devilangParser::T__20:
                  case devilangParser::T__21:
                  case devilangParser::T__22:
                  case devilangParser::T__23:
                  case devilangParser::T__24:
                  case devilangParser::T__25:
                  case devilangParser::T__26:
                  case devilangParser::T__27:
                  case devilangParser::T__28:
                  case devilangParser::T__29:
                  case devilangParser::T__30:
                  case devilangParser::T__31:
                  case devilangParser::T__32:
                  case devilangParser::T__33:
                  case devilangParser::T__34:
                  case devilangParser::T__35:
                  case devilangParser::T__36:
                  case devilangParser::T__37:
                  case devilangParser::T__38:
                  case devilangParser::T__39:
                  case devilangParser::T__40:
                  case devilangParser::T__41:
                  case devilangParser::T__42:
                  case devilangParser::T__43:
                  case devilangParser::T__44:
                  case devilangParser::T__45:
                  case devilangParser::T__46:
                  case devilangParser::T__47:
                  case devilangParser::T__48:
                  case devilangParser::T__49:
                  case devilangParser::T__50:
                  case devilangParser::T__51:
                  case devilangParser::T__52:
                  case devilangParser::T__53:
                  case devilangParser::IDENT: {
                    setState(658);
                    ident();
                    break;
                  }

                  case devilangParser::INT: {
                    setState(659);
                    match(devilangParser::INT);
                    break;
                  }

                default:
                  throw NoViableAltException(this);
                }
                break;
              }

        default:
          throw NoViableAltException(this);
        }
        setState(662); 
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 50, _ctx);
      } while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER);
      setState(668);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- MmioFieldContext ------------------------------------------------------------------

devilangParser::MmioFieldContext::MmioFieldContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::MmioDirContext* devilangParser::MmioFieldContext::mmioDir() {
  return getRuleContext<devilangParser::MmioDirContext>(0);
}

tree::TerminalNode* devilangParser::MmioFieldContext::INT() {
  return getToken(devilangParser::INT, 0);
}

devilangParser::OpExprContext* devilangParser::MmioFieldContext::opExpr() {
  return getRuleContext<devilangParser::OpExprContext>(0);
}


size_t devilangParser::MmioFieldContext::getRuleIndex() const {
  return devilangParser::RuleMmioField;
}

void devilangParser::MmioFieldContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterMmioField(this);
}

void devilangParser::MmioFieldContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitMmioField(this);
}

devilangParser::MmioFieldContext* devilangParser::mmioField() {
  MmioFieldContext *_localctx = _tracker.createInstance<MmioFieldContext>(_ctx, getState());
  enterRule(_localctx, 92, devilangParser::RuleMmioField);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(692);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__39: {
        enterOuterAlt(_localctx, 1);
        setState(669);
        match(devilangParser::T__39);
        setState(670);
        match(devilangParser::T__66);
        setState(671);
        mmioDir();
        setState(672);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__40: {
        enterOuterAlt(_localctx, 2);
        setState(674);
        match(devilangParser::T__40);
        setState(675);
        match(devilangParser::T__66);
        setState(676);
        match(devilangParser::INT);
        setState(677);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__41: {
        enterOuterAlt(_localctx, 3);
        setState(678);
        match(devilangParser::T__41);
        setState(679);
        match(devilangParser::T__66);
        setState(680);
        opExpr();
        setState(681);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__6: {
        enterOuterAlt(_localctx, 4);
        setState(683);
        match(devilangParser::T__6);
        setState(684);
        match(devilangParser::T__66);
        setState(685);
        match(devilangParser::INT);
        setState(686);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__22: {
        enterOuterAlt(_localctx, 5);
        setState(687);
        match(devilangParser::T__22);
        setState(688);
        match(devilangParser::T__66);
        setState(689);
        opExpr();
        setState(690);
        match(devilangParser::T__4);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- MmioDirContext ------------------------------------------------------------------

devilangParser::MmioDirContext::MmioDirContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::MmioDirContext::getRuleIndex() const {
  return devilangParser::RuleMmioDir;
}

void devilangParser::MmioDirContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterMmioDir(this);
}

void devilangParser::MmioDirContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitMmioDir(this);
}

devilangParser::MmioDirContext* devilangParser::mmioDir() {
  MmioDirContext *_localctx = _tracker.createInstance<MmioDirContext>(_ctx, getState());
  enterRule(_localctx, 94, devilangParser::RuleMmioDir);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(694);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__87

    || _la == devilangParser::T__88)) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopBbDeclContext ------------------------------------------------------------------

devilangParser::TopBbDeclContext::TopBbDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::TopBbDeclContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}

std::vector<devilangParser::TopBbItemContext *> devilangParser::TopBbDeclContext::topBbItem() {
  return getRuleContexts<devilangParser::TopBbItemContext>();
}

devilangParser::TopBbItemContext* devilangParser::TopBbDeclContext::topBbItem(size_t i) {
  return getRuleContext<devilangParser::TopBbItemContext>(i);
}


size_t devilangParser::TopBbDeclContext::getRuleIndex() const {
  return devilangParser::RuleTopBbDecl;
}

void devilangParser::TopBbDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopBbDecl(this);
}

void devilangParser::TopBbDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopBbDecl(this);
}

devilangParser::TopBbDeclContext* devilangParser::topBbDecl() {
  TopBbDeclContext *_localctx = _tracker.createInstance<TopBbDeclContext>(_ctx, getState());
  enterRule(_localctx, 96, devilangParser::RuleTopBbDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(696);
    match(devilangParser::T__35);
    setState(697);
    extendedName();
    setState(698);
    match(devilangParser::T__1);
    setState(700); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(699);
      topBbItem();
      setState(702); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (_la == devilangParser::T__34);
    setState(704);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopBbItemContext ------------------------------------------------------------------

devilangParser::TopBbItemContext::TopBbItemContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::TopBbItemContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}


size_t devilangParser::TopBbItemContext::getRuleIndex() const {
  return devilangParser::RuleTopBbItem;
}

void devilangParser::TopBbItemContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopBbItem(this);
}

void devilangParser::TopBbItemContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopBbItem(this);
}

devilangParser::TopBbItemContext* devilangParser::topBbItem() {
  TopBbItemContext *_localctx = _tracker.createInstance<TopBbItemContext>(_ctx, getState());
  enterRule(_localctx, 98, devilangParser::RuleTopBbItem);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(706);
    match(devilangParser::T__34);
    setState(707);
    extendedName();
    setState(708);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopPathDeclContext ------------------------------------------------------------------

devilangParser::TopPathDeclContext::TopPathDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::TopPathDeclContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}

std::vector<devilangParser::TopPathItemContext *> devilangParser::TopPathDeclContext::topPathItem() {
  return getRuleContexts<devilangParser::TopPathItemContext>();
}

devilangParser::TopPathItemContext* devilangParser::TopPathDeclContext::topPathItem(size_t i) {
  return getRuleContext<devilangParser::TopPathItemContext>(i);
}


size_t devilangParser::TopPathDeclContext::getRuleIndex() const {
  return devilangParser::RuleTopPathDecl;
}

void devilangParser::TopPathDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopPathDecl(this);
}

void devilangParser::TopPathDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopPathDecl(this);
}

devilangParser::TopPathDeclContext* devilangParser::topPathDecl() {
  TopPathDeclContext *_localctx = _tracker.createInstance<TopPathDeclContext>(_ctx, getState());
  enterRule(_localctx, 100, devilangParser::RuleTopPathDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(710);
    match(devilangParser::T__36);
    setState(711);
    extendedName();
    setState(712);
    match(devilangParser::T__1);
    setState(714); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(713);
      topPathItem();
      setState(716); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (_la == devilangParser::T__35);
    setState(718);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopPathItemContext ------------------------------------------------------------------

devilangParser::TopPathItemContext::TopPathItemContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::TopPathItemContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}


size_t devilangParser::TopPathItemContext::getRuleIndex() const {
  return devilangParser::RuleTopPathItem;
}

void devilangParser::TopPathItemContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopPathItem(this);
}

void devilangParser::TopPathItemContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopPathItem(this);
}

devilangParser::TopPathItemContext* devilangParser::topPathItem() {
  TopPathItemContext *_localctx = _tracker.createInstance<TopPathItemContext>(_ctx, getState());
  enterRule(_localctx, 102, devilangParser::RuleTopPathItem);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(720);
    match(devilangParser::T__35);
    setState(721);
    extendedName();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopFuncDeclContext ------------------------------------------------------------------

devilangParser::TopFuncDeclContext::TopFuncDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::TopFuncDeclContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}

std::vector<devilangParser::TopFuncItemContext *> devilangParser::TopFuncDeclContext::topFuncItem() {
  return getRuleContexts<devilangParser::TopFuncItemContext>();
}

devilangParser::TopFuncItemContext* devilangParser::TopFuncDeclContext::topFuncItem(size_t i) {
  return getRuleContext<devilangParser::TopFuncItemContext>(i);
}


size_t devilangParser::TopFuncDeclContext::getRuleIndex() const {
  return devilangParser::RuleTopFuncDecl;
}

void devilangParser::TopFuncDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopFuncDecl(this);
}

void devilangParser::TopFuncDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopFuncDecl(this);
}

devilangParser::TopFuncDeclContext* devilangParser::topFuncDecl() {
  TopFuncDeclContext *_localctx = _tracker.createInstance<TopFuncDeclContext>(_ctx, getState());
  enterRule(_localctx, 104, devilangParser::RuleTopFuncDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(723);
    match(devilangParser::T__37);
    setState(724);
    extendedName();
    setState(725);
    match(devilangParser::T__1);
    setState(727); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(726);
      topFuncItem();
      setState(729); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (_la == devilangParser::T__36);
    setState(731);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TopFuncItemContext ------------------------------------------------------------------

devilangParser::TopFuncItemContext::TopFuncItemContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::TopFuncItemContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}


size_t devilangParser::TopFuncItemContext::getRuleIndex() const {
  return devilangParser::RuleTopFuncItem;
}

void devilangParser::TopFuncItemContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTopFuncItem(this);
}

void devilangParser::TopFuncItemContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTopFuncItem(this);
}

devilangParser::TopFuncItemContext* devilangParser::topFuncItem() {
  TopFuncItemContext *_localctx = _tracker.createInstance<TopFuncItemContext>(_ctx, getState());
  enterRule(_localctx, 106, devilangParser::RuleTopFuncItem);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(733);
    match(devilangParser::T__36);
    setState(734);
    extendedName();
    setState(735);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- StateDeclContext ------------------------------------------------------------------

devilangParser::StateDeclContext::StateDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::StateDeclContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}

std::vector<devilangParser::StateStmtContext *> devilangParser::StateDeclContext::stateStmt() {
  return getRuleContexts<devilangParser::StateStmtContext>();
}

devilangParser::StateStmtContext* devilangParser::StateDeclContext::stateStmt(size_t i) {
  return getRuleContext<devilangParser::StateStmtContext>(i);
}


size_t devilangParser::StateDeclContext::getRuleIndex() const {
  return devilangParser::RuleStateDecl;
}

void devilangParser::StateDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterStateDecl(this);
}

void devilangParser::StateDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitStateDecl(this);
}

devilangParser::StateDeclContext* devilangParser::stateDecl() {
  StateDeclContext *_localctx = _tracker.createInstance<StateDeclContext>(_ctx, getState());
  enterRule(_localctx, 108, devilangParser::RuleStateDecl);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(737);
    match(devilangParser::T__50);
    setState(738);
    extendedName();
    setState(739);
    match(devilangParser::T__1);
    setState(741); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(740);
      stateStmt();
      setState(743); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52))) != 0) || ((((_la - 90) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 90)) & ((1ULL << (devilangParser::T__89 - 90))
      | (1ULL << (devilangParser::T__90 - 90))
      | (1ULL << (devilangParser::T__91 - 90))
      | (1ULL << (devilangParser::T__92 - 90))
      | (1ULL << (devilangParser::T__93 - 90))
      | (1ULL << (devilangParser::T__94 - 90))
      | (1ULL << (devilangParser::T__95 - 90))
      | (1ULL << (devilangParser::T__96 - 90))
      | (1ULL << (devilangParser::T__99 - 90)))) != 0));
    setState(745);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- StateStmtContext ------------------------------------------------------------------

devilangParser::StateStmtContext::StateStmtContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::StateBlockContext* devilangParser::StateStmtContext::stateBlock() {
  return getRuleContext<devilangParser::StateBlockContext>(0);
}

devilangParser::StateStepContext* devilangParser::StateStmtContext::stateStep() {
  return getRuleContext<devilangParser::StateStepContext>(0);
}


size_t devilangParser::StateStmtContext::getRuleIndex() const {
  return devilangParser::RuleStateStmt;
}

void devilangParser::StateStmtContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterStateStmt(this);
}

void devilangParser::StateStmtContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitStateStmt(this);
}

devilangParser::StateStmtContext* devilangParser::stateStmt() {
  StateStmtContext *_localctx = _tracker.createInstance<StateStmtContext>(_ctx, getState());
  enterRule(_localctx, 110, devilangParser::RuleStateStmt);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(749);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__51:
      case devilangParser::T__52: {
        enterOuterAlt(_localctx, 1);
        setState(747);
        stateBlock();
        break;
      }

      case devilangParser::T__33:
      case devilangParser::T__89:
      case devilangParser::T__90:
      case devilangParser::T__91:
      case devilangParser::T__92:
      case devilangParser::T__93:
      case devilangParser::T__94:
      case devilangParser::T__95:
      case devilangParser::T__96:
      case devilangParser::T__99: {
        enterOuterAlt(_localctx, 2);
        setState(748);
        stateStep();
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- StateBlockContext ------------------------------------------------------------------

devilangParser::StateBlockContext::StateBlockContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::StateStmtContext *> devilangParser::StateBlockContext::stateStmt() {
  return getRuleContexts<devilangParser::StateStmtContext>();
}

devilangParser::StateStmtContext* devilangParser::StateBlockContext::stateStmt(size_t i) {
  return getRuleContext<devilangParser::StateStmtContext>(i);
}


size_t devilangParser::StateBlockContext::getRuleIndex() const {
  return devilangParser::RuleStateBlock;
}

void devilangParser::StateBlockContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterStateBlock(this);
}

void devilangParser::StateBlockContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitStateBlock(this);
}

devilangParser::StateBlockContext* devilangParser::stateBlock() {
  StateBlockContext *_localctx = _tracker.createInstance<StateBlockContext>(_ctx, getState());
  enterRule(_localctx, 112, devilangParser::RuleStateBlock);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(769);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__51: {
        enterOuterAlt(_localctx, 1);
        setState(751);
        match(devilangParser::T__51);
        setState(752);
        match(devilangParser::T__1);
        setState(756);
        _errHandler->sync(this);
        _la = _input->LA(1);
        while ((((_la & ~ 0x3fULL) == 0) &&
          ((1ULL << _la) & ((1ULL << devilangParser::T__33)
          | (1ULL << devilangParser::T__51)
          | (1ULL << devilangParser::T__52))) != 0) || ((((_la - 90) & ~ 0x3fULL) == 0) &&
          ((1ULL << (_la - 90)) & ((1ULL << (devilangParser::T__89 - 90))
          | (1ULL << (devilangParser::T__90 - 90))
          | (1ULL << (devilangParser::T__91 - 90))
          | (1ULL << (devilangParser::T__92 - 90))
          | (1ULL << (devilangParser::T__93 - 90))
          | (1ULL << (devilangParser::T__94 - 90))
          | (1ULL << (devilangParser::T__95 - 90))
          | (1ULL << (devilangParser::T__96 - 90))
          | (1ULL << (devilangParser::T__99 - 90)))) != 0)) {
          setState(753);
          stateStmt();
          setState(758);
          _errHandler->sync(this);
          _la = _input->LA(1);
        }
        setState(759);
        match(devilangParser::T__2);
        break;
      }

      case devilangParser::T__52: {
        enterOuterAlt(_localctx, 2);
        setState(760);
        match(devilangParser::T__52);
        setState(761);
        match(devilangParser::T__1);
        setState(765);
        _errHandler->sync(this);
        _la = _input->LA(1);
        while ((((_la & ~ 0x3fULL) == 0) &&
          ((1ULL << _la) & ((1ULL << devilangParser::T__33)
          | (1ULL << devilangParser::T__51)
          | (1ULL << devilangParser::T__52))) != 0) || ((((_la - 90) & ~ 0x3fULL) == 0) &&
          ((1ULL << (_la - 90)) & ((1ULL << (devilangParser::T__89 - 90))
          | (1ULL << (devilangParser::T__90 - 90))
          | (1ULL << (devilangParser::T__91 - 90))
          | (1ULL << (devilangParser::T__92 - 90))
          | (1ULL << (devilangParser::T__93 - 90))
          | (1ULL << (devilangParser::T__94 - 90))
          | (1ULL << (devilangParser::T__95 - 90))
          | (1ULL << (devilangParser::T__96 - 90))
          | (1ULL << (devilangParser::T__99 - 90)))) != 0)) {
          setState(762);
          stateStmt();
          setState(767);
          _errHandler->sync(this);
          _la = _input->LA(1);
        }
        setState(768);
        match(devilangParser::T__2);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- StateStepContext ------------------------------------------------------------------

devilangParser::StateStepContext::StateStepContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IoStateStepContext* devilangParser::StateStepContext::ioStateStep() {
  return getRuleContext<devilangParser::IoStateStepContext>(0);
}

devilangParser::StateTerminatorContext* devilangParser::StateStepContext::stateTerminator() {
  return getRuleContext<devilangParser::StateTerminatorContext>(0);
}

devilangParser::CallStateStepContext* devilangParser::StateStepContext::callStateStep() {
  return getRuleContext<devilangParser::CallStateStepContext>(0);
}

devilangParser::EllipsisStateStepContext* devilangParser::StateStepContext::ellipsisStateStep() {
  return getRuleContext<devilangParser::EllipsisStateStepContext>(0);
}


size_t devilangParser::StateStepContext::getRuleIndex() const {
  return devilangParser::RuleStateStep;
}

void devilangParser::StateStepContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterStateStep(this);
}

void devilangParser::StateStepContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitStateStep(this);
}

devilangParser::StateStepContext* devilangParser::stateStep() {
  StateStepContext *_localctx = _tracker.createInstance<StateStepContext>(_ctx, getState());
  enterRule(_localctx, 114, devilangParser::RuleStateStep);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(783);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__89:
      case devilangParser::T__90:
      case devilangParser::T__91:
      case devilangParser::T__92:
      case devilangParser::T__93:
      case devilangParser::T__94:
      case devilangParser::T__95:
      case devilangParser::T__96: {
        enterOuterAlt(_localctx, 1);
        setState(771);
        ioStateStep();
        setState(773);
        _errHandler->sync(this);

        _la = _input->LA(1);
        if (_la == devilangParser::T__4) {
          setState(772);
          stateTerminator();
        }
        break;
      }

      case devilangParser::T__33: {
        enterOuterAlt(_localctx, 2);
        setState(775);
        callStateStep();
        setState(777);
        _errHandler->sync(this);

        _la = _input->LA(1);
        if (_la == devilangParser::T__4) {
          setState(776);
          stateTerminator();
        }
        break;
      }

      case devilangParser::T__99: {
        enterOuterAlt(_localctx, 3);
        setState(779);
        ellipsisStateStep();
        setState(781);
        _errHandler->sync(this);

        _la = _input->LA(1);
        if (_la == devilangParser::T__4) {
          setState(780);
          stateTerminator();
        }
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- StateTerminatorContext ------------------------------------------------------------------

devilangParser::StateTerminatorContext::StateTerminatorContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::StateTerminatorContext::getRuleIndex() const {
  return devilangParser::RuleStateTerminator;
}

void devilangParser::StateTerminatorContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterStateTerminator(this);
}

void devilangParser::StateTerminatorContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitStateTerminator(this);
}

devilangParser::StateTerminatorContext* devilangParser::stateTerminator() {
  StateTerminatorContext *_localctx = _tracker.createInstance<StateTerminatorContext>(_ctx, getState());
  enterRule(_localctx, 116, devilangParser::RuleStateTerminator);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(785);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- IoStateStepContext ------------------------------------------------------------------

devilangParser::IoStateStepContext::IoStateStepContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IoVerbContext* devilangParser::IoStateStepContext::ioVerb() {
  return getRuleContext<devilangParser::IoVerbContext>(0);
}

devilangParser::OpExprContext* devilangParser::IoStateStepContext::opExpr() {
  return getRuleContext<devilangParser::OpExprContext>(0);
}

devilangParser::IoValueContext* devilangParser::IoStateStepContext::ioValue() {
  return getRuleContext<devilangParser::IoValueContext>(0);
}


size_t devilangParser::IoStateStepContext::getRuleIndex() const {
  return devilangParser::RuleIoStateStep;
}

void devilangParser::IoStateStepContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterIoStateStep(this);
}

void devilangParser::IoStateStepContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitIoStateStep(this);
}

devilangParser::IoStateStepContext* devilangParser::ioStateStep() {
  IoStateStepContext *_localctx = _tracker.createInstance<IoStateStepContext>(_ctx, getState());
  enterRule(_localctx, 118, devilangParser::RuleIoStateStep);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(787);
    ioVerb();
    setState(788);
    opExpr();
    setState(790);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__53) {
      setState(789);
      ioValue();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- IoVerbContext ------------------------------------------------------------------

devilangParser::IoVerbContext::IoVerbContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::IoVerbContext::getRuleIndex() const {
  return devilangParser::RuleIoVerb;
}

void devilangParser::IoVerbContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterIoVerb(this);
}

void devilangParser::IoVerbContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitIoVerb(this);
}

devilangParser::IoVerbContext* devilangParser::ioVerb() {
  IoVerbContext *_localctx = _tracker.createInstance<IoVerbContext>(_ctx, getState());
  enterRule(_localctx, 120, devilangParser::RuleIoVerb);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(792);
    _la = _input->LA(1);
    if (!(((((_la - 90) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 90)) & ((1ULL << (devilangParser::T__89 - 90))
      | (1ULL << (devilangParser::T__90 - 90))
      | (1ULL << (devilangParser::T__91 - 90))
      | (1ULL << (devilangParser::T__92 - 90))
      | (1ULL << (devilangParser::T__93 - 90))
      | (1ULL << (devilangParser::T__94 - 90))
      | (1ULL << (devilangParser::T__95 - 90))
      | (1ULL << (devilangParser::T__96 - 90)))) != 0))) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- IoValueContext ------------------------------------------------------------------

devilangParser::IoValueContext::IoValueContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::OpExprContext* devilangParser::IoValueContext::opExpr() {
  return getRuleContext<devilangParser::OpExprContext>(0);
}


size_t devilangParser::IoValueContext::getRuleIndex() const {
  return devilangParser::RuleIoValue;
}

void devilangParser::IoValueContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterIoValue(this);
}

void devilangParser::IoValueContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitIoValue(this);
}

devilangParser::IoValueContext* devilangParser::ioValue() {
  IoValueContext *_localctx = _tracker.createInstance<IoValueContext>(_ctx, getState());
  enterRule(_localctx, 122, devilangParser::RuleIoValue);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(794);
    match(devilangParser::T__53);
    setState(795);
    opExpr();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- CallStateStepContext ------------------------------------------------------------------

devilangParser::CallStateStepContext::CallStateStepContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::ExtendedNameContext* devilangParser::CallStateStepContext::extendedName() {
  return getRuleContext<devilangParser::ExtendedNameContext>(0);
}

devilangParser::FuncArgsContext* devilangParser::CallStateStepContext::funcArgs() {
  return getRuleContext<devilangParser::FuncArgsContext>(0);
}


size_t devilangParser::CallStateStepContext::getRuleIndex() const {
  return devilangParser::RuleCallStateStep;
}

void devilangParser::CallStateStepContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterCallStateStep(this);
}

void devilangParser::CallStateStepContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitCallStateStep(this);
}

devilangParser::CallStateStepContext* devilangParser::callStateStep() {
  CallStateStepContext *_localctx = _tracker.createInstance<CallStateStepContext>(_ctx, getState());
  enterRule(_localctx, 124, devilangParser::RuleCallStateStep);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(797);
    match(devilangParser::T__33);
    setState(798);
    extendedName();
    setState(804);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__97) {
      setState(799);
      match(devilangParser::T__97);
      setState(801);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if ((((_la & ~ 0x3fULL) == 0) &&
        ((1ULL << _la) & ((1ULL << devilangParser::T__5)
        | (1ULL << devilangParser::T__6)
        | (1ULL << devilangParser::T__7)
        | (1ULL << devilangParser::T__8)
        | (1ULL << devilangParser::T__9)
        | (1ULL << devilangParser::T__10)
        | (1ULL << devilangParser::T__11)
        | (1ULL << devilangParser::T__12)
        | (1ULL << devilangParser::T__13)
        | (1ULL << devilangParser::T__14)
        | (1ULL << devilangParser::T__15)
        | (1ULL << devilangParser::T__16)
        | (1ULL << devilangParser::T__17)
        | (1ULL << devilangParser::T__18)
        | (1ULL << devilangParser::T__19)
        | (1ULL << devilangParser::T__20)
        | (1ULL << devilangParser::T__21)
        | (1ULL << devilangParser::T__22)
        | (1ULL << devilangParser::T__23)
        | (1ULL << devilangParser::T__24)
        | (1ULL << devilangParser::T__25)
        | (1ULL << devilangParser::T__26)
        | (1ULL << devilangParser::T__27)
        | (1ULL << devilangParser::T__28)
        | (1ULL << devilangParser::T__29)
        | (1ULL << devilangParser::T__30)
        | (1ULL << devilangParser::T__31)
        | (1ULL << devilangParser::T__32)
        | (1ULL << devilangParser::T__33)
        | (1ULL << devilangParser::T__34)
        | (1ULL << devilangParser::T__35)
        | (1ULL << devilangParser::T__36)
        | (1ULL << devilangParser::T__37)
        | (1ULL << devilangParser::T__38)
        | (1ULL << devilangParser::T__39)
        | (1ULL << devilangParser::T__40)
        | (1ULL << devilangParser::T__41)
        | (1ULL << devilangParser::T__42)
        | (1ULL << devilangParser::T__43)
        | (1ULL << devilangParser::T__44)
        | (1ULL << devilangParser::T__45)
        | (1ULL << devilangParser::T__46)
        | (1ULL << devilangParser::T__47)
        | (1ULL << devilangParser::T__48)
        | (1ULL << devilangParser::T__49)
        | (1ULL << devilangParser::T__50)
        | (1ULL << devilangParser::T__51)
        | (1ULL << devilangParser::T__52)
        | (1ULL << devilangParser::T__53))) != 0) || ((((_la - 98) & ~ 0x3fULL) == 0) &&
        ((1ULL << (_la - 98)) & ((1ULL << (devilangParser::T__97 - 98))
        | (1ULL << (devilangParser::IDENT - 98))
        | (1ULL << (devilangParser::INT - 98)))) != 0)) {
        setState(800);
        funcArgs();
      }
      setState(803);
      match(devilangParser::T__98);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- EllipsisStateStepContext ------------------------------------------------------------------

devilangParser::EllipsisStateStepContext::EllipsisStateStepContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::EllipsisStateStepContext::getRuleIndex() const {
  return devilangParser::RuleEllipsisStateStep;
}

void devilangParser::EllipsisStateStepContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterEllipsisStateStep(this);
}

void devilangParser::EllipsisStateStepContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitEllipsisStateStep(this);
}

devilangParser::EllipsisStateStepContext* devilangParser::ellipsisStateStep() {
  EllipsisStateStepContext *_localctx = _tracker.createInstance<EllipsisStateStepContext>(_ctx, getState());
  enterRule(_localctx, 126, devilangParser::RuleEllipsisStateStep);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(806);
    match(devilangParser::T__99);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpExprContext ------------------------------------------------------------------

devilangParser::OpExprContext::OpExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::OpOrExprContext* devilangParser::OpExprContext::opOrExpr() {
  return getRuleContext<devilangParser::OpOrExprContext>(0);
}


size_t devilangParser::OpExprContext::getRuleIndex() const {
  return devilangParser::RuleOpExpr;
}

void devilangParser::OpExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpExpr(this);
}

void devilangParser::OpExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpExpr(this);
}

devilangParser::OpExprContext* devilangParser::opExpr() {
  OpExprContext *_localctx = _tracker.createInstance<OpExprContext>(_ctx, getState());
  enterRule(_localctx, 128, devilangParser::RuleOpExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(808);
    opOrExpr();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpOrExprContext ------------------------------------------------------------------

devilangParser::OpOrExprContext::OpOrExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::OpAndExprContext *> devilangParser::OpOrExprContext::opAndExpr() {
  return getRuleContexts<devilangParser::OpAndExprContext>();
}

devilangParser::OpAndExprContext* devilangParser::OpOrExprContext::opAndExpr(size_t i) {
  return getRuleContext<devilangParser::OpAndExprContext>(i);
}


size_t devilangParser::OpOrExprContext::getRuleIndex() const {
  return devilangParser::RuleOpOrExpr;
}

void devilangParser::OpOrExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpOrExpr(this);
}

void devilangParser::OpOrExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpOrExpr(this);
}

devilangParser::OpOrExprContext* devilangParser::opOrExpr() {
  OpOrExprContext *_localctx = _tracker.createInstance<OpOrExprContext>(_ctx, getState());
  enterRule(_localctx, 130, devilangParser::RuleOpOrExpr);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(810);
    opAndExpr();
    setState(815);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__71) {
      setState(811);
      match(devilangParser::T__71);
      setState(812);
      opAndExpr();
      setState(817);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpAndExprContext ------------------------------------------------------------------

devilangParser::OpAndExprContext::OpAndExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::OpAddExprContext *> devilangParser::OpAndExprContext::opAddExpr() {
  return getRuleContexts<devilangParser::OpAddExprContext>();
}

devilangParser::OpAddExprContext* devilangParser::OpAndExprContext::opAddExpr(size_t i) {
  return getRuleContext<devilangParser::OpAddExprContext>(i);
}


size_t devilangParser::OpAndExprContext::getRuleIndex() const {
  return devilangParser::RuleOpAndExpr;
}

void devilangParser::OpAndExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpAndExpr(this);
}

void devilangParser::OpAndExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpAndExpr(this);
}

devilangParser::OpAndExprContext* devilangParser::opAndExpr() {
  OpAndExprContext *_localctx = _tracker.createInstance<OpAndExprContext>(_ctx, getState());
  enterRule(_localctx, 132, devilangParser::RuleOpAndExpr);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(818);
    opAddExpr();
    setState(823);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__100) {
      setState(819);
      match(devilangParser::T__100);
      setState(820);
      opAddExpr();
      setState(825);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpAddExprContext ------------------------------------------------------------------

devilangParser::OpAddExprContext::OpAddExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::OpShiftExprContext *> devilangParser::OpAddExprContext::opShiftExpr() {
  return getRuleContexts<devilangParser::OpShiftExprContext>();
}

devilangParser::OpShiftExprContext* devilangParser::OpAddExprContext::opShiftExpr(size_t i) {
  return getRuleContext<devilangParser::OpShiftExprContext>(i);
}


size_t devilangParser::OpAddExprContext::getRuleIndex() const {
  return devilangParser::RuleOpAddExpr;
}

void devilangParser::OpAddExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpAddExpr(this);
}

void devilangParser::OpAddExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpAddExpr(this);
}

devilangParser::OpAddExprContext* devilangParser::opAddExpr() {
  OpAddExprContext *_localctx = _tracker.createInstance<OpAddExprContext>(_ctx, getState());
  enterRule(_localctx, 134, devilangParser::RuleOpAddExpr);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(826);
    opShiftExpr();
    setState(831);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__101) {
      setState(827);
      match(devilangParser::T__101);
      setState(828);
      opShiftExpr();
      setState(833);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpShiftExprContext ------------------------------------------------------------------

devilangParser::OpShiftExprContext::OpShiftExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::OpPrimaryExprContext *> devilangParser::OpShiftExprContext::opPrimaryExpr() {
  return getRuleContexts<devilangParser::OpPrimaryExprContext>();
}

devilangParser::OpPrimaryExprContext* devilangParser::OpShiftExprContext::opPrimaryExpr(size_t i) {
  return getRuleContext<devilangParser::OpPrimaryExprContext>(i);
}


size_t devilangParser::OpShiftExprContext::getRuleIndex() const {
  return devilangParser::RuleOpShiftExpr;
}

void devilangParser::OpShiftExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpShiftExpr(this);
}

void devilangParser::OpShiftExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpShiftExpr(this);
}

devilangParser::OpShiftExprContext* devilangParser::opShiftExpr() {
  OpShiftExprContext *_localctx = _tracker.createInstance<OpShiftExprContext>(_ctx, getState());
  enterRule(_localctx, 136, devilangParser::RuleOpShiftExpr);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(834);
    opPrimaryExpr();
    setState(839);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__102

    || _la == devilangParser::T__103) {
      setState(835);
      _la = _input->LA(1);
      if (!(_la == devilangParser::T__102

      || _la == devilangParser::T__103)) {
      _errHandler->recoverInline(this);
      }
      else {
        _errHandler->reportMatch(this);
        consume();
      }
      setState(836);
      opPrimaryExpr();
      setState(841);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- OpPrimaryExprContext ------------------------------------------------------------------

devilangParser::OpPrimaryExprContext::OpPrimaryExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::OpPrimaryExprContext::INT() {
  return getToken(devilangParser::INT, 0);
}

devilangParser::RefContext* devilangParser::OpPrimaryExprContext::ref() {
  return getRuleContext<devilangParser::RefContext>(0);
}

devilangParser::FuncCallContext* devilangParser::OpPrimaryExprContext::funcCall() {
  return getRuleContext<devilangParser::FuncCallContext>(0);
}

devilangParser::OpExprContext* devilangParser::OpPrimaryExprContext::opExpr() {
  return getRuleContext<devilangParser::OpExprContext>(0);
}


size_t devilangParser::OpPrimaryExprContext::getRuleIndex() const {
  return devilangParser::RuleOpPrimaryExpr;
}

void devilangParser::OpPrimaryExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterOpPrimaryExpr(this);
}

void devilangParser::OpPrimaryExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitOpPrimaryExpr(this);
}

devilangParser::OpPrimaryExprContext* devilangParser::opPrimaryExpr() {
  OpPrimaryExprContext *_localctx = _tracker.createInstance<OpPrimaryExprContext>(_ctx, getState());
  enterRule(_localctx, 138, devilangParser::RuleOpPrimaryExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(850);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 72, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(842);
      match(devilangParser::INT);
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(843);
      match(devilangParser::T__42);
      break;
    }

    case 3: {
      enterOuterAlt(_localctx, 3);
      setState(844);
      ref();
      break;
    }

    case 4: {
      enterOuterAlt(_localctx, 4);
      setState(845);
      funcCall();
      break;
    }

    case 5: {
      enterOuterAlt(_localctx, 5);
      setState(846);
      match(devilangParser::T__97);
      setState(847);
      opExpr();
      setState(848);
      match(devilangParser::T__98);
      break;
    }

    default:
      break;
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- FuncCallContext ------------------------------------------------------------------

devilangParser::FuncCallContext::FuncCallContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::FuncCallContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}

devilangParser::FuncArgsContext* devilangParser::FuncCallContext::funcArgs() {
  return getRuleContext<devilangParser::FuncArgsContext>(0);
}


size_t devilangParser::FuncCallContext::getRuleIndex() const {
  return devilangParser::RuleFuncCall;
}

void devilangParser::FuncCallContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterFuncCall(this);
}

void devilangParser::FuncCallContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitFuncCall(this);
}

devilangParser::FuncCallContext* devilangParser::funcCall() {
  FuncCallContext *_localctx = _tracker.createInstance<FuncCallContext>(_ctx, getState());
  enterRule(_localctx, 140, devilangParser::RuleFuncCall);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(852);
    qualifiedName();
    setState(853);
    match(devilangParser::T__97);
    setState(855);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__8)
      | (1ULL << devilangParser::T__9)
      | (1ULL << devilangParser::T__10)
      | (1ULL << devilangParser::T__11)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__16)
      | (1ULL << devilangParser::T__17)
      | (1ULL << devilangParser::T__18)
      | (1ULL << devilangParser::T__19)
      | (1ULL << devilangParser::T__20)
      | (1ULL << devilangParser::T__21)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__23)
      | (1ULL << devilangParser::T__24)
      | (1ULL << devilangParser::T__25)
      | (1ULL << devilangParser::T__26)
      | (1ULL << devilangParser::T__27)
      | (1ULL << devilangParser::T__28)
      | (1ULL << devilangParser::T__29)
      | (1ULL << devilangParser::T__30)
      | (1ULL << devilangParser::T__31)
      | (1ULL << devilangParser::T__32)
      | (1ULL << devilangParser::T__33)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__38)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41)
      | (1ULL << devilangParser::T__42)
      | (1ULL << devilangParser::T__43)
      | (1ULL << devilangParser::T__44)
      | (1ULL << devilangParser::T__45)
      | (1ULL << devilangParser::T__46)
      | (1ULL << devilangParser::T__47)
      | (1ULL << devilangParser::T__48)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51)
      | (1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__53))) != 0) || ((((_la - 98) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 98)) & ((1ULL << (devilangParser::T__97 - 98))
      | (1ULL << (devilangParser::IDENT - 98))
      | (1ULL << (devilangParser::INT - 98)))) != 0)) {
      setState(854);
      funcArgs();
    }
    setState(857);
    match(devilangParser::T__98);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- FuncArgsContext ------------------------------------------------------------------

devilangParser::FuncArgsContext::FuncArgsContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::OpExprContext *> devilangParser::FuncArgsContext::opExpr() {
  return getRuleContexts<devilangParser::OpExprContext>();
}

devilangParser::OpExprContext* devilangParser::FuncArgsContext::opExpr(size_t i) {
  return getRuleContext<devilangParser::OpExprContext>(i);
}


size_t devilangParser::FuncArgsContext::getRuleIndex() const {
  return devilangParser::RuleFuncArgs;
}

void devilangParser::FuncArgsContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterFuncArgs(this);
}

void devilangParser::FuncArgsContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitFuncArgs(this);
}

devilangParser::FuncArgsContext* devilangParser::funcArgs() {
  FuncArgsContext *_localctx = _tracker.createInstance<FuncArgsContext>(_ctx, getState());
  enterRule(_localctx, 142, devilangParser::RuleFuncArgs);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(859);
    opExpr();
    setState(864);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__67) {
      setState(860);
      match(devilangParser::T__67);
      setState(861);
      opExpr();
      setState(866);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- QualifiedNameContext ------------------------------------------------------------------

devilangParser::QualifiedNameContext::QualifiedNameContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::IdentContext *> devilangParser::QualifiedNameContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::QualifiedNameContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}


size_t devilangParser::QualifiedNameContext::getRuleIndex() const {
  return devilangParser::RuleQualifiedName;
}

void devilangParser::QualifiedNameContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterQualifiedName(this);
}

void devilangParser::QualifiedNameContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitQualifiedName(this);
}

devilangParser::QualifiedNameContext* devilangParser::qualifiedName() {
  QualifiedNameContext *_localctx = _tracker.createInstance<QualifiedNameContext>(_ctx, getState());
  enterRule(_localctx, 144, devilangParser::RuleQualifiedName);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(867);
    ident();
    setState(872);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__86) {
      setState(868);
      match(devilangParser::T__86);
      setState(869);
      ident();
      setState(874);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- FileNameContext ------------------------------------------------------------------

devilangParser::FileNameContext::FileNameContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::IdentContext *> devilangParser::FileNameContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::FileNameContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}


size_t devilangParser::FileNameContext::getRuleIndex() const {
  return devilangParser::RuleFileName;
}

void devilangParser::FileNameContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterFileName(this);
}

void devilangParser::FileNameContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitFileName(this);
}

devilangParser::FileNameContext* devilangParser::fileName() {
  FileNameContext *_localctx = _tracker.createInstance<FileNameContext>(_ctx, getState());
  enterRule(_localctx, 146, devilangParser::RuleFileName);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(875);
    ident();
    setState(880);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__104) {
      setState(876);
      match(devilangParser::T__104);
      setState(877);
      ident();
      setState(882);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(885);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__86) {
      setState(883);
      match(devilangParser::T__86);
      setState(884);
      ident();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- RefContext ------------------------------------------------------------------

devilangParser::RefContext::RefContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::RefContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}


size_t devilangParser::RefContext::getRuleIndex() const {
  return devilangParser::RuleRef;
}

void devilangParser::RefContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterRef(this);
}

void devilangParser::RefContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitRef(this);
}

devilangParser::RefContext* devilangParser::ref() {
  RefContext *_localctx = _tracker.createInstance<RefContext>(_ctx, getState());
  enterRule(_localctx, 148, devilangParser::RuleRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(887);
    qualifiedName();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- FieldRefContext ------------------------------------------------------------------

devilangParser::FieldRefContext::FieldRefContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::FieldRefContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::FieldRefContext::getRuleIndex() const {
  return devilangParser::RuleFieldRef;
}

void devilangParser::FieldRefContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterFieldRef(this);
}

void devilangParser::FieldRefContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitFieldRef(this);
}

devilangParser::FieldRefContext* devilangParser::fieldRef() {
  FieldRefContext *_localctx = _tracker.createInstance<FieldRefContext>(_ctx, getState());
  enterRule(_localctx, 150, devilangParser::RuleFieldRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(889);
    match(devilangParser::T__86);
    setState(890);
    ident();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BitRefContext ------------------------------------------------------------------

devilangParser::BitRefContext::BitRefContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::RefContext* devilangParser::BitRefContext::ref() {
  return getRuleContext<devilangParser::RefContext>(0);
}

tree::TerminalNode* devilangParser::BitRefContext::INT() {
  return getToken(devilangParser::INT, 0);
}


size_t devilangParser::BitRefContext::getRuleIndex() const {
  return devilangParser::RuleBitRef;
}

void devilangParser::BitRefContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBitRef(this);
}

void devilangParser::BitRefContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBitRef(this);
}

devilangParser::BitRefContext* devilangParser::bitRef() {
  BitRefContext *_localctx = _tracker.createInstance<BitRefContext>(_ctx, getState());
  enterRule(_localctx, 152, devilangParser::RuleBitRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(892);
    ref();
    setState(893);
    match(devilangParser::T__62);
    setState(894);
    match(devilangParser::INT);
    setState(895);
    match(devilangParser::T__63);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ExprContext ------------------------------------------------------------------

devilangParser::ExprContext::ExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::PrimaryContext *> devilangParser::ExprContext::primary() {
  return getRuleContexts<devilangParser::PrimaryContext>();
}

devilangParser::PrimaryContext* devilangParser::ExprContext::primary(size_t i) {
  return getRuleContext<devilangParser::PrimaryContext>(i);
}


size_t devilangParser::ExprContext::getRuleIndex() const {
  return devilangParser::RuleExpr;
}

void devilangParser::ExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterExpr(this);
}

void devilangParser::ExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitExpr(this);
}

devilangParser::ExprContext* devilangParser::expr() {
  ExprContext *_localctx = _tracker.createInstance<ExprContext>(_ctx, getState());
  enterRule(_localctx, 154, devilangParser::RuleExpr);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(897);
    primary();
    setState(902);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__101

    || _la == devilangParser::T__104) {
      setState(898);
      _la = _input->LA(1);
      if (!(_la == devilangParser::T__101

      || _la == devilangParser::T__104)) {
      _errHandler->recoverInline(this);
      }
      else {
        _errHandler->reportMatch(this);
        consume();
      }
      setState(899);
      primary();
      setState(904);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- PrimaryContext ------------------------------------------------------------------

devilangParser::PrimaryContext::PrimaryContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::PrimaryContext::INT() {
  return getToken(devilangParser::INT, 0);
}

devilangParser::RefContext* devilangParser::PrimaryContext::ref() {
  return getRuleContext<devilangParser::RefContext>(0);
}

devilangParser::ExprContext* devilangParser::PrimaryContext::expr() {
  return getRuleContext<devilangParser::ExprContext>(0);
}


size_t devilangParser::PrimaryContext::getRuleIndex() const {
  return devilangParser::RulePrimary;
}

void devilangParser::PrimaryContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterPrimary(this);
}

void devilangParser::PrimaryContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitPrimary(this);
}

devilangParser::PrimaryContext* devilangParser::primary() {
  PrimaryContext *_localctx = _tracker.createInstance<PrimaryContext>(_ctx, getState());
  enterRule(_localctx, 156, devilangParser::RulePrimary);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(911);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::INT: {
        enterOuterAlt(_localctx, 1);
        setState(905);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__5:
      case devilangParser::T__6:
      case devilangParser::T__7:
      case devilangParser::T__8:
      case devilangParser::T__9:
      case devilangParser::T__10:
      case devilangParser::T__11:
      case devilangParser::T__12:
      case devilangParser::T__13:
      case devilangParser::T__14:
      case devilangParser::T__15:
      case devilangParser::T__16:
      case devilangParser::T__17:
      case devilangParser::T__18:
      case devilangParser::T__19:
      case devilangParser::T__20:
      case devilangParser::T__21:
      case devilangParser::T__22:
      case devilangParser::T__23:
      case devilangParser::T__24:
      case devilangParser::T__25:
      case devilangParser::T__26:
      case devilangParser::T__27:
      case devilangParser::T__28:
      case devilangParser::T__29:
      case devilangParser::T__30:
      case devilangParser::T__31:
      case devilangParser::T__32:
      case devilangParser::T__33:
      case devilangParser::T__34:
      case devilangParser::T__35:
      case devilangParser::T__36:
      case devilangParser::T__37:
      case devilangParser::T__38:
      case devilangParser::T__39:
      case devilangParser::T__40:
      case devilangParser::T__41:
      case devilangParser::T__42:
      case devilangParser::T__43:
      case devilangParser::T__44:
      case devilangParser::T__45:
      case devilangParser::T__46:
      case devilangParser::T__47:
      case devilangParser::T__48:
      case devilangParser::T__49:
      case devilangParser::T__50:
      case devilangParser::T__51:
      case devilangParser::T__52:
      case devilangParser::T__53:
      case devilangParser::IDENT: {
        enterOuterAlt(_localctx, 2);
        setState(906);
        ref();
        break;
      }

      case devilangParser::T__97: {
        enterOuterAlt(_localctx, 3);
        setState(907);
        match(devilangParser::T__97);
        setState(908);
        expr();
        setState(909);
        match(devilangParser::T__98);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- BoolLiteralContext ------------------------------------------------------------------

devilangParser::BoolLiteralContext::BoolLiteralContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::BoolLiteralContext::getRuleIndex() const {
  return devilangParser::RuleBoolLiteral;
}

void devilangParser::BoolLiteralContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterBoolLiteral(this);
}

void devilangParser::BoolLiteralContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitBoolLiteral(this);
}

devilangParser::BoolLiteralContext* devilangParser::boolLiteral() {
  BoolLiteralContext *_localctx = _tracker.createInstance<BoolLiteralContext>(_ctx, getState());
  enterRule(_localctx, 158, devilangParser::RuleBoolLiteral);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(913);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__105

    || _la == devilangParser::T__106)) {
    _errHandler->recoverInline(this);
    }
    else {
      _errHandler->reportMatch(this);
      consume();
    }
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

// Static vars and initialization.
std::vector<dfa::DFA> devilangParser::_decisionToDFA;
atn::PredictionContextCache devilangParser::_sharedContextCache;

// We own the ATN which in turn owns the ATN states.
atn::ATN devilangParser::_atn;
std::vector<uint16_t> devilangParser::_serializedATN;

std::vector<std::string> devilangParser::_ruleNames = {
  "program", "decl", "structDecl", "field", "ident", "type_", "baseType", 
  "ptrType", "bytesType", "modifier", "bitBlock", "bitEntry", "bitRange", 
  "bitValue", "bitSep", "immBlock", "immEntry", "immSep", "topologyDecl", 
  "pointerDecl", "pointerField", "bitRefList", "listDecl", "dlistDecl", 
  "ringDecl", "ringbufDecl", "typeList", "spaceTypeList", "listBody", "dlistBody", 
  "ringBody", "fieldRefOrList", "ringbufBody", "headDecl", "headName", "headField", 
  "headPosition", "headLocation", "headKeyValue", "headAtom", "actionDecl", 
  "opDecl", "opBody", "callOp", "mmioOpDecl", "extendedName", "mmioField", 
  "mmioDir", "topBbDecl", "topBbItem", "topPathDecl", "topPathItem", "topFuncDecl", 
  "topFuncItem", "stateDecl", "stateStmt", "stateBlock", "stateStep", "stateTerminator", 
  "ioStateStep", "ioVerb", "ioValue", "callStateStep", "ellipsisStateStep", 
  "opExpr", "opOrExpr", "opAndExpr", "opAddExpr", "opShiftExpr", "opPrimaryExpr", 
  "funcCall", "funcArgs", "qualifiedName", "fileName", "ref", "fieldRef", 
  "bitRef", "expr", "primary", "boolLiteral"
};

std::vector<std::string> devilangParser::_literalNames = {
  "", "'struct'", "'{'", "'}'", "':'", "';'", "'count'", "'size'", "'head'", 
  "'tail'", "'next'", "'prev'", "'base'", "'align'", "'from'", "'to'", "'sentinel'", 
  "'position'", "'link'", "'status'", "'command'", "'control'", "'flags'", 
  "'data'", "'addr'", "'buf'", "'buffer'", "'tag'", "'id'", "'sig'", "'ctrl'", 
  "'token'", "'inst'", "'arg'", "'call'", "'op'", "'bb'", "'path'", "'func'", 
  "'mmio'", "'direction'", "'region'", "'address'", "'unknown'", "'phi'", 
  "'select'", "'num'", "'var'", "'flag'", "'random'", "'immediate'", "'state'", 
  "'seq'", "'repeat'", "'value'", "'u8'", "'u16'", "'u32'", "'u64'", "'ptr'", 
  "'<'", "'>'", "'bytes'", "'['", "']'", "'bits'", "'..'", "'='", "','", 
  "'imm'", "'range'", "'pointer'", "'|'", "'list'", "'dlist'", "'ring'", 
  "'ringbuf'", "'backend'", "'file'", "'filename'", "'caller'", "'target'", 
  "'callee'", "'depth'", "'call_depth'", "'argument_index'", "'action'", 
  "'.'", "'r'", "'w'", "'read8'", "'read16'", "'read32'", "'read64'", "'write8'", 
  "'write16'", "'write32'", "'write64'", "'('", "')'", "'...'", "'&'", "'+'", 
  "'<<'", "'>>'", "'-'", "'true'", "'false'"
};

std::vector<std::string> devilangParser::_symbolicNames = {
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "IDENT", "INT", "WS", "LINE_COMMENT", "BLOCK_COMMENT"
};

dfa::Vocabulary devilangParser::_vocabulary(_literalNames, _symbolicNames);

std::vector<std::string> devilangParser::_tokenNames;

devilangParser::Initializer::Initializer() {
	for (size_t i = 0; i < _symbolicNames.size(); ++i) {
		std::string name = _vocabulary.getLiteralName(i);
		if (name.empty()) {
			name = _vocabulary.getSymbolicName(i);
		}

		if (name.empty()) {
			_tokenNames.push_back("<INVALID>");
		} else {
      _tokenNames.push_back(name);
    }
	}

  static const uint16_t serializedATNSegment0[] = {
    0x3, 0x608b, 0xa72a, 0x8133, 0xb9ed, 0x417c, 0x3be7, 0x7786, 0x5964, 
       0x3, 0x72, 0x396, 0x4, 0x2, 0x9, 0x2, 0x4, 0x3, 0x9, 0x3, 0x4, 0x4, 
       0x9, 0x4, 0x4, 0x5, 0x9, 0x5, 0x4, 0x6, 0x9, 0x6, 0x4, 0x7, 0x9, 
       0x7, 0x4, 0x8, 0x9, 0x8, 0x4, 0x9, 0x9, 0x9, 0x4, 0xa, 0x9, 0xa, 
       0x4, 0xb, 0x9, 0xb, 0x4, 0xc, 0x9, 0xc, 0x4, 0xd, 0x9, 0xd, 0x4, 
       0xe, 0x9, 0xe, 0x4, 0xf, 0x9, 0xf, 0x4, 0x10, 0x9, 0x10, 0x4, 0x11, 
       0x9, 0x11, 0x4, 0x12, 0x9, 0x12, 0x4, 0x13, 0x9, 0x13, 0x4, 0x14, 
       0x9, 0x14, 0x4, 0x15, 0x9, 0x15, 0x4, 0x16, 0x9, 0x16, 0x4, 0x17, 
       0x9, 0x17, 0x4, 0x18, 0x9, 0x18, 0x4, 0x19, 0x9, 0x19, 0x4, 0x1a, 
       0x9, 0x1a, 0x4, 0x1b, 0x9, 0x1b, 0x4, 0x1c, 0x9, 0x1c, 0x4, 0x1d, 
       0x9, 0x1d, 0x4, 0x1e, 0x9, 0x1e, 0x4, 0x1f, 0x9, 0x1f, 0x4, 0x20, 
       0x9, 0x20, 0x4, 0x21, 0x9, 0x21, 0x4, 0x22, 0x9, 0x22, 0x4, 0x23, 
       0x9, 0x23, 0x4, 0x24, 0x9, 0x24, 0x4, 0x25, 0x9, 0x25, 0x4, 0x26, 
       0x9, 0x26, 0x4, 0x27, 0x9, 0x27, 0x4, 0x28, 0x9, 0x28, 0x4, 0x29, 
       0x9, 0x29, 0x4, 0x2a, 0x9, 0x2a, 0x4, 0x2b, 0x9, 0x2b, 0x4, 0x2c, 
       0x9, 0x2c, 0x4, 0x2d, 0x9, 0x2d, 0x4, 0x2e, 0x9, 0x2e, 0x4, 0x2f, 
       0x9, 0x2f, 0x4, 0x30, 0x9, 0x30, 0x4, 0x31, 0x9, 0x31, 0x4, 0x32, 
       0x9, 0x32, 0x4, 0x33, 0x9, 0x33, 0x4, 0x34, 0x9, 0x34, 0x4, 0x35, 
       0x9, 0x35, 0x4, 0x36, 0x9, 0x36, 0x4, 0x37, 0x9, 0x37, 0x4, 0x38, 
       0x9, 0x38, 0x4, 0x39, 0x9, 0x39, 0x4, 0x3a, 0x9, 0x3a, 0x4, 0x3b, 
       0x9, 0x3b, 0x4, 0x3c, 0x9, 0x3c, 0x4, 0x3d, 0x9, 0x3d, 0x4, 0x3e, 
       0x9, 0x3e, 0x4, 0x3f, 0x9, 0x3f, 0x4, 0x40, 0x9, 0x40, 0x4, 0x41, 
       0x9, 0x41, 0x4, 0x42, 0x9, 0x42, 0x4, 0x43, 0x9, 0x43, 0x4, 0x44, 
       0x9, 0x44, 0x4, 0x45, 0x9, 0x45, 0x4, 0x46, 0x9, 0x46, 0x4, 0x47, 
       0x9, 0x47, 0x4, 0x48, 0x9, 0x48, 0x4, 0x49, 0x9, 0x49, 0x4, 0x4a, 
       0x9, 0x4a, 0x4, 0x4b, 0x9, 0x4b, 0x4, 0x4c, 0x9, 0x4c, 0x4, 0x4d, 
       0x9, 0x4d, 0x4, 0x4e, 0x9, 0x4e, 0x4, 0x4f, 0x9, 0x4f, 0x4, 0x50, 
       0x9, 0x50, 0x4, 0x51, 0x9, 0x51, 0x3, 0x2, 0x7, 0x2, 0xa4, 0xa, 0x2, 
       0xc, 0x2, 0xe, 0x2, 0xa7, 0xb, 0x2, 0x3, 0x2, 0x3, 0x2, 0x3, 0x3, 
       0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 
       0x3, 0x5, 0x3, 0xb3, 0xa, 0x3, 0x3, 0x4, 0x3, 0x4, 0x3, 0x4, 0x3, 
       0x4, 0x7, 0x4, 0xb9, 0xa, 0x4, 0xc, 0x4, 0xe, 0x4, 0xbc, 0xb, 0x4, 
       0x3, 0x4, 0x3, 0x4, 0x3, 0x5, 0x3, 0x5, 0x3, 0x5, 0x3, 0x5, 0x7, 
       0x5, 0xc4, 0xa, 0x5, 0xc, 0x5, 0xe, 0x5, 0xc7, 0xb, 0x5, 0x3, 0x5, 
       0x5, 0x5, 0xca, 0xa, 0x5, 0x3, 0x5, 0x5, 0x5, 0xcd, 0xa, 0x5, 0x3, 
       0x5, 0x3, 0x5, 0x3, 0x6, 0x3, 0x6, 0x3, 0x7, 0x3, 0x7, 0x3, 0x7, 
       0x5, 0x7, 0xd6, 0xa, 0x7, 0x3, 0x8, 0x3, 0x8, 0x3, 0x9, 0x3, 0x9, 
       0x3, 0x9, 0x3, 0x9, 0x3, 0x9, 0x3, 0xa, 0x3, 0xa, 0x3, 0xa, 0x3, 
       0xa, 0x3, 0xa, 0x3, 0xb, 0x3, 0xb, 0x3, 0xb, 0x3, 0xb, 0x3, 0xb, 
       0x5, 0xb, 0xe9, 0xa, 0xb, 0x3, 0xc, 0x3, 0xc, 0x3, 0xc, 0x3, 0xc, 
       0x3, 0xc, 0x7, 0xc, 0xf0, 0xa, 0xc, 0xc, 0xc, 0xe, 0xc, 0xf3, 0xb, 
       0xc, 0x3, 0xc, 0x5, 0xc, 0xf6, 0xa, 0xc, 0x5, 0xc, 0xf8, 0xa, 0xc, 
       0x3, 0xc, 0x3, 0xc, 0x3, 0xd, 0x3, 0xd, 0x5, 0xd, 0xfe, 0xa, 0xd, 
       0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 
       0xe, 0x5, 0xe, 0x107, 0xa, 0xe, 0x3, 0xf, 0x3, 0xf, 0x3, 0xf, 0x3, 
       0x10, 0x3, 0x10, 0x3, 0x11, 0x3, 0x11, 0x3, 0x11, 0x3, 0x11, 0x3, 
       0x11, 0x7, 0x11, 0x113, 0xa, 0x11, 0xc, 0x11, 0xe, 0x11, 0x116, 0xb, 
       0x11, 0x3, 0x11, 0x5, 0x11, 0x119, 0xa, 0x11, 0x5, 0x11, 0x11b, 0xa, 
       0x11, 0x3, 0x11, 0x3, 0x11, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 
       0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 
       0x12, 0x5, 0x12, 0x129, 0xa, 0x12, 0x3, 0x13, 0x3, 0x13, 0x3, 0x14, 
       0x3, 0x14, 0x3, 0x14, 0x3, 0x14, 0x3, 0x14, 0x3, 0x14, 0x5, 0x14, 
       0x133, 0xa, 0x14, 0x3, 0x15, 0x3, 0x15, 0x3, 0x15, 0x7, 0x15, 0x138, 
       0xa, 0x15, 0xc, 0x15, 0xe, 0x15, 0x13b, 0xb, 0x15, 0x3, 0x15, 0x3, 
       0x15, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x5, 0x16, 0x15b, 
       0xa, 0x16, 0x3, 0x17, 0x3, 0x17, 0x3, 0x17, 0x7, 0x17, 0x160, 0xa, 
       0x17, 0xc, 0x17, 0xe, 0x17, 0x163, 0xb, 0x17, 0x3, 0x18, 0x3, 0x18, 
       0x3, 0x18, 0x3, 0x18, 0x3, 0x18, 0x5, 0x18, 0x16a, 0xa, 0x18, 0x3, 
       0x18, 0x3, 0x18, 0x3, 0x18, 0x3, 0x18, 0x3, 0x19, 0x3, 0x19, 0x3, 
       0x19, 0x3, 0x19, 0x3, 0x19, 0x5, 0x19, 0x175, 0xa, 0x19, 0x3, 0x19, 
       0x3, 0x19, 0x3, 0x19, 0x3, 0x19, 0x3, 0x1a, 0x3, 0x1a, 0x3, 0x1a, 
       0x3, 0x1a, 0x3, 0x1a, 0x5, 0x1a, 0x180, 0xa, 0x1a, 0x3, 0x1a, 0x3, 
       0x1a, 0x3, 0x1a, 0x3, 0x1a, 0x3, 0x1b, 0x3, 0x1b, 0x3, 0x1b, 0x3, 
       0x1b, 0x3, 0x1b, 0x5, 0x1b, 0x18b, 0xa, 0x1b, 0x3, 0x1b, 0x3, 0x1b, 
       0x3, 0x1b, 0x3, 0x1b, 0x3, 0x1c, 0x3, 0x1c, 0x3, 0x1c, 0x7, 0x1c, 
       0x194, 0xa, 0x1c, 0xc, 0x1c, 0xe, 0x1c, 0x197, 0xb, 0x1c, 0x3, 0x1d, 
       0x6, 0x1d, 0x19a, 0xa, 0x1d, 0xd, 0x1d, 0xe, 0x1d, 0x19b, 0x3, 0x1e, 
       0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 
       0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 
       0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x5, 0x1e, 0x1af, 0xa, 
       0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x5, 0x1e, 0x1b5, 
       0xa, 0x1e, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 
       0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 
       0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 
       0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x5, 0x1f, 0x1cc, 0xa, 
       0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x5, 0x1f, 0x1d2, 
       0xa, 0x1f, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 
       0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 
       0x3, 0x20, 0x5, 0x20, 0x1e0, 0xa, 0x20, 0x3, 0x21, 0x3, 0x21, 0x3, 
       0x21, 0x7, 0x21, 0x1e5, 0xa, 0x21, 0xc, 0x21, 0xe, 0x21, 0x1e8, 0xb, 
       0x21, 0x3, 0x21, 0x3, 0x21, 0x3, 0x21, 0x7, 0x21, 0x1ed, 0xa, 0x21, 
       0xc, 0x21, 0xe, 0x21, 0x1f0, 0xb, 0x21, 0x5, 0x21, 0x1f2, 0xa, 0x21, 
       0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 
       0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 
       0x3, 0x22, 0x5, 0x22, 0x201, 0xa, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 
       0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 
       0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x5, 0x22, 0x20f, 0xa, 0x22, 
       0x3, 0x23, 0x3, 0x23, 0x5, 0x23, 0x213, 0xa, 0x23, 0x3, 0x23, 0x3, 
       0x23, 0x7, 0x23, 0x217, 0xa, 0x23, 0xc, 0x23, 0xe, 0x23, 0x21a, 0xb, 
       0x23, 0x3, 0x23, 0x3, 0x23, 0x3, 0x24, 0x3, 0x24, 0x3, 0x25, 0x3, 
       0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 
       0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x5, 0x25, 0x22c, 
       0xa, 0x25, 0x3, 0x26, 0x3, 0x26, 0x3, 0x26, 0x7, 0x26, 0x231, 0xa, 
       0x26, 0xc, 0x26, 0xe, 0x26, 0x234, 0xb, 0x26, 0x3, 0x27, 0x3, 0x27, 
       0x3, 0x27, 0x3, 0x27, 0x7, 0x27, 0x23a, 0xa, 0x27, 0xc, 0x27, 0xe, 
       0x27, 0x23d, 0xb, 0x27, 0x3, 0x27, 0x5, 0x27, 0x240, 0xa, 0x27, 0x3, 
       0x27, 0x3, 0x27, 0x3, 0x27, 0x7, 0x27, 0x245, 0xa, 0x27, 0xc, 0x27, 
       0xe, 0x27, 0x248, 0xb, 0x27, 0x5, 0x27, 0x24a, 0xa, 0x27, 0x3, 0x27, 
       0x3, 0x27, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x5, 0x28, 0x26f, 0xa, 
       0x28, 0x3, 0x29, 0x3, 0x29, 0x5, 0x29, 0x273, 0xa, 0x29, 0x3, 0x2a, 
       0x3, 0x2a, 0x3, 0x2a, 0x3, 0x2a, 0x3, 0x2a, 0x3, 0x2b, 0x3, 0x2b, 
       0x3, 0x2b, 0x3, 0x2b, 0x3, 0x2b, 0x3, 0x2b, 0x3, 0x2c, 0x3, 0x2c, 
       0x5, 0x2c, 0x282, 0xa, 0x2c, 0x3, 0x2d, 0x3, 0x2d, 0x3, 0x2d, 0x3, 
       0x2d, 0x3, 0x2e, 0x3, 0x2e, 0x3, 0x2e, 0x3, 0x2e, 0x7, 0x2e, 0x28c, 
       0xa, 0x2e, 0xc, 0x2e, 0xe, 0x2e, 0x28f, 0xb, 0x2e, 0x3, 0x2e, 0x3, 
       0x2e, 0x3, 0x2f, 0x3, 0x2f, 0x3, 0x2f, 0x3, 0x2f, 0x6, 0x2f, 0x297, 
       0xa, 0x2f, 0xd, 0x2f, 0xe, 0x2f, 0x298, 0x7, 0x2f, 0x29b, 0xa, 0x2f, 
       0xc, 0x2f, 0xe, 0x2f, 0x29e, 0xb, 0x2f, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x5, 0x30, 0x2b7, 0xa, 0x30, 0x3, 0x31, 
       0x3, 0x31, 0x3, 0x32, 0x3, 0x32, 0x3, 0x32, 0x3, 0x32, 0x6, 0x32, 
       0x2bf, 0xa, 0x32, 0xd, 0x32, 0xe, 0x32, 0x2c0, 0x3, 0x32, 0x3, 0x32, 
       0x3, 0x33, 0x3, 0x33, 0x3, 0x33, 0x3, 0x33, 0x3, 0x34, 0x3, 0x34, 
       0x3, 0x34, 0x3, 0x34, 0x6, 0x34, 0x2cd, 0xa, 0x34, 0xd, 0x34, 0xe, 
       0x34, 0x2ce, 0x3, 0x34, 0x3, 0x34, 0x3, 0x35, 0x3, 0x35, 0x3, 0x35, 
       0x3, 0x36, 0x3, 0x36, 0x3, 0x36, 0x3, 0x36, 0x6, 0x36, 0x2da, 0xa, 
       0x36, 0xd, 0x36, 0xe, 0x36, 0x2db, 0x3, 0x36, 0x3, 0x36, 0x3, 0x37, 
       0x3, 0x37, 0x3, 0x37, 0x3, 0x37, 0x3, 0x38, 0x3, 0x38, 0x3, 0x38, 
       0x3, 0x38, 0x6, 0x38, 0x2e8, 0xa, 0x38, 0xd, 0x38, 0xe, 0x38, 0x2e9, 
       0x3, 0x38, 0x3, 0x38, 0x3, 0x39, 0x3, 0x39, 0x5, 0x39, 0x2f0, 0xa, 
       0x39, 0x3, 0x3a, 0x3, 0x3a, 0x3, 0x3a, 0x7, 0x3a, 0x2f5, 0xa, 0x3a, 
       0xc, 0x3a, 0xe, 0x3a, 0x2f8, 0xb, 0x3a, 0x3, 0x3a, 0x3, 0x3a, 0x3, 
       0x3a, 0x3, 0x3a, 0x7, 0x3a, 0x2fe, 0xa, 0x3a, 0xc, 0x3a, 0xe, 0x3a, 
       0x301, 0xb, 0x3a, 0x3, 0x3a, 0x5, 0x3a, 0x304, 0xa, 0x3a, 0x3, 0x3b, 
       0x3, 0x3b, 0x5, 0x3b, 0x308, 0xa, 0x3b, 0x3, 0x3b, 0x3, 0x3b, 0x5, 
       0x3b, 0x30c, 0xa, 0x3b, 0x3, 0x3b, 0x3, 0x3b, 0x5, 0x3b, 0x310, 0xa, 
       0x3b, 0x5, 0x3b, 0x312, 0xa, 0x3b, 0x3, 0x3c, 0x3, 0x3c, 0x3, 0x3d, 
       0x3, 0x3d, 0x3, 0x3d, 0x5, 0x3d, 0x319, 0xa, 0x3d, 0x3, 0x3e, 0x3, 
       0x3e, 0x3, 0x3f, 0x3, 0x3f, 0x3, 0x3f, 0x3, 0x40, 0x3, 0x40, 0x3, 
       0x40, 0x3, 0x40, 0x5, 0x40, 0x324, 0xa, 0x40, 0x3, 0x40, 0x5, 0x40, 
       0x327, 0xa, 0x40, 0x3, 0x41, 0x3, 0x41, 0x3, 0x42, 0x3, 0x42, 0x3, 
       0x43, 0x3, 0x43, 0x3, 0x43, 0x7, 0x43, 0x330, 0xa, 0x43, 0xc, 0x43, 
       0xe, 0x43, 0x333, 0xb, 0x43, 0x3, 0x44, 0x3, 0x44, 0x3, 0x44, 0x7, 
       0x44, 0x338, 0xa, 0x44, 0xc, 0x44, 0xe, 0x44, 0x33b, 0xb, 0x44, 0x3, 
       0x45, 0x3, 0x45, 0x3, 0x45, 0x7, 0x45, 0x340, 0xa, 0x45, 0xc, 0x45, 
       0xe, 0x45, 0x343, 0xb, 0x45, 0x3, 0x46, 0x3, 0x46, 0x3, 0x46, 0x7, 
       0x46, 0x348, 0xa, 0x46, 0xc, 0x46, 0xe, 0x46, 0x34b, 0xb, 0x46, 0x3, 
       0x47, 0x3, 0x47, 0x3, 0x47, 0x3, 0x47, 0x3, 0x47, 0x3, 0x47, 0x3, 
       0x47, 0x3, 0x47, 0x5, 0x47, 0x355, 0xa, 0x47, 0x3, 0x48, 0x3, 0x48, 
       0x3, 0x48, 0x5, 0x48, 0x35a, 0xa, 0x48, 0x3, 0x48, 0x3, 0x48, 0x3, 
       0x49, 0x3, 0x49, 0x3, 0x49, 0x7, 0x49, 0x361, 0xa, 0x49, 0xc, 0x49, 
       0xe, 0x49, 0x364, 0xb, 0x49, 0x3, 0x4a, 0x3, 0x4a, 0x3, 0x4a, 0x7, 
       0x4a, 0x369, 0xa, 0x4a, 0xc, 0x4a, 0xe, 0x4a, 0x36c, 0xb, 0x4a, 0x3, 
       0x4b, 0x3, 0x4b, 0x3, 0x4b, 0x7, 0x4b, 0x371, 0xa, 0x4b, 0xc, 0x4b, 
       0xe, 0x4b, 0x374, 0xb, 0x4b, 0x3, 0x4b, 0x3, 0x4b, 0x5, 0x4b, 0x378, 
       0xa, 0x4b, 0x3, 0x4c, 0x3, 0x4c, 0x3, 0x4d, 0x3, 0x4d, 0x3, 0x4d, 
       0x3, 0x4e, 0x3, 0x4e, 0x3, 0x4e, 0x3, 0x4e, 0x3, 0x4e, 0x3, 0x4f, 
       0x3, 0x4f, 0x3, 0x4f, 0x7, 0x4f, 0x387, 0xa, 0x4f, 0xc, 0x4f, 0xe, 
       0x4f, 0x38a, 0xb, 0x4f, 0x3, 0x50, 0x3, 0x50, 0x3, 0x50, 0x3, 0x50, 
       0x3, 0x50, 0x3, 0x50, 0x5, 0x50, 0x392, 0xa, 0x50, 0x3, 0x51, 0x3, 
       0x51, 0x3, 0x51, 0x2, 0x2, 0x52, 0x2, 0x4, 0x6, 0x8, 0xa, 0xc, 0xe, 
       0x10, 0x12, 0x14, 0x16, 0x18, 0x1a, 0x1c, 0x1e, 0x20, 0x22, 0x24, 
       0x26, 0x28, 0x2a, 0x2c, 0x2e, 0x30, 0x32, 0x34, 0x36, 0x38, 0x3a, 
       0x3c, 0x3e, 0x40, 0x42, 0x44, 0x46, 0x48, 0x4a, 0x4c, 0x4e, 0x50, 
       0x52, 0x54, 0x56, 0x58, 0x5a, 0x5c, 0x5e, 0x60, 0x62, 0x64, 0x66, 
       0x68, 0x6a, 0x6c, 0x6e, 0x70, 0x72, 0x74, 0x76, 0x78, 0x7a, 0x7c, 
       0x7e, 0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e, 0x90, 0x92, 
       0x94, 0x96, 0x98, 0x9a, 0x9c, 0x9e, 0xa0, 0x2, 0xa, 0x4, 0x2, 0x8, 
       0x38, 0x6e, 0x6e, 0x3, 0x2, 0x39, 0x3c, 0x4, 0x2, 0x7, 0x7, 0x46, 
       0x46, 0x3, 0x2, 0x5a, 0x5b, 0x3, 0x2, 0x5c, 0x63, 0x3, 0x2, 0x69, 
       0x6a, 0x4, 0x2, 0x68, 0x68, 0x6b, 0x6b, 0x3, 0x2, 0x6c, 0x6d, 0x2, 
       0x3ba, 0x2, 0xa5, 0x3, 0x2, 0x2, 0x2, 0x4, 0xb2, 0x3, 0x2, 0x2, 0x2, 
       0x6, 0xb4, 0x3, 0x2, 0x2, 0x2, 0x8, 0xbf, 0x3, 0x2, 0x2, 0x2, 0xa, 
       0xd0, 0x3, 0x2, 0x2, 0x2, 0xc, 0xd5, 0x3, 0x2, 0x2, 0x2, 0xe, 0xd7, 
       0x3, 0x2, 0x2, 0x2, 0x10, 0xd9, 0x3, 0x2, 0x2, 0x2, 0x12, 0xde, 0x3, 
       0x2, 0x2, 0x2, 0x14, 0xe8, 0x3, 0x2, 0x2, 0x2, 0x16, 0xea, 0x3, 0x2, 
       0x2, 0x2, 0x18, 0xfb, 0x3, 0x2, 0x2, 0x2, 0x1a, 0x106, 0x3, 0x2, 
       0x2, 0x2, 0x1c, 0x108, 0x3, 0x2, 0x2, 0x2, 0x1e, 0x10b, 0x3, 0x2, 
       0x2, 0x2, 0x20, 0x10d, 0x3, 0x2, 0x2, 0x2, 0x22, 0x128, 0x3, 0x2, 
       0x2, 0x2, 0x24, 0x12a, 0x3, 0x2, 0x2, 0x2, 0x26, 0x132, 0x3, 0x2, 
       0x2, 0x2, 0x28, 0x134, 0x3, 0x2, 0x2, 0x2, 0x2a, 0x15a, 0x3, 0x2, 
       0x2, 0x2, 0x2c, 0x15c, 0x3, 0x2, 0x2, 0x2, 0x2e, 0x164, 0x3, 0x2, 
       0x2, 0x2, 0x30, 0x16f, 0x3, 0x2, 0x2, 0x2, 0x32, 0x17a, 0x3, 0x2, 
       0x2, 0x2, 0x34, 0x185, 0x3, 0x2, 0x2, 0x2, 0x36, 0x190, 0x3, 0x2, 
       0x2, 0x2, 0x38, 0x199, 0x3, 0x2, 0x2, 0x2, 0x3a, 0x19d, 0x3, 0x2, 
       0x2, 0x2, 0x3c, 0x1b6, 0x3, 0x2, 0x2, 0x2, 0x3e, 0x1d3, 0x3, 0x2, 
       0x2, 0x2, 0x40, 0x1f1, 0x3, 0x2, 0x2, 0x2, 0x42, 0x1f3, 0x3, 0x2, 
       0x2, 0x2, 0x44, 0x210, 0x3, 0x2, 0x2, 0x2, 0x46, 0x21d, 0x3, 0x2, 
       0x2, 0x2, 0x48, 0x22b, 0x3, 0x2, 0x2, 0x2, 0x4a, 0x22d, 0x3, 0x2, 
       0x2, 0x2, 0x4c, 0x235, 0x3, 0x2, 0x2, 0x2, 0x4e, 0x26e, 0x3, 0x2, 
       0x2, 0x2, 0x50, 0x272, 0x3, 0x2, 0x2, 0x2, 0x52, 0x274, 0x3, 0x2, 
       0x2, 0x2, 0x54, 0x279, 0x3, 0x2, 0x2, 0x2, 0x56, 0x281, 0x3, 0x2, 
       0x2, 0x2, 0x58, 0x283, 0x3, 0x2, 0x2, 0x2, 0x5a, 0x287, 0x3, 0x2, 
       0x2, 0x2, 0x5c, 0x292, 0x3, 0x2, 0x2, 0x2, 0x5e, 0x2b6, 0x3, 0x2, 
       0x2, 0x2, 0x60, 0x2b8, 0x3, 0x2, 0x2, 0x2, 0x62, 0x2ba, 0x3, 0x2, 
       0x2, 0x2, 0x64, 0x2c4, 0x3, 0x2, 0x2, 0x2, 0x66, 0x2c8, 0x3, 0x2, 
       0x2, 0x2, 0x68, 0x2d2, 0x3, 0x2, 0x2, 0x2, 0x6a, 0x2d5, 0x3, 0x2, 
       0x2, 0x2, 0x6c, 0x2df, 0x3, 0x2, 0x2, 0x2, 0x6e, 0x2e3, 0x3, 0x2, 
       0x2, 0x2, 0x70, 0x2ef, 0x3, 0x2, 0x2, 0x2, 0x72, 0x303, 0x3, 0x2, 
       0x2, 0x2, 0x74, 0x311, 0x3, 0x2, 0x2, 0x2, 0x76, 0x313, 0x3, 0x2, 
       0x2, 0x2, 0x78, 0x315, 0x3, 0x2, 0x2, 0x2, 0x7a, 0x31a, 0x3, 0x2, 
       0x2, 0x2, 0x7c, 0x31c, 0x3, 0x2, 0x2, 0x2, 0x7e, 0x31f, 0x3, 0x2, 
       0x2, 0x2, 0x80, 0x328, 0x3, 0x2, 0x2, 0x2, 0x82, 0x32a, 0x3, 0x2, 
       0x2, 0x2, 0x84, 0x32c, 0x3, 0x2, 0x2, 0x2, 0x86, 0x334, 0x3, 0x2, 
       0x2, 0x2, 0x88, 0x33c, 0x3, 0x2, 0x2, 0x2, 0x8a, 0x344, 0x3, 0x2, 
       0x2, 0x2, 0x8c, 0x354, 0x3, 0x2, 0x2, 0x2, 0x8e, 0x356, 0x3, 0x2, 
       0x2, 0x2, 0x90, 0x35d, 0x3, 0x2, 0x2, 0x2, 0x92, 0x365, 0x3, 0x2, 
       0x2, 0x2, 0x94, 0x36d, 0x3, 0x2, 0x2, 0x2, 0x96, 0x379, 0x3, 0x2, 
       0x2, 0x2, 0x98, 0x37b, 0x3, 0x2, 0x2, 0x2, 0x9a, 0x37e, 0x3, 0x2, 
       0x2, 0x2, 0x9c, 0x383, 0x3, 0x2, 0x2, 0x2, 0x9e, 0x391, 0x3, 0x2, 
       0x2, 0x2, 0xa0, 0x393, 0x3, 0x2, 0x2, 0x2, 0xa2, 0xa4, 0x5, 0x4, 
       0x3, 0x2, 0xa3, 0xa2, 0x3, 0x2, 0x2, 0x2, 0xa4, 0xa7, 0x3, 0x2, 0x2, 
       0x2, 0xa5, 0xa3, 0x3, 0x2, 0x2, 0x2, 0xa5, 0xa6, 0x3, 0x2, 0x2, 0x2, 
       0xa6, 0xa8, 0x3, 0x2, 0x2, 0x2, 0xa7, 0xa5, 0x3, 0x2, 0x2, 0x2, 0xa8, 
       0xa9, 0x7, 0x2, 0x2, 0x3, 0xa9, 0x3, 0x3, 0x2, 0x2, 0x2, 0xaa, 0xb3, 
       0x5, 0x6, 0x4, 0x2, 0xab, 0xb3, 0x5, 0x26, 0x14, 0x2, 0xac, 0xb3, 
       0x5, 0x52, 0x2a, 0x2, 0xad, 0xb3, 0x5, 0x54, 0x2b, 0x2, 0xae, 0xb3, 
       0x5, 0x62, 0x32, 0x2, 0xaf, 0xb3, 0x5, 0x66, 0x34, 0x2, 0xb0, 0xb3, 
       0x5, 0x6a, 0x36, 0x2, 0xb1, 0xb3, 0x5, 0x6e, 0x38, 0x2, 0xb2, 0xaa, 
       0x3, 0x2, 0x2, 0x2, 0xb2, 0xab, 0x3, 0x2, 0x2, 0x2, 0xb2, 0xac, 0x3, 
       0x2, 0x2, 0x2, 0xb2, 0xad, 0x3, 0x2, 0x2, 0x2, 0xb2, 0xae, 0x3, 0x2, 
       0x2, 0x2, 0xb2, 0xaf, 0x3, 0x2, 0x2, 0x2, 0xb2, 0xb0, 0x3, 0x2, 0x2, 
       0x2, 0xb2, 0xb1, 0x3, 0x2, 0x2, 0x2, 0xb3, 0x5, 0x3, 0x2, 0x2, 0x2, 
       0xb4, 0xb5, 0x7, 0x3, 0x2, 0x2, 0xb5, 0xb6, 0x5, 0xa, 0x6, 0x2, 0xb6, 
       0xba, 0x7, 0x4, 0x2, 0x2, 0xb7, 0xb9, 0x5, 0x8, 0x5, 0x2, 0xb8, 0xb7, 
       0x3, 0x2, 0x2, 0x2, 0xb9, 0xbc, 0x3, 0x2, 0x2, 0x2, 0xba, 0xb8, 0x3, 
       0x2, 0x2, 0x2, 0xba, 0xbb, 0x3, 0x2, 0x2, 0x2, 0xbb, 0xbd, 0x3, 0x2, 
       0x2, 0x2, 0xbc, 0xba, 0x3, 0x2, 0x2, 0x2, 0xbd, 0xbe, 0x7, 0x5, 0x2, 
       0x2, 0xbe, 0x7, 0x3, 0x2, 0x2, 0x2, 0xbf, 0xc0, 0x5, 0xa, 0x6, 0x2, 
       0xc0, 0xc1, 0x7, 0x6, 0x2, 0x2, 0xc1, 0xc5, 0x5, 0xc, 0x7, 0x2, 0xc2, 
       0xc4, 0x5, 0x14, 0xb, 0x2, 0xc3, 0xc2, 0x3, 0x2, 0x2, 0x2, 0xc4, 
       0xc7, 0x3, 0x2, 0x2, 0x2, 0xc5, 0xc3, 0x3, 0x2, 0x2, 0x2, 0xc5, 0xc6, 
       0x3, 0x2, 0x2, 0x2, 0xc6, 0xc9, 0x3, 0x2, 0x2, 0x2, 0xc7, 0xc5, 0x3, 
       0x2, 0x2, 0x2, 0xc8, 0xca, 0x5, 0x16, 0xc, 0x2, 0xc9, 0xc8, 0x3, 
       0x2, 0x2, 0x2, 0xc9, 0xca, 0x3, 0x2, 0x2, 0x2, 0xca, 0xcc, 0x3, 0x2, 
       0x2, 0x2, 0xcb, 0xcd, 0x5, 0x20, 0x11, 0x2, 0xcc, 0xcb, 0x3, 0x2, 
       0x2, 0x2, 0xcc, 0xcd, 0x3, 0x2, 0x2, 0x2, 0xcd, 0xce, 0x3, 0x2, 0x2, 
       0x2, 0xce, 0xcf, 0x7, 0x7, 0x2, 0x2, 0xcf, 0x9, 0x3, 0x2, 0x2, 0x2, 
       0xd0, 0xd1, 0x9, 0x2, 0x2, 0x2, 0xd1, 0xb, 0x3, 0x2, 0x2, 0x2, 0xd2, 
       0xd6, 0x5, 0xe, 0x8, 0x2, 0xd3, 0xd6, 0x5, 0x10, 0x9, 0x2, 0xd4, 
       0xd6, 0x5, 0x12, 0xa, 0x2, 0xd5, 0xd2, 0x3, 0x2, 0x2, 0x2, 0xd5, 
       0xd3, 0x3, 0x2, 0x2, 0x2, 0xd5, 0xd4, 0x3, 0x2, 0x2, 0x2, 0xd6, 0xd, 
       0x3, 0x2, 0x2, 0x2, 0xd7, 0xd8, 0x9, 0x3, 0x2, 0x2, 0xd8, 0xf, 0x3, 
       0x2, 0x2, 0x2, 0xd9, 0xda, 0x7, 0x3d, 0x2, 0x2, 0xda, 0xdb, 0x7, 
       0x3e, 0x2, 0x2, 0xdb, 0xdc, 0x5, 0xc, 0x7, 0x2, 0xdc, 0xdd, 0x7, 
       0x3f, 0x2, 0x2, 0xdd, 0x11, 0x3, 0x2, 0x2, 0x2, 0xde, 0xdf, 0x7, 
       0x40, 0x2, 0x2, 0xdf, 0xe0, 0x7, 0x41, 0x2, 0x2, 0xe0, 0xe1, 0x7, 
       0x6f, 0x2, 0x2, 0xe1, 0xe2, 0x7, 0x42, 0x2, 0x2, 0xe2, 0x13, 0x3, 
       0x2, 0x2, 0x2, 0xe3, 0xe9, 0x7, 0x32, 0x2, 0x2, 0xe4, 0xe9, 0x7, 
       0x33, 0x2, 0x2, 0xe5, 0xe9, 0x7, 0x34, 0x2, 0x2, 0xe6, 0xe7, 0x7, 
       0xf, 0x2, 0x2, 0xe7, 0xe9, 0x7, 0x6f, 0x2, 0x2, 0xe8, 0xe3, 0x3, 
       0x2, 0x2, 0x2, 0xe8, 0xe4, 0x3, 0x2, 0x2, 0x2, 0xe8, 0xe5, 0x3, 0x2, 
       0x2, 0x2, 0xe8, 0xe6, 0x3, 0x2, 0x2, 0x2, 0xe9, 0x15, 0x3, 0x2, 0x2, 
       0x2, 0xea, 0xf7, 0x7, 0x41, 0x2, 0x2, 0xeb, 0xf1, 0x5, 0x18, 0xd, 
       0x2, 0xec, 0xed, 0x5, 0x1e, 0x10, 0x2, 0xed, 0xee, 0x5, 0x18, 0xd, 
       0x2, 0xee, 0xf0, 0x3, 0x2, 0x2, 0x2, 0xef, 0xec, 0x3, 0x2, 0x2, 0x2, 
       0xf0, 0xf3, 0x3, 0x2, 0x2, 0x2, 0xf1, 0xef, 0x3, 0x2, 0x2, 0x2, 0xf1, 
       0xf2, 0x3, 0x2, 0x2, 0x2, 0xf2, 0xf5, 0x3, 0x2, 0x2, 0x2, 0xf3, 0xf1, 
       0x3, 0x2, 0x2, 0x2, 0xf4, 0xf6, 0x5, 0x1e, 0x10, 0x2, 0xf5, 0xf4, 
       0x3, 0x2, 0x2, 0x2, 0xf5, 0xf6, 0x3, 0x2, 0x2, 0x2, 0xf6, 0xf8, 0x3, 
       0x2, 0x2, 0x2, 0xf7, 0xeb, 0x3, 0x2, 0x2, 0x2, 0xf7, 0xf8, 0x3, 0x2, 
       0x2, 0x2, 0xf8, 0xf9, 0x3, 0x2, 0x2, 0x2, 0xf9, 0xfa, 0x7, 0x42, 
       0x2, 0x2, 0xfa, 0x17, 0x3, 0x2, 0x2, 0x2, 0xfb, 0xfd, 0x5, 0x1a, 
       0xe, 0x2, 0xfc, 0xfe, 0x5, 0x1c, 0xf, 0x2, 0xfd, 0xfc, 0x3, 0x2, 
       0x2, 0x2, 0xfd, 0xfe, 0x3, 0x2, 0x2, 0x2, 0xfe, 0x19, 0x3, 0x2, 0x2, 
       0x2, 0xff, 0x100, 0x7, 0x43, 0x2, 0x2, 0x100, 0x101, 0x7, 0x6f, 0x2, 
       0x2, 0x101, 0x102, 0x7, 0x44, 0x2, 0x2, 0x102, 0x107, 0x7, 0x6f, 
       0x2, 0x2, 0x103, 0x104, 0x7, 0x6f, 0x2, 0x2, 0x104, 0x105, 0x7, 0x44, 
       0x2, 0x2, 0x105, 0x107, 0x7, 0x6f, 0x2, 0x2, 0x106, 0xff, 0x3, 0x2, 
       0x2, 0x2, 0x106, 0x103, 0x3, 0x2, 0x2, 0x2, 0x107, 0x1b, 0x3, 0x2, 
       0x2, 0x2, 0x108, 0x109, 0x7, 0x45, 0x2, 0x2, 0x109, 0x10a, 0x7, 0x6f, 
       0x2, 0x2, 0x10a, 0x1d, 0x3, 0x2, 0x2, 0x2, 0x10b, 0x10c, 0x9, 0x4, 
       0x2, 0x2, 0x10c, 0x1f, 0x3, 0x2, 0x2, 0x2, 0x10d, 0x11a, 0x7, 0x41, 
       0x2, 0x2, 0x10e, 0x114, 0x5, 0x22, 0x12, 0x2, 0x10f, 0x110, 0x5, 
       0x24, 0x13, 0x2, 0x110, 0x111, 0x5, 0x22, 0x12, 0x2, 0x111, 0x113, 
       0x3, 0x2, 0x2, 0x2, 0x112, 0x10f, 0x3, 0x2, 0x2, 0x2, 0x113, 0x116, 
       0x3, 0x2, 0x2, 0x2, 0x114, 0x112, 0x3, 0x2, 0x2, 0x2, 0x114, 0x115, 
       0x3, 0x2, 0x2, 0x2, 0x115, 0x118, 0x3, 0x2, 0x2, 0x2, 0x116, 0x114, 
       0x3, 0x2, 0x2, 0x2, 0x117, 0x119, 0x5, 0x24, 0x13, 0x2, 0x118, 0x117, 
       0x3, 0x2, 0x2, 0x2, 0x118, 0x119, 0x3, 0x2, 0x2, 0x2, 0x119, 0x11b, 
       0x3, 0x2, 0x2, 0x2, 0x11a, 0x10e, 0x3, 0x2, 0x2, 0x2, 0x11a, 0x11b, 
       0x3, 0x2, 0x2, 0x2, 0x11b, 0x11c, 0x3, 0x2, 0x2, 0x2, 0x11c, 0x11d, 
       0x7, 0x42, 0x2, 0x2, 0x11d, 0x21, 0x3, 0x2, 0x2, 0x2, 0x11e, 0x11f, 
       0x7, 0x47, 0x2, 0x2, 0x11f, 0x129, 0x7, 0x6f, 0x2, 0x2, 0x120, 0x121, 
       0x7, 0x48, 0x2, 0x2, 0x121, 0x122, 0x7, 0x6f, 0x2, 0x2, 0x122, 0x123, 
       0x7, 0x44, 0x2, 0x2, 0x123, 0x129, 0x7, 0x6f, 0x2, 0x2, 0x124, 0x129, 
       0x7, 0x6f, 0x2, 0x2, 0x125, 0x126, 0x7, 0x6f, 0x2, 0x2, 0x126, 0x127, 
       0x7, 0x44, 0x2, 0x2, 0x127, 0x129, 0x7, 0x6f, 0x2, 0x2, 0x128, 0x11e, 
       0x3, 0x2, 0x2, 0x2, 0x128, 0x120, 0x3, 0x2, 0x2, 0x2, 0x128, 0x124, 
       0x3, 0x2, 0x2, 0x2, 0x128, 0x125, 0x3, 0x2, 0x2, 0x2, 0x129, 0x23, 
       0x3, 0x2, 0x2, 0x2, 0x12a, 0x12b, 0x9, 0x4, 0x2, 0x2, 0x12b, 0x25, 
       0x3, 0x2, 0x2, 0x2, 0x12c, 0x133, 0x5, 0x28, 0x15, 0x2, 0x12d, 0x133, 
       0x5, 0x2e, 0x18, 0x2, 0x12e, 0x133, 0x5, 0x30, 0x19, 0x2, 0x12f, 
       0x133, 0x5, 0x32, 0x1a, 0x2, 0x130, 0x133, 0x5, 0x34, 0x1b, 0x2, 
       0x131, 0x133, 0x5, 0x44, 0x23, 0x2, 0x132, 0x12c, 0x3, 0x2, 0x2, 
       0x2, 0x132, 0x12d, 0x3, 0x2, 0x2, 0x2, 0x132, 0x12e, 0x3, 0x2, 0x2, 
       0x2, 0x132, 0x12f, 0x3, 0x2, 0x2, 0x2, 0x132, 0x130, 0x3, 0x2, 0x2, 
       0x2, 0x132, 0x131, 0x3, 0x2, 0x2, 0x2, 0x133, 0x27, 0x3, 0x2, 0x2, 
       0x2, 0x134, 0x135, 0x7, 0x49, 0x2, 0x2, 0x135, 0x139, 0x7, 0x4, 0x2, 
       0x2, 0x136, 0x138, 0x5, 0x2a, 0x16, 0x2, 0x137, 0x136, 0x3, 0x2, 
       0x2, 0x2, 0x138, 0x13b, 0x3, 0x2, 0x2, 0x2, 0x139, 0x137, 0x3, 0x2, 
       0x2, 0x2, 0x139, 0x13a, 0x3, 0x2, 0x2, 0x2, 0x13a, 0x13c, 0x3, 0x2, 
       0x2, 0x2, 0x13b, 0x139, 0x3, 0x2, 0x2, 0x2, 0x13c, 0x13d, 0x7, 0x5, 
       0x2, 0x2, 0x13d, 0x29, 0x3, 0x2, 0x2, 0x2, 0x13e, 0x13f, 0x7, 0x10, 
       0x2, 0x2, 0x13f, 0x140, 0x7, 0x45, 0x2, 0x2, 0x140, 0x141, 0x5, 0x96, 
       0x4c, 0x2, 0x141, 0x142, 0x7, 0x7, 0x2, 0x2, 0x142, 0x15b, 0x3, 0x2, 
       0x2, 0x2, 0x143, 0x144, 0x7, 0x11, 0x2, 0x2, 0x144, 0x145, 0x7, 0x45, 
       0x2, 0x2, 0x145, 0x146, 0x5, 0x36, 0x1c, 0x2, 0x146, 0x147, 0x7, 
       0x7, 0x2, 0x2, 0x147, 0x15b, 0x3, 0x2, 0x2, 0x2, 0x148, 0x149, 0x7, 
       0xf, 0x2, 0x2, 0x149, 0x14a, 0x7, 0x45, 0x2, 0x2, 0x14a, 0x14b, 0x7, 
       0x6f, 0x2, 0x2, 0x14b, 0x15b, 0x7, 0x7, 0x2, 0x2, 0x14c, 0x14d, 0x7, 
       0x34, 0x2, 0x2, 0x14d, 0x14e, 0x7, 0x45, 0x2, 0x2, 0x14e, 0x14f, 
       0x5, 0xa0, 0x51, 0x2, 0x14f, 0x150, 0x7, 0x7, 0x2, 0x2, 0x150, 0x15b, 
       0x3, 0x2, 0x2, 0x2, 0x151, 0x152, 0x7, 0x8, 0x2, 0x2, 0x152, 0x153, 
       0x7, 0x45, 0x2, 0x2, 0x153, 0x154, 0x7, 0x6f, 0x2, 0x2, 0x154, 0x15b, 
       0x7, 0x7, 0x2, 0x2, 0x155, 0x156, 0x7, 0x12, 0x2, 0x2, 0x156, 0x157, 
       0x7, 0x45, 0x2, 0x2, 0x157, 0x158, 0x5, 0x2c, 0x17, 0x2, 0x158, 0x159, 
       0x7, 0x7, 0x2, 0x2, 0x159, 0x15b, 0x3, 0x2, 0x2, 0x2, 0x15a, 0x13e, 
       0x3, 0x2, 0x2, 0x2, 0x15a, 0x143, 0x3, 0x2, 0x2, 0x2, 0x15a, 0x148, 
       0x3, 0x2, 0x2, 0x2, 0x15a, 0x14c, 0x3, 0x2, 0x2, 0x2, 0x15a, 0x151, 
       0x3, 0x2, 0x2, 0x2, 0x15a, 0x155, 0x3, 0x2, 0x2, 0x2, 0x15b, 0x2b, 
       0x3, 0x2, 0x2, 0x2, 0x15c, 0x161, 0x5, 0x9a, 0x4e, 0x2, 0x15d, 0x15e, 
       0x7, 0x4a, 0x2, 0x2, 0x15e, 0x160, 0x5, 0x9a, 0x4e, 0x2, 0x15f, 0x15d, 
       0x3, 0x2, 0x2, 0x2, 0x160, 0x163, 0x3, 0x2, 0x2, 0x2, 0x161, 0x15f, 
       0x3, 0x2, 0x2, 0x2, 0x161, 0x162, 0x3, 0x2, 0x2, 0x2, 0x162, 0x2d, 
       0x3, 0x2, 0x2, 0x2, 0x163, 0x161, 0x3, 0x2, 0x2, 0x2, 0x164, 0x165, 
       0x7, 0x4b, 0x2, 0x2, 0x165, 0x166, 0x7, 0x3e, 0x2, 0x2, 0x166, 0x167, 
       0x5, 0x36, 0x1c, 0x2, 0x167, 0x169, 0x7, 0x3f, 0x2, 0x2, 0x168, 0x16a, 
       0x5, 0xa, 0x6, 0x2, 0x169, 0x168, 0x3, 0x2, 0x2, 0x2, 0x169, 0x16a, 
       0x3, 0x2, 0x2, 0x2, 0x16a, 0x16b, 0x3, 0x2, 0x2, 0x2, 0x16b, 0x16c, 
       0x7, 0x4, 0x2, 0x2, 0x16c, 0x16d, 0x5, 0x3a, 0x1e, 0x2, 0x16d, 0x16e, 
       0x7, 0x5, 0x2, 0x2, 0x16e, 0x2f, 0x3, 0x2, 0x2, 0x2, 0x16f, 0x170, 
       0x7, 0x4c, 0x2, 0x2, 0x170, 0x171, 0x7, 0x3e, 0x2, 0x2, 0x171, 0x172, 
       0x5, 0x36, 0x1c, 0x2, 0x172, 0x174, 0x7, 0x3f, 0x2, 0x2, 0x173, 0x175, 
       0x5, 0xa, 0x6, 0x2, 0x174, 0x173, 0x3, 0x2, 0x2, 0x2, 0x174, 0x175, 
       0x3, 0x2, 0x2, 0x2, 0x175, 0x176, 0x3, 0x2, 0x2, 0x2, 0x176, 0x177, 
       0x7, 0x4, 0x2, 0x2, 0x177, 0x178, 0x5, 0x3c, 0x1f, 0x2, 0x178, 0x179, 
       0x7, 0x5, 0x2, 0x2, 0x179, 0x31, 0x3, 0x2, 0x2, 0x2, 0x17a, 0x17b, 
       0x7, 0x4d, 0x2, 0x2, 0x17b, 0x17c, 0x7, 0x3e, 0x2, 0x2, 0x17c, 0x17d, 
       0x5, 0x36, 0x1c, 0x2, 0x17d, 0x17f, 0x7, 0x3f, 0x2, 0x2, 0x17e, 0x180, 
       0x5, 0xa, 0x6, 0x2, 0x17f, 0x17e, 0x3, 0x2, 0x2, 0x2, 0x17f, 0x180, 
       0x3, 0x2, 0x2, 0x2, 0x180, 0x181, 0x3, 0x2, 0x2, 0x2, 0x181, 0x182, 
       0x7, 0x4, 0x2, 0x2, 0x182, 0x183, 0x5, 0x3e, 0x20, 0x2, 0x183, 0x184, 
       0x7, 0x5, 0x2, 0x2, 0x184, 0x33, 0x3, 0x2, 0x2, 0x2, 0x185, 0x186, 
       0x7, 0x4e, 0x2, 0x2, 0x186, 0x187, 0x7, 0x3e, 0x2, 0x2, 0x187, 0x188, 
       0x5, 0xc, 0x7, 0x2, 0x188, 0x18a, 0x7, 0x3f, 0x2, 0x2, 0x189, 0x18b, 
       0x5, 0xa, 0x6, 0x2, 0x18a, 0x189, 0x3, 0x2, 0x2, 0x2, 0x18a, 0x18b, 
       0x3, 0x2, 0x2, 0x2, 0x18b, 0x18c, 0x3, 0x2, 0x2, 0x2, 0x18c, 0x18d, 
       0x7, 0x4, 0x2, 0x2, 0x18d, 0x18e, 0x5, 0x42, 0x22, 0x2, 0x18e, 0x18f, 
       0x7, 0x5, 0x2, 0x2, 0x18f, 0x35, 0x3, 0x2, 0x2, 0x2, 0x190, 0x195, 
       0x5, 0xa, 0x6, 0x2, 0x191, 0x192, 0x7, 0x4a, 0x2, 0x2, 0x192, 0x194, 
       0x5, 0xa, 0x6, 0x2, 0x193, 0x191, 0x3, 0x2, 0x2, 0x2, 0x194, 0x197, 
       0x3, 0x2, 0x2, 0x2, 0x195, 0x193, 0x3, 0x2, 0x2, 0x2, 0x195, 0x196, 
       0x3, 0x2, 0x2, 0x2, 0x196, 0x37, 0x3, 0x2, 0x2, 0x2, 0x197, 0x195, 
       0x3, 0x2, 0x2, 0x2, 0x198, 0x19a, 0x5, 0xa, 0x6, 0x2, 0x199, 0x198, 
       0x3, 0x2, 0x2, 0x2, 0x19a, 0x19b, 0x3, 0x2, 0x2, 0x2, 0x19b, 0x199, 
       0x3, 0x2, 0x2, 0x2, 0x19b, 0x19c, 0x3, 0x2, 0x2, 0x2, 0x19c, 0x39, 
       0x3, 0x2, 0x2, 0x2, 0x19d, 0x19e, 0x7, 0xa, 0x2, 0x2, 0x19e, 0x19f, 
       0x7, 0x45, 0x2, 0x2, 0x19f, 0x1a0, 0x5, 0x96, 0x4c, 0x2, 0x1a0, 0x1a1, 
       0x7, 0x7, 0x2, 0x2, 0x1a1, 0x1a2, 0x7, 0xb, 0x2, 0x2, 0x1a2, 0x1a3, 
       0x7, 0x45, 0x2, 0x2, 0x1a3, 0x1a4, 0x5, 0x96, 0x4c, 0x2, 0x1a4, 0x1a5, 
       0x7, 0x7, 0x2, 0x2, 0x1a5, 0x1a6, 0x7, 0xc, 0x2, 0x2, 0x1a6, 0x1a7, 
       0x7, 0x45, 0x2, 0x2, 0x1a7, 0x1a8, 0x5, 0x40, 0x21, 0x2, 0x1a8, 0x1ae, 
       0x7, 0x7, 0x2, 0x2, 0x1a9, 0x1aa, 0x7, 0x12, 0x2, 0x2, 0x1aa, 0x1ab, 
       0x7, 0x45, 0x2, 0x2, 0x1ab, 0x1ac, 0x5, 0x2c, 0x17, 0x2, 0x1ac, 0x1ad, 
       0x7, 0x7, 0x2, 0x2, 0x1ad, 0x1af, 0x3, 0x2, 0x2, 0x2, 0x1ae, 0x1a9, 
       0x3, 0x2, 0x2, 0x2, 0x1ae, 0x1af, 0x3, 0x2, 0x2, 0x2, 0x1af, 0x1b4, 
       0x3, 0x2, 0x2, 0x2, 0x1b0, 0x1b1, 0x7, 0xf, 0x2, 0x2, 0x1b1, 0x1b2, 
       0x7, 0x45, 0x2, 0x2, 0x1b2, 0x1b3, 0x7, 0x6f, 0x2, 0x2, 0x1b3, 0x1b5, 
       0x7, 0x7, 0x2, 0x2, 0x1b4, 0x1b0, 0x3, 0x2, 0x2, 0x2, 0x1b4, 0x1b5, 
       0x3, 0x2, 0x2, 0x2, 0x1b5, 0x3b, 0x3, 0x2, 0x2, 0x2, 0x1b6, 0x1b7, 
       0x7, 0xa, 0x2, 0x2, 0x1b7, 0x1b8, 0x7, 0x45, 0x2, 0x2, 0x1b8, 0x1b9, 
       0x5, 0x96, 0x4c, 0x2, 0x1b9, 0x1ba, 0x7, 0x7, 0x2, 0x2, 0x1ba, 0x1bb, 
       0x7, 0xb, 0x2, 0x2, 0x1bb, 0x1bc, 0x7, 0x45, 0x2, 0x2, 0x1bc, 0x1bd, 
       0x5, 0x96, 0x4c, 0x2, 0x1bd, 0x1be, 0x7, 0x7, 0x2, 0x2, 0x1be, 0x1bf, 
       0x7, 0xc, 0x2, 0x2, 0x1bf, 0x1c0, 0x7, 0x45, 0x2, 0x2, 0x1c0, 0x1c1, 
       0x5, 0x40, 0x21, 0x2, 0x1c1, 0x1c2, 0x7, 0x7, 0x2, 0x2, 0x1c2, 0x1c3, 
       0x7, 0xd, 0x2, 0x2, 0x1c3, 0x1c4, 0x7, 0x45, 0x2, 0x2, 0x1c4, 0x1c5, 
       0x5, 0x40, 0x21, 0x2, 0x1c5, 0x1cb, 0x7, 0x7, 0x2, 0x2, 0x1c6, 0x1c7, 
       0x7, 0x12, 0x2, 0x2, 0x1c7, 0x1c8, 0x7, 0x45, 0x2, 0x2, 0x1c8, 0x1c9, 
       0x5, 0x2c, 0x17, 0x2, 0x1c9, 0x1ca, 0x7, 0x7, 0x2, 0x2, 0x1ca, 0x1cc, 
       0x3, 0x2, 0x2, 0x2, 0x1cb, 0x1c6, 0x3, 0x2, 0x2, 0x2, 0x1cb, 0x1cc, 
       0x3, 0x2, 0x2, 0x2, 0x1cc, 0x1d1, 0x3, 0x2, 0x2, 0x2, 0x1cd, 0x1ce, 
       0x7, 0xf, 0x2, 0x2, 0x1ce, 0x1cf, 0x7, 0x45, 0x2, 0x2, 0x1cf, 0x1d0, 
       0x7, 0x6f, 0x2, 0x2, 0x1d0, 0x1d2, 0x7, 0x7, 0x2, 0x2, 0x1d1, 0x1cd, 
       0x3, 0x2, 0x2, 0x2, 0x1d1, 0x1d2, 0x3, 0x2, 0x2, 0x2, 0x1d2, 0x3d, 
       0x3, 0x2, 0x2, 0x2, 0x1d3, 0x1d4, 0x7, 0xa, 0x2, 0x2, 0x1d4, 0x1d5, 
       0x7, 0x45, 0x2, 0x2, 0x1d5, 0x1d6, 0x5, 0x96, 0x4c, 0x2, 0x1d6, 0x1d7, 
       0x7, 0x7, 0x2, 0x2, 0x1d7, 0x1d8, 0x7, 0xc, 0x2, 0x2, 0x1d8, 0x1d9, 
       0x7, 0x45, 0x2, 0x2, 0x1d9, 0x1da, 0x5, 0x40, 0x21, 0x2, 0x1da, 0x1df, 
       0x7, 0x7, 0x2, 0x2, 0x1db, 0x1dc, 0x7, 0xf, 0x2, 0x2, 0x1dc, 0x1dd, 
       0x7, 0x45, 0x2, 0x2, 0x1dd, 0x1de, 0x7, 0x6f, 0x2, 0x2, 0x1de, 0x1e0, 
       0x7, 0x7, 0x2, 0x2, 0x1df, 0x1db, 0x3, 0x2, 0x2, 0x2, 0x1df, 0x1e0, 
       0x3, 0x2, 0x2, 0x2, 0x1e0, 0x3f, 0x3, 0x2, 0x2, 0x2, 0x1e1, 0x1e6, 
       0x5, 0x98, 0x4d, 0x2, 0x1e2, 0x1e3, 0x7, 0x4a, 0x2, 0x2, 0x1e3, 0x1e5, 
       0x5, 0x98, 0x4d, 0x2, 0x1e4, 0x1e2, 0x3, 0x2, 0x2, 0x2, 0x1e5, 0x1e8, 
       0x3, 0x2, 0x2, 0x2, 0x1e6, 0x1e4, 0x3, 0x2, 0x2, 0x2, 0x1e6, 0x1e7, 
       0x3, 0x2, 0x2, 0x2, 0x1e7, 0x1f2, 0x3, 0x2, 0x2, 0x2, 0x1e8, 0x1e6, 
       0x3, 0x2, 0x2, 0x2, 0x1e9, 0x1ee, 0x5, 0xa, 0x6, 0x2, 0x1ea, 0x1eb, 
       0x7, 0x4a, 0x2, 0x2, 0x1eb, 0x1ed, 0x5, 0xa, 0x6, 0x2, 0x1ec, 0x1ea, 
       0x3, 0x2, 0x2, 0x2, 0x1ed, 0x1f0, 0x3, 0x2, 0x2, 0x2, 0x1ee, 0x1ec, 
       0x3, 0x2, 0x2, 0x2, 0x1ee, 0x1ef, 0x3, 0x2, 0x2, 0x2, 0x1ef, 0x1f2, 
       0x3, 0x2, 0x2, 0x2, 0x1f0, 0x1ee, 0x3, 0x2, 0x2, 0x2, 0x1f1, 0x1e1, 
       0x3, 0x2, 0x2, 0x2, 0x1f1, 0x1e9, 0x3, 0x2, 0x2, 0x2, 0x1f2, 0x41, 
       0x3, 0x2, 0x2, 0x2, 0x1f3, 0x1f4, 0x7, 0xe, 0x2, 0x2, 0x1f4, 0x1f5, 
       0x7, 0x45, 0x2, 0x2, 0x1f5, 0x1f6, 0x5, 0x9c, 0x4f, 0x2, 0x1f6, 0x200, 
       0x7, 0x7, 0x2, 0x2, 0x1f7, 0x1f8, 0x7, 0x9, 0x2, 0x2, 0x1f8, 0x1f9, 
       0x7, 0x45, 0x2, 0x2, 0x1f9, 0x1fa, 0x7, 0x6f, 0x2, 0x2, 0x1fa, 0x201, 
       0x7, 0x7, 0x2, 0x2, 0x1fb, 0x1fc, 0x7, 0x8, 0x2, 0x2, 0x1fc, 0x1fd, 
       0x7, 0x45, 0x2, 0x2, 0x1fd, 0x1fe, 0x5, 0x96, 0x4c, 0x2, 0x1fe, 0x1ff, 
       0x7, 0x7, 0x2, 0x2, 0x1ff, 0x201, 0x3, 0x2, 0x2, 0x2, 0x200, 0x1f7, 
       0x3, 0x2, 0x2, 0x2, 0x200, 0x1fb, 0x3, 0x2, 0x2, 0x2, 0x201, 0x202, 
       0x3, 0x2, 0x2, 0x2, 0x202, 0x203, 0x7, 0xa, 0x2, 0x2, 0x203, 0x204, 
       0x7, 0x45, 0x2, 0x2, 0x204, 0x205, 0x5, 0x96, 0x4c, 0x2, 0x205, 0x206, 
       0x7, 0x7, 0x2, 0x2, 0x206, 0x207, 0x7, 0xb, 0x2, 0x2, 0x207, 0x208, 
       0x7, 0x45, 0x2, 0x2, 0x208, 0x209, 0x5, 0x96, 0x4c, 0x2, 0x209, 0x20e, 
       0x7, 0x7, 0x2, 0x2, 0x20a, 0x20b, 0x7, 0xf, 0x2, 0x2, 0x20b, 0x20c, 
       0x7, 0x45, 0x2, 0x2, 0x20c, 0x20d, 0x7, 0x6f, 0x2, 0x2, 0x20d, 0x20f, 
       0x7, 0x7, 0x2, 0x2, 0x20e, 0x20a, 0x3, 0x2, 0x2, 0x2, 0x20e, 0x20f, 
       0x3, 0x2, 0x2, 0x2, 0x20f, 0x43, 0x3, 0x2, 0x2, 0x2, 0x210, 0x212, 
       0x7, 0xa, 0x2, 0x2, 0x211, 0x213, 0x5, 0x46, 0x24, 0x2, 0x212, 0x211, 
       0x3, 0x2, 0x2, 0x2, 0x212, 0x213, 0x3, 0x2, 0x2, 0x2, 0x213, 0x214, 
       0x3, 0x2, 0x2, 0x2, 0x214, 0x218, 0x7, 0x4, 0x2, 0x2, 0x215, 0x217, 
       0x5, 0x48, 0x25, 0x2, 0x216, 0x215, 0x3, 0x2, 0x2, 0x2, 0x217, 0x21a, 
       0x3, 0x2, 0x2, 0x2, 0x218, 0x216, 0x3, 0x2, 0x2, 0x2, 0x218, 0x219, 
       0x3, 0x2, 0x2, 0x2, 0x219, 0x21b, 0x3, 0x2, 0x2, 0x2, 0x21a, 0x218, 
       0x3, 0x2, 0x2, 0x2, 0x21b, 0x21c, 0x7, 0x5, 0x2, 0x2, 0x21c, 0x45, 
       0x3, 0x2, 0x2, 0x2, 0x21d, 0x21e, 0x5, 0xa, 0x6, 0x2, 0x21e, 0x47, 
       0x3, 0x2, 0x2, 0x2, 0x21f, 0x220, 0x7, 0x13, 0x2, 0x2, 0x220, 0x221, 
       0x7, 0x45, 0x2, 0x2, 0x221, 0x22c, 0x5, 0x4a, 0x26, 0x2, 0x222, 0x223, 
       0x7, 0x11, 0x2, 0x2, 0x223, 0x224, 0x7, 0x45, 0x2, 0x2, 0x224, 0x225, 
       0x5, 0x38, 0x1d, 0x2, 0x225, 0x226, 0x7, 0x7, 0x2, 0x2, 0x226, 0x22c, 
       0x3, 0x2, 0x2, 0x2, 0x227, 0x228, 0x7, 0xf, 0x2, 0x2, 0x228, 0x229, 
       0x7, 0x45, 0x2, 0x2, 0x229, 0x22a, 0x7, 0x6f, 0x2, 0x2, 0x22a, 0x22c, 
       0x7, 0x7, 0x2, 0x2, 0x22b, 0x21f, 0x3, 0x2, 0x2, 0x2, 0x22b, 0x222, 
       0x3, 0x2, 0x2, 0x2, 0x22b, 0x227, 0x3, 0x2, 0x2, 0x2, 0x22c, 0x49, 
       0x3, 0x2, 0x2, 0x2, 0x22d, 0x232, 0x5, 0x4c, 0x27, 0x2, 0x22e, 0x22f, 
       0x7, 0x4a, 0x2, 0x2, 0x22f, 0x231, 0x5, 0x4c, 0x27, 0x2, 0x230, 0x22e, 
       0x3, 0x2, 0x2, 0x2, 0x231, 0x234, 0x3, 0x2, 0x2, 0x2, 0x232, 0x230, 
       0x3, 0x2, 0x2, 0x2, 0x232, 0x233, 0x3, 0x2, 0x2, 0x2, 0x233, 0x4b, 
       0x3, 0x2, 0x2, 0x2, 0x234, 0x232, 0x3, 0x2, 0x2, 0x2, 0x235, 0x249, 
       0x7, 0x41, 0x2, 0x2, 0x236, 0x23b, 0x5, 0x4e, 0x28, 0x2, 0x237, 0x238, 
       0x7, 0x7, 0x2, 0x2, 0x238, 0x23a, 0x5, 0x4e, 0x28, 0x2, 0x239, 0x237, 
       0x3, 0x2, 0x2, 0x2, 0x23a, 0x23d, 0x3, 0x2, 0x2, 0x2, 0x23b, 0x239, 
       0x3, 0x2, 0x2, 0x2, 0x23b, 0x23c, 0x3, 0x2, 0x2, 0x2, 0x23c, 0x23f, 
       0x3, 0x2, 0x2, 0x2, 0x23d, 0x23b, 0x3, 0x2, 0x2, 0x2, 0x23e, 0x240, 
       0x7, 0x7, 0x2, 0x2, 0x23f, 0x23e, 0x3, 0x2, 0x2, 0x2, 0x23f, 0x240, 
       0x3, 0x2, 0x2, 0x2, 0x240, 0x24a, 0x3, 0x2, 0x2, 0x2, 0x241, 0x246, 
       0x5, 0x50, 0x29, 0x2, 0x242, 0x243, 0x7, 0x46, 0x2, 0x2, 0x243, 0x245, 
       0x5, 0x50, 0x29, 0x2, 0x244, 0x242, 0x3, 0x2, 0x2, 0x2, 0x245, 0x248, 
       0x3, 0x2, 0x2, 0x2, 0x246, 0x244, 0x3, 0x2, 0x2, 0x2, 0x246, 0x247, 
       0x3, 0x2, 0x2, 0x2, 0x247, 0x24a, 0x3, 0x2, 0x2, 0x2, 0x248, 0x246, 
       0x3, 0x2, 0x2, 0x2, 0x249, 0x236, 0x3, 0x2, 0x2, 0x2, 0x249, 0x241, 
       0x3, 0x2, 0x2, 0x2, 0x24a, 0x24b, 0x3, 0x2, 0x2, 0x2, 0x24b, 0x24c, 
       0x7, 0x42, 0x2, 0x2, 0x24c, 0x4d, 0x3, 0x2, 0x2, 0x2, 0x24d, 0x24e, 
       0x7, 0x4f, 0x2, 0x2, 0x24e, 0x24f, 0x7, 0x45, 0x2, 0x2, 0x24f, 0x26f, 
       0x5, 0x92, 0x4a, 0x2, 0x250, 0x251, 0x7, 0x50, 0x2, 0x2, 0x251, 0x252, 
       0x7, 0x45, 0x2, 0x2, 0x252, 0x26f, 0x5, 0x94, 0x4b, 0x2, 0x253, 0x254, 
       0x7, 0x51, 0x2, 0x2, 0x254, 0x255, 0x7, 0x45, 0x2, 0x2, 0x255, 0x26f, 
       0x5, 0x94, 0x4b, 0x2, 0x256, 0x257, 0x7, 0x28, 0x2, 0x2, 0x257, 0x258, 
       0x7, 0x45, 0x2, 0x2, 0x258, 0x26f, 0x5, 0x92, 0x4a, 0x2, 0x259, 0x25a, 
       0x7, 0x52, 0x2, 0x2, 0x25a, 0x25b, 0x7, 0x45, 0x2, 0x2, 0x25b, 0x26f, 
       0x5, 0x92, 0x4a, 0x2, 0x25c, 0x25d, 0x7, 0x53, 0x2, 0x2, 0x25d, 0x25e, 
       0x7, 0x45, 0x2, 0x2, 0x25e, 0x26f, 0x5, 0x92, 0x4a, 0x2, 0x25f, 0x260, 
       0x7, 0x54, 0x2, 0x2, 0x260, 0x261, 0x7, 0x45, 0x2, 0x2, 0x261, 0x26f, 
       0x5, 0x92, 0x4a, 0x2, 0x262, 0x263, 0x7, 0x55, 0x2, 0x2, 0x263, 0x264, 
       0x7, 0x45, 0x2, 0x2, 0x264, 0x26f, 0x7, 0x6f, 0x2, 0x2, 0x265, 0x266, 
       0x7, 0x56, 0x2, 0x2, 0x266, 0x267, 0x7, 0x45, 0x2, 0x2, 0x267, 0x26f, 
       0x7, 0x6f, 0x2, 0x2, 0x268, 0x269, 0x7, 0x23, 0x2, 0x2, 0x269, 0x26a, 
       0x7, 0x45, 0x2, 0x2, 0x26a, 0x26f, 0x7, 0x6f, 0x2, 0x2, 0x26b, 0x26c, 
       0x7, 0x57, 0x2, 0x2, 0x26c, 0x26d, 0x7, 0x45, 0x2, 0x2, 0x26d, 0x26f, 
       0x7, 0x6f, 0x2, 0x2, 0x26e, 0x24d, 0x3, 0x2, 0x2, 0x2, 0x26e, 0x250, 
       0x3, 0x2, 0x2, 0x2, 0x26e, 0x253, 0x3, 0x2, 0x2, 0x2, 0x26e, 0x256, 
       0x3, 0x2, 0x2, 0x2, 0x26e, 0x259, 0x3, 0x2, 0x2, 0x2, 0x26e, 0x25c, 
       0x3, 0x2, 0x2, 0x2, 0x26e, 0x25f, 0x3, 0x2, 0x2, 0x2, 0x26e, 0x262, 
       0x3, 0x2, 0x2, 0x2, 0x26e, 0x265, 0x3, 0x2, 0x2, 0x2, 0x26e, 0x268, 
       0x3, 0x2, 0x2, 0x2, 0x26e, 0x26b, 0x3, 0x2, 0x2, 0x2, 0x26f, 0x4f, 
       0x3, 0x2, 0x2, 0x2, 0x270, 0x273, 0x5, 0x92, 0x4a, 0x2, 0x271, 0x273, 
       0x7, 0x6f, 0x2, 0x2, 0x272, 0x270, 0x3, 0x2, 0x2, 0x2, 0x272, 0x271, 
       0x3, 0x2, 0x2, 0x2, 0x273, 0x51, 0x3, 0x2, 0x2, 0x2, 0x274, 0x275, 
       0x7, 0x58, 0x2, 0x2, 0x275, 0x276, 0x5, 0xa, 0x6, 0x2, 0x276, 0x277, 
       0x7, 0x4, 0x2, 0x2, 0x277, 0x278, 0x7, 0x5, 0x2, 0x2, 0x278, 0x53, 
       0x3, 0x2, 0x2, 0x2, 0x279, 0x27a, 0x7, 0x25, 0x2, 0x2, 0x27a, 0x27b, 
       0x5, 0xa, 0x6, 0x2, 0x27b, 0x27c, 0x7, 0x4, 0x2, 0x2, 0x27c, 0x27d, 
       0x5, 0x56, 0x2c, 0x2, 0x27d, 0x27e, 0x7, 0x5, 0x2, 0x2, 0x27e, 0x55, 
       0x3, 0x2, 0x2, 0x2, 0x27f, 0x282, 0x5, 0x58, 0x2d, 0x2, 0x280, 0x282, 
       0x5, 0x5a, 0x2e, 0x2, 0x281, 0x27f, 0x3, 0x2, 0x2, 0x2, 0x281, 0x280, 
       0x3, 0x2, 0x2, 0x2, 0x282, 0x57, 0x3, 0x2, 0x2, 0x2, 0x283, 0x284, 
       0x7, 0x24, 0x2, 0x2, 0x284, 0x285, 0x5, 0x5c, 0x2f, 0x2, 0x285, 0x286, 
       0x7, 0x7, 0x2, 0x2, 0x286, 0x59, 0x3, 0x2, 0x2, 0x2, 0x287, 0x288, 
       0x7, 0x29, 0x2, 0x2, 0x288, 0x289, 0x5, 0x5c, 0x2f, 0x2, 0x289, 0x28d, 
       0x7, 0x4, 0x2, 0x2, 0x28a, 0x28c, 0x5, 0x5e, 0x30, 0x2, 0x28b, 0x28a, 
       0x3, 0x2, 0x2, 0x2, 0x28c, 0x28f, 0x3, 0x2, 0x2, 0x2, 0x28d, 0x28b, 
       0x3, 0x2, 0x2, 0x2, 0x28d, 0x28e, 0x3, 0x2, 0x2, 0x2, 0x28e, 0x290, 
       0x3, 0x2, 0x2, 0x2, 0x28f, 0x28d, 0x3, 0x2, 0x2, 0x2, 0x290, 0x291, 
       0x7, 0x5, 0x2, 0x2, 0x291, 0x5b, 0x3, 0x2, 0x2, 0x2, 0x292, 0x29c, 
       0x5, 0xa, 0x6, 0x2, 0x293, 0x296, 0x7, 0x59, 0x2, 0x2, 0x294, 0x297, 
       0x5, 0xa, 0x6, 0x2, 0x295, 0x297, 0x7, 0x6f, 0x2, 0x2, 0x296, 0x294, 
       0x3, 0x2, 0x2, 0x2, 0x296, 0x295, 0x3, 0x2, 0x2, 0x2, 0x297, 0x298, 
       0x3, 0x2, 0x2, 0x2, 0x298, 0x296, 0x3, 0x2, 0x2, 0x2, 0x298, 0x299, 
       0x3, 0x2, 0x2, 0x2, 0x299, 0x29b, 0x3, 0x2, 0x2, 0x2, 0x29a, 0x293, 
       0x3, 0x2, 0x2, 0x2, 0x29b, 0x29e, 0x3, 0x2, 0x2, 0x2, 0x29c, 0x29a, 
       0x3, 0x2, 0x2, 0x2, 0x29c, 0x29d, 0x3, 0x2, 0x2, 0x2, 0x29d, 0x5d, 
       0x3, 0x2, 0x2, 0x2, 0x29e, 0x29c, 0x3, 0x2, 0x2, 0x2, 0x29f, 0x2a0, 
       0x7, 0x2a, 0x2, 0x2, 0x2a0, 0x2a1, 0x7, 0x45, 0x2, 0x2, 0x2a1, 0x2a2, 
       0x5, 0x60, 0x31, 0x2, 0x2a2, 0x2a3, 0x7, 0x7, 0x2, 0x2, 0x2a3, 0x2b7, 
       0x3, 0x2, 0x2, 0x2, 0x2a4, 0x2a5, 0x7, 0x2b, 0x2, 0x2, 0x2a5, 0x2a6, 
       0x7, 0x45, 0x2, 0x2, 0x2a6, 0x2a7, 0x7, 0x6f, 0x2, 0x2, 0x2a7, 0x2b7, 
       0x7, 0x7, 0x2, 0x2, 0x2a8, 0x2a9, 0x7, 0x2c, 0x2, 0x2, 0x2a9, 0x2aa, 
       0x7, 0x45, 0x2, 0x2, 0x2aa, 0x2ab, 0x5, 0x82, 0x42, 0x2, 0x2ab, 0x2ac, 
       0x7, 0x7, 0x2, 0x2, 0x2ac, 0x2b7, 0x3, 0x2, 0x2, 0x2, 0x2ad, 0x2ae, 
       0x7, 0x9, 0x2, 0x2, 0x2ae, 0x2af, 0x7, 0x45, 0x2, 0x2, 0x2af, 0x2b0, 
       0x7, 0x6f, 0x2, 0x2, 0x2b0, 0x2b7, 0x7, 0x7, 0x2, 0x2, 0x2b1, 0x2b2, 
       0x7, 0x19, 0x2, 0x2, 0x2b2, 0x2b3, 0x7, 0x45, 0x2, 0x2, 0x2b3, 0x2b4, 
       0x5, 0x82, 0x42, 0x2, 0x2b4, 0x2b5, 0x7, 0x7, 0x2, 0x2, 0x2b5, 0x2b7, 
       0x3, 0x2, 0x2, 0x2, 0x2b6, 0x29f, 0x3, 0x2, 0x2, 0x2, 0x2b6, 0x2a4, 
       0x3, 0x2, 0x2, 0x2, 0x2b6, 0x2a8, 0x3, 0x2, 0x2, 0x2, 0x2b6, 0x2ad, 
       0x3, 0x2, 0x2, 0x2, 0x2b6, 0x2b1, 0x3, 0x2, 0x2, 0x2, 0x2b7, 0x5f, 
       0x3, 0x2, 0x2, 0x2, 0x2b8, 0x2b9, 0x9, 0x5, 0x2, 0x2, 0x2b9, 0x61, 
       0x3, 0x2, 0x2, 0x2, 0x2ba, 0x2bb, 0x7, 0x26, 0x2, 0x2, 0x2bb, 0x2bc, 
       0x5, 0x5c, 0x2f, 0x2, 0x2bc, 0x2be, 0x7, 0x4, 0x2, 0x2, 0x2bd, 0x2bf, 
       0x5, 0x64, 0x33, 0x2, 0x2be, 0x2bd, 0x3, 0x2, 0x2, 0x2, 0x2bf, 0x2c0, 
       0x3, 0x2, 0x2, 0x2, 0x2c0, 0x2be, 0x3, 0x2, 0x2, 0x2, 0x2c0, 0x2c1, 
       0x3, 0x2, 0x2, 0x2, 0x2c1, 0x2c2, 0x3, 0x2, 0x2, 0x2, 0x2c2, 0x2c3, 
       0x7, 0x5, 0x2, 0x2, 0x2c3, 0x63, 0x3, 0x2, 0x2, 0x2, 0x2c4, 0x2c5, 
       0x7, 0x25, 0x2, 0x2, 0x2c5, 0x2c6, 0x5, 0x5c, 0x2f, 0x2, 0x2c6, 0x2c7, 
       0x7, 0x7, 0x2, 0x2, 0x2c7, 0x65, 0x3, 0x2, 0x2, 0x2, 0x2c8, 0x2c9, 
       0x7, 0x27, 0x2, 0x2, 0x2c9, 0x2ca, 0x5, 0x5c, 0x2f, 0x2, 0x2ca, 0x2cc, 
       0x7, 0x4, 0x2, 0x2, 0x2cb, 0x2cd, 0x5, 0x68, 0x35, 0x2, 0x2cc, 0x2cb, 
       0x3, 0x2, 0x2, 0x2, 0x2cd, 0x2ce, 0x3, 0x2, 0x2, 0x2, 0x2ce, 0x2cc, 
       0x3, 0x2, 0x2, 0x2, 0x2ce, 0x2cf, 0x3, 0x2, 0x2, 0x2, 0x2cf, 0x2d0, 
       0x3, 0x2, 0x2, 0x2, 0x2d0, 0x2d1, 0x7, 0x5, 0x2, 0x2, 0x2d1, 0x67, 
       0x3, 0x2, 0x2, 0x2, 0x2d2, 0x2d3, 0x7, 0x26, 0x2, 0x2, 0x2d3, 0x2d4, 
       0x5, 0x5c, 0x2f, 0x2, 0x2d4, 0x69, 0x3, 0x2, 0x2, 0x2, 0x2d5, 0x2d6, 
       0x7, 0x28, 0x2, 0x2, 0x2d6, 0x2d7, 0x5, 0x5c, 0x2f, 0x2, 0x2d7, 0x2d9, 
       0x7, 0x4, 0x2, 0x2, 0x2d8, 0x2da, 0x5, 0x6c, 0x37, 0x2, 0x2d9, 0x2d8, 
       0x3, 0x2, 0x2, 0x2, 0x2da, 0x2db, 0x3, 0x2, 0x2, 0x2, 0x2db, 0x2d9, 
       0x3, 0x2, 0x2, 0x2, 0x2db, 0x2dc, 0x3, 0x2, 0x2, 0x2, 0x2dc, 0x2dd, 
       0x3, 0x2, 0x2, 0x2, 0x2dd, 0x2de, 0x7, 0x5, 0x2, 0x2, 0x2de, 0x6b, 
       0x3, 0x2, 0x2, 0x2, 0x2df, 0x2e0, 0x7, 0x27, 0x2, 0x2, 0x2e0, 0x2e1, 
       0x5, 0x5c, 0x2f, 0x2, 0x2e1, 0x2e2, 0x7, 0x7, 0x2, 0x2, 0x2e2, 0x6d, 
       0x3, 0x2, 0x2, 0x2, 0x2e3, 0x2e4, 0x7, 0x35, 0x2, 0x2, 0x2e4, 0x2e5, 
       0x5, 0x5c, 0x2f, 0x2, 0x2e5, 0x2e7, 0x7, 0x4, 0x2, 0x2, 0x2e6, 0x2e8, 
       0x5, 0x70, 0x39, 0x2, 0x2e7, 0x2e6, 0x3, 0x2, 0x2, 0x2, 0x2e8, 0x2e9, 
       0x3, 0x2, 0x2, 0x2, 0x2e9, 0x2e7, 0x3, 0x2, 0x2, 0x2, 0x2e9, 0x2ea, 
       0x3, 0x2, 0x2, 0x2, 0x2ea, 0x2eb, 0x3, 0x2, 0x2, 0x2, 0x2eb, 0x2ec, 
       0x7, 0x5, 0x2, 0x2, 0x2ec, 0x6f, 0x3, 0x2, 0x2, 0x2, 0x2ed, 0x2f0, 
       0x5, 0x72, 0x3a, 0x2, 0x2ee, 0x2f0, 0x5, 0x74, 0x3b, 0x2, 0x2ef, 
       0x2ed, 0x3, 0x2, 0x2, 0x2, 0x2ef, 0x2ee, 0x3, 0x2, 0x2, 0x2, 0x2f0, 
       0x71, 0x3, 0x2, 0x2, 0x2, 0x2f1, 0x2f2, 0x7, 0x36, 0x2, 0x2, 0x2f2, 
       0x2f6, 0x7, 0x4, 0x2, 0x2, 0x2f3, 0x2f5, 0x5, 0x70, 0x39, 0x2, 0x2f4, 
       0x2f3, 0x3, 0x2, 0x2, 0x2, 0x2f5, 0x2f8, 0x3, 0x2, 0x2, 0x2, 0x2f6, 
       0x2f4, 0x3, 0x2, 0x2, 0x2, 0x2f6, 0x2f7, 0x3, 0x2, 0x2, 0x2, 0x2f7, 
       0x2f9, 0x3, 0x2, 0x2, 0x2, 0x2f8, 0x2f6, 0x3, 0x2, 0x2, 0x2, 0x2f9, 
       0x304, 0x7, 0x5, 0x2, 0x2, 0x2fa, 0x2fb, 0x7, 0x37, 0x2, 0x2, 0x2fb, 
       0x2ff, 0x7, 0x4, 0x2, 0x2, 0x2fc, 0x2fe, 0x5, 0x70, 0x39, 0x2, 0x2fd, 
       0x2fc, 0x3, 0x2, 0x2, 0x2, 0x2fe, 0x301, 0x3, 0x2, 0x2, 0x2, 0x2ff, 
       0x2fd, 0x3, 0x2, 0x2, 0x2, 0x2ff, 0x300, 0x3, 0x2, 0x2, 0x2, 0x300, 
       0x302, 0x3, 0x2, 0x2, 0x2, 0x301, 0x2ff, 0x3, 0x2, 0x2, 0x2, 0x302, 
       0x304, 0x7, 0x5, 0x2, 0x2, 0x303, 0x2f1, 0x3, 0x2, 0x2, 0x2, 0x303, 
       0x2fa, 0x3, 0x2, 0x2, 0x2, 0x304, 0x73, 0x3, 0x2, 0x2, 0x2, 0x305, 
       0x307, 0x5, 0x78, 0x3d, 0x2, 0x306, 0x308, 0x5, 0x76, 0x3c, 0x2, 
       0x307, 0x306, 0x3, 0x2, 0x2, 0x2, 0x307, 0x308, 0x3, 0x2, 0x2, 0x2, 
       0x308, 0x312, 0x3, 0x2, 0x2, 0x2, 0x309, 0x30b, 0x5, 0x7e, 0x40, 
       0x2, 0x30a, 0x30c, 0x5, 0x76, 0x3c, 0x2, 0x30b, 0x30a, 0x3, 0x2, 
       0x2, 0x2, 0x30b, 0x30c, 0x3, 0x2, 0x2, 0x2, 0x30c, 0x312, 0x3, 0x2, 
       0x2, 0x2, 0x30d, 0x30f, 0x5, 0x80, 0x41, 0x2, 0x30e, 0x310, 0x5, 
       0x76, 0x3c, 0x2, 0x30f, 0x30e, 0x3, 0x2, 0x2, 0x2, 0x30f, 0x310, 
       0x3, 0x2, 0x2, 0x2, 0x310, 0x312, 0x3, 0x2, 0x2, 0x2, 0x311, 0x305, 
       0x3, 0x2, 0x2, 0x2, 0x311, 0x309, 0x3, 0x2, 0x2, 0x2, 0x311, 0x30d, 
       0x3, 0x2, 0x2, 0x2, 0x312, 0x75, 0x3, 0x2, 0x2, 0x2, 0x313, 0x314, 
       0x7, 0x7, 0x2, 0x2, 0x314, 0x77, 0x3, 0x2, 0x2, 0x2, 0x315, 0x316, 
       0x5, 0x7a, 0x3e, 0x2, 0x316, 0x318, 0x5, 0x82, 0x42, 0x2, 0x317, 
       0x319, 0x5, 0x7c, 0x3f, 0x2, 0x318, 0x317, 0x3, 0x2, 0x2, 0x2, 0x318, 
       0x319, 0x3, 0x2, 0x2, 0x2, 0x319, 0x79, 0x3, 0x2, 0x2, 0x2, 0x31a, 
       0x31b, 0x9, 0x6, 0x2, 0x2, 0x31b, 0x7b, 0x3, 0x2, 0x2, 0x2, 0x31c, 
       0x31d, 0x7, 0x38, 0x2, 0x2, 0x31d, 0x31e, 0x5, 0x82, 0x42, 0x2, 0x31e, 
       0x7d, 0x3, 0x2, 0x2, 0x2, 0x31f, 0x320, 0x7, 0x24, 0x2, 0x2, 0x320, 
       0x326, 0x5, 0x5c, 0x2f, 0x2, 0x321, 0x323, 0x7, 0x64, 0x2, 0x2, 0x322, 
       0x324, 0x5, 0x90, 0x49, 0x2, 0x323, 0x322, 0x3, 0x2, 0x2, 0x2, 0x323, 
       0x324, 0x3, 0x2, 0x2, 0x2, 0x324, 0x325, 0x3, 0x2, 0x2, 0x2, 0x325, 
       0x327, 0x7, 0x65, 0x2, 0x2, 0x326, 0x321, 0x3, 0x2, 0x2, 0x2, 0x326, 
       0x327, 0x3, 0x2, 0x2, 0x2, 0x327, 0x7f, 0x3, 0x2, 0x2, 0x2, 0x328, 
       0x329, 0x7, 0x66, 0x2, 0x2, 0x329, 0x81, 0x3, 0x2, 0x2, 0x2, 0x32a, 
       0x32b, 0x5, 0x84, 0x43, 0x2, 0x32b, 0x83, 0x3, 0x2, 0x2, 0x2, 0x32c, 
       0x331, 0x5, 0x86, 0x44, 0x2, 0x32d, 0x32e, 0x7, 0x4a, 0x2, 0x2, 0x32e, 
       0x330, 0x5, 0x86, 0x44, 0x2, 0x32f, 0x32d, 0x3, 0x2, 0x2, 0x2, 0x330, 
       0x333, 0x3, 0x2, 0x2, 0x2, 0x331, 0x32f, 0x3, 0x2, 0x2, 0x2, 0x331, 
       0x332, 0x3, 0x2, 0x2, 0x2, 0x332, 0x85, 0x3, 0x2, 0x2, 0x2, 0x333, 
       0x331, 0x3, 0x2, 0x2, 0x2, 0x334, 0x339, 0x5, 0x88, 0x45, 0x2, 0x335, 
       0x336, 0x7, 0x67, 0x2, 0x2, 0x336, 0x338, 0x5, 0x88, 0x45, 0x2, 0x337, 
       0x335, 0x3, 0x2, 0x2, 0x2, 0x338, 0x33b, 0x3, 0x2, 0x2, 0x2, 0x339, 
       0x337, 0x3, 0x2, 0x2, 0x2, 0x339, 0x33a, 0x3, 0x2, 0x2, 0x2, 0x33a, 
       0x87, 0x3, 0x2, 0x2, 0x2, 0x33b, 0x339, 0x3, 0x2, 0x2, 0x2, 0x33c, 
       0x341, 0x5, 0x8a, 0x46, 0x2, 0x33d, 0x33e, 0x7, 0x68, 0x2, 0x2, 0x33e, 
       0x340, 0x5, 0x8a, 0x46, 0x2, 0x33f, 0x33d, 0x3, 0x2, 0x2, 0x2, 0x340, 
       0x343, 0x3, 0x2, 0x2, 0x2, 0x341, 0x33f, 0x3, 0x2, 0x2, 0x2, 0x341, 
       0x342, 0x3, 0x2, 0x2, 0x2, 0x342, 0x89, 0x3, 0x2, 0x2, 0x2, 0x343, 
       0x341, 0x3, 0x2, 0x2, 0x2, 0x344, 0x349, 0x5, 0x8c, 0x47, 0x2, 0x345, 
       0x346, 0x9, 0x7, 0x2, 0x2, 0x346, 0x348, 0x5, 0x8c, 0x47, 0x2, 0x347, 
       0x345, 0x3, 0x2, 0x2, 0x2, 0x348, 0x34b, 0x3, 0x2, 0x2, 0x2, 0x349, 
       0x347, 0x3, 0x2, 0x2, 0x2, 0x349, 0x34a, 0x3, 0x2, 0x2, 0x2, 0x34a, 
       0x8b, 0x3, 0x2, 0x2, 0x2, 0x34b, 0x349, 0x3, 0x2, 0x2, 0x2, 0x34c, 
       0x355, 0x7, 0x6f, 0x2, 0x2, 0x34d, 0x355, 0x7, 0x2d, 0x2, 0x2, 0x34e, 
       0x355, 0x5, 0x96, 0x4c, 0x2, 0x34f, 0x355, 0x5, 0x8e, 0x48, 0x2, 
       0x350, 0x351, 0x7, 0x64, 0x2, 0x2, 0x351, 0x352, 0x5, 0x82, 0x42, 
       0x2, 0x352, 0x353, 0x7, 0x65, 0x2, 0x2, 0x353, 0x355, 0x3, 0x2, 0x2, 
       0x2, 0x354, 0x34c, 0x3, 0x2, 0x2, 0x2, 0x354, 0x34d, 0x3, 0x2, 0x2, 
       0x2, 0x354, 0x34e, 0x3, 0x2, 0x2, 0x2, 0x354, 0x34f, 0x3, 0x2, 0x2, 
       0x2, 0x354, 0x350, 0x3, 0x2, 0x2, 0x2, 0x355, 0x8d, 0x3, 0x2, 0x2, 
       0x2, 0x356, 0x357, 0x5, 0x92, 0x4a, 0x2, 0x357, 0x359, 0x7, 0x64, 
       0x2, 0x2, 0x358, 0x35a, 0x5, 0x90, 0x49, 0x2, 0x359, 0x358, 0x3, 
       0x2, 0x2, 0x2, 0x359, 0x35a, 0x3, 0x2, 0x2, 0x2, 0x35a, 0x35b, 0x3, 
       0x2, 0x2, 0x2, 0x35b, 0x35c, 0x7, 0x65, 0x2, 0x2, 0x35c, 0x8f, 0x3, 
       0x2, 0x2, 0x2, 0x35d, 0x362, 0x5, 0x82, 0x42, 0x2, 0x35e, 0x35f, 
       0x7, 0x46, 0x2, 0x2, 0x35f, 0x361, 0x5, 0x82, 0x42, 0x2, 0x360, 0x35e, 
       0x3, 0x2, 0x2, 0x2, 0x361, 0x364, 0x3, 0x2, 0x2, 0x2, 0x362, 0x360, 
       0x3, 0x2, 0x2, 0x2, 0x362, 0x363, 0x3, 0x2, 0x2, 0x2, 0x363, 0x91, 
       0x3, 0x2, 0x2, 0x2, 0x364, 0x362, 0x3, 0x2, 0x2, 0x2, 0x365, 0x36a, 
       0x5, 0xa, 0x6, 0x2, 0x366, 0x367, 0x7, 0x59, 0x2, 0x2, 0x367, 0x369, 
       0x5, 0xa, 0x6, 0x2, 0x368, 0x366, 0x3, 0x2, 0x2, 0x2, 0x369, 0x36c, 
       0x3, 0x2, 0x2, 0x2, 0x36a, 0x368, 0x3, 0x2, 0x2, 0x2, 0x36a, 0x36b, 
       0x3, 0x2, 0x2, 0x2, 0x36b, 0x93, 0x3, 0x2, 0x2, 0x2, 0x36c, 0x36a, 
       0x3, 0x2, 0x2, 0x2, 0x36d, 0x372, 0x5, 0xa, 0x6, 0x2, 0x36e, 0x36f, 
       0x7, 0x6b, 0x2, 0x2, 0x36f, 0x371, 0x5, 0xa, 0x6, 0x2, 0x370, 0x36e, 
       0x3, 0x2, 0x2, 0x2, 0x371, 0x374, 0x3, 0x2, 0x2, 0x2, 0x372, 0x370, 
       0x3, 0x2, 0x2, 0x2, 0x372, 0x373, 0x3, 0x2, 0x2, 0x2, 0x373, 0x377, 
       0x3, 0x2, 0x2, 0x2, 0x374, 0x372, 0x3, 0x2, 0x2, 0x2, 0x375, 0x376, 
       0x7, 0x59, 0x2, 0x2, 0x376, 0x378, 0x5, 0xa, 0x6, 0x2, 0x377, 0x375, 
       0x3, 0x2, 0x2, 0x2, 0x377, 0x378, 0x3, 0x2, 0x2, 0x2, 0x378, 0x95, 
       0x3, 0x2, 0x2, 0x2, 0x379, 0x37a, 0x5, 0x92, 0x4a, 0x2, 0x37a, 0x97, 
       0x3, 0x2, 0x2, 0x2, 0x37b, 0x37c, 0x7, 0x59, 0x2, 0x2, 0x37c, 0x37d, 
       0x5, 0xa, 0x6, 0x2, 0x37d, 0x99, 0x3, 0x2, 0x2, 0x2, 0x37e, 0x37f, 
       0x5, 0x96, 0x4c, 0x2, 0x37f, 0x380, 0x7, 0x41, 0x2, 0x2, 0x380, 0x381, 
       0x7, 0x6f, 0x2, 0x2, 0x381, 0x382, 0x7, 0x42, 0x2, 0x2, 0x382, 0x9b, 
       0x3, 0x2, 0x2, 0x2, 0x383, 0x388, 0x5, 0x9e, 0x50, 0x2, 0x384, 0x385, 
       0x9, 0x8, 0x2, 0x2, 0x385, 0x387, 0x5, 0x9e, 0x50, 0x2, 0x386, 0x384, 
       0x3, 0x2, 0x2, 0x2, 0x387, 0x38a, 0x3, 0x2, 0x2, 0x2, 0x388, 0x386, 
       0x3, 0x2, 0x2, 0x2, 0x388, 0x389, 0x3, 0x2, 0x2, 0x2, 0x389, 0x9d, 
       0x3, 0x2, 0x2, 0x2, 0x38a, 0x388, 0x3, 0x2, 0x2, 0x2, 0x38b, 0x392, 
       0x7, 0x6f, 0x2, 0x2, 0x38c, 0x392, 0x5, 0x96, 0x4c, 0x2, 0x38d, 0x38e, 
       0x7, 0x64, 0x2, 0x2, 0x38e, 0x38f, 0x5, 0x9c, 0x4f, 0x2, 0x38f, 0x390, 
       0x7, 0x65, 0x2, 0x2, 0x390, 0x392, 0x3, 0x2, 0x2, 0x2, 0x391, 0x38b, 
       0x3, 0x2, 0x2, 0x2, 0x391, 0x38c, 0x3, 0x2, 0x2, 0x2, 0x391, 0x38d, 
       0x3, 0x2, 0x2, 0x2, 0x392, 0x9f, 0x3, 0x2, 0x2, 0x2, 0x393, 0x394, 
       0x9, 0x9, 0x2, 0x2, 0x394, 0xa1, 0x3, 0x2, 0x2, 0x2, 0x52, 0xa5, 
       0xb2, 0xba, 0xc5, 0xc9, 0xcc, 0xd5, 0xe8, 0xf1, 0xf5, 0xf7, 0xfd, 
       0x106, 0x114, 0x118, 0x11a, 0x128, 0x132, 0x139, 0x15a, 0x161, 0x169, 
       0x174, 0x17f, 0x18a, 0x195, 0x19b, 0x1ae, 0x1b4, 0x1cb, 0x1d1, 0x1df, 
       0x1e6, 0x1ee, 0x1f1, 0x200, 0x20e, 0x212, 0x218, 0x22b, 0x232, 0x23b, 
       0x23f, 0x246, 0x249, 0x26e, 0x272, 0x281, 0x28d, 0x296, 0x298, 0x29c, 
       0x2b6, 0x2c0, 0x2ce, 0x2db, 0x2e9, 0x2ef, 0x2f6, 0x2ff, 0x303, 0x307, 
       0x30b, 0x30f, 0x311, 0x318, 0x323, 0x326, 0x331, 0x339, 0x341, 0x349, 
       0x354, 0x359, 0x362, 0x36a, 0x372, 0x377, 0x388, 0x391, 
  };

  _serializedATN.insert(_serializedATN.end(), serializedATNSegment0,
    serializedATNSegment0 + sizeof(serializedATNSegment0) / sizeof(serializedATNSegment0[0]));


  atn::ATNDeserializer deserializer;
  _atn = deserializer.deserialize(_serializedATN);

  size_t count = _atn.getNumberOfDecisions();
  _decisionToDFA.reserve(count);
  for (size_t i = 0; i < count; i++) { 
    _decisionToDFA.emplace_back(_atn.getDecisionState(i), i);
  }
}

devilangParser::Initializer devilangParser::_init;
