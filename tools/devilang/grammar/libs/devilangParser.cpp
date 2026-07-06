
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
    setState(199);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__0)
      | (1ULL << devilangParser::T__7)
      | (1ULL << devilangParser::T__34)
      | (1ULL << devilangParser::T__35)
      | (1ULL << devilangParser::T__36)
      | (1ULL << devilangParser::T__37)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__61))) != 0) || ((((_la - 94) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 94)) & ((1ULL << (devilangParser::T__93 - 94))
      | (1ULL << (devilangParser::T__95 - 94))
      | (1ULL << (devilangParser::T__96 - 94))
      | (1ULL << (devilangParser::T__97 - 94))
      | (1ULL << (devilangParser::T__98 - 94))
      | (1ULL << (devilangParser::T__108 - 94)))) != 0)) {
      setState(196);
      decl();
      setState(201);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(202);
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

devilangParser::MachineDeclContext* devilangParser::DeclContext::machineDecl() {
  return getRuleContext<devilangParser::MachineDeclContext>(0);
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
    setState(212);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__0: {
        enterOuterAlt(_localctx, 1);
        setState(204);
        structDecl();
        break;
      }

      case devilangParser::T__7:
      case devilangParser::T__93:
      case devilangParser::T__95:
      case devilangParser::T__96:
      case devilangParser::T__97:
      case devilangParser::T__98: {
        enterOuterAlt(_localctx, 2);
        setState(205);
        topologyDecl();
        break;
      }

      case devilangParser::T__108: {
        enterOuterAlt(_localctx, 3);
        setState(206);
        actionDecl();
        break;
      }

      case devilangParser::T__34: {
        enterOuterAlt(_localctx, 4);
        setState(207);
        opDecl();
        break;
      }

      case devilangParser::T__35: {
        enterOuterAlt(_localctx, 5);
        setState(208);
        topBbDecl();
        break;
      }

      case devilangParser::T__36: {
        enterOuterAlt(_localctx, 6);
        setState(209);
        topPathDecl();
        break;
      }

      case devilangParser::T__37: {
        enterOuterAlt(_localctx, 7);
        setState(210);
        topFuncDecl();
        break;
      }

      case devilangParser::T__56:
      case devilangParser::T__61: {
        enterOuterAlt(_localctx, 8);
        setState(211);
        machineDecl();
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
    setState(214);
    match(devilangParser::T__0);
    setState(215);
    ident();
    setState(216);
    match(devilangParser::T__1);
    setState(220);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
      setState(217);
      field();
      setState(222);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(223);
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
    setState(225);
    ident();
    setState(226);
    match(devilangParser::T__3);
    setState(227);
    type_();
    setState(231);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__49)
      | (1ULL << devilangParser::T__50)
      | (1ULL << devilangParser::T__51))) != 0)) {
      setState(228);
      modifier();
      setState(233);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(235);
    _errHandler->sync(this);

    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 4, _ctx)) {
    case 1: {
      setState(234);
      bitBlock();
      break;
    }

    default:
      break;
    }
    setState(238);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__85) {
      setState(237);
      immBlock();
    }
    setState(240);
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
    setState(242);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0))) {
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
    setState(247);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__77:
      case devilangParser::T__78:
      case devilangParser::T__79:
      case devilangParser::T__80: {
        enterOuterAlt(_localctx, 1);
        setState(244);
        baseType();
        break;
      }

      case devilangParser::T__81: {
        enterOuterAlt(_localctx, 2);
        setState(245);
        ptrType();
        break;
      }

      case devilangParser::T__84: {
        enterOuterAlt(_localctx, 3);
        setState(246);
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
    setState(249);
    _la = _input->LA(1);
    if (!(((((_la - 78) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 78)) & ((1ULL << (devilangParser::T__77 - 78))
      | (1ULL << (devilangParser::T__78 - 78))
      | (1ULL << (devilangParser::T__79 - 78))
      | (1ULL << (devilangParser::T__80 - 78)))) != 0))) {
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
    setState(251);
    match(devilangParser::T__81);
    setState(252);
    match(devilangParser::T__82);
    setState(253);
    type_();
    setState(254);
    match(devilangParser::T__83);
   
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
    setState(256);
    match(devilangParser::T__84);
    setState(257);
    match(devilangParser::T__85);
    setState(258);
    match(devilangParser::INT);
    setState(259);
    match(devilangParser::T__86);
   
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
    setState(266);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__49: {
        enterOuterAlt(_localctx, 1);
        setState(261);
        match(devilangParser::T__49);
        break;
      }

      case devilangParser::T__50: {
        enterOuterAlt(_localctx, 2);
        setState(262);
        match(devilangParser::T__50);
        break;
      }

      case devilangParser::T__51: {
        enterOuterAlt(_localctx, 3);
        setState(263);
        match(devilangParser::T__51);
        break;
      }

      case devilangParser::T__12: {
        enterOuterAlt(_localctx, 4);
        setState(264);
        match(devilangParser::T__12);
        setState(265);
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
    setState(268);
    match(devilangParser::T__85);
    setState(281);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__87

    || _la == devilangParser::INT) {
      setState(269);
      bitEntry();
      setState(275);
      _errHandler->sync(this);
      alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 8, _ctx);
      while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER) {
        if (alt == 1) {
          setState(270);
          bitSep();
          setState(271);
          bitEntry(); 
        }
        setState(277);
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 8, _ctx);
      }
      setState(279);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if (_la == devilangParser::T__4 || _la == devilangParser::T__90) {
        setState(278);
        bitSep();
      }
    }
    setState(283);
    match(devilangParser::T__86);
   
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
    setState(285);
    bitRange();
    setState(287);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__89) {
      setState(286);
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
    setState(296);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__87: {
        enterOuterAlt(_localctx, 1);
        setState(289);
        match(devilangParser::T__87);
        setState(290);
        match(devilangParser::INT);
        setState(291);
        match(devilangParser::T__88);
        setState(292);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::INT: {
        enterOuterAlt(_localctx, 2);
        setState(293);
        match(devilangParser::INT);
        setState(294);
        match(devilangParser::T__88);
        setState(295);
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
    setState(298);
    match(devilangParser::T__89);
    setState(299);
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
    setState(301);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__4 || _la == devilangParser::T__90)) {
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
    setState(303);
    match(devilangParser::T__85);
    setState(316);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (((((_la - 92) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 92)) & ((1ULL << (devilangParser::T__91 - 92))
      | (1ULL << (devilangParser::T__92 - 92))
      | (1ULL << (devilangParser::INT - 92)))) != 0)) {
      setState(304);
      immEntry();
      setState(310);
      _errHandler->sync(this);
      alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 13, _ctx);
      while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER) {
        if (alt == 1) {
          setState(305);
          immSep();
          setState(306);
          immEntry(); 
        }
        setState(312);
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 13, _ctx);
      }
      setState(314);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if (_la == devilangParser::T__4 || _la == devilangParser::T__90) {
        setState(313);
        immSep();
      }
    }
    setState(318);
    match(devilangParser::T__86);
   
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
    setState(330);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 16, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(320);
      match(devilangParser::T__91);
      setState(321);
      match(devilangParser::INT);
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(322);
      match(devilangParser::T__92);
      setState(323);
      match(devilangParser::INT);
      setState(324);
      match(devilangParser::T__88);
      setState(325);
      match(devilangParser::INT);
      break;
    }

    case 3: {
      enterOuterAlt(_localctx, 3);
      setState(326);
      match(devilangParser::INT);
      break;
    }

    case 4: {
      enterOuterAlt(_localctx, 4);
      setState(327);
      match(devilangParser::INT);
      setState(328);
      match(devilangParser::T__88);
      setState(329);
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
    setState(332);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__4 || _la == devilangParser::T__90)) {
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
    setState(340);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__93: {
        enterOuterAlt(_localctx, 1);
        setState(334);
        pointerDecl();
        break;
      }

      case devilangParser::T__95: {
        enterOuterAlt(_localctx, 2);
        setState(335);
        listDecl();
        break;
      }

      case devilangParser::T__96: {
        enterOuterAlt(_localctx, 3);
        setState(336);
        dlistDecl();
        break;
      }

      case devilangParser::T__97: {
        enterOuterAlt(_localctx, 4);
        setState(337);
        ringDecl();
        break;
      }

      case devilangParser::T__98: {
        enterOuterAlt(_localctx, 5);
        setState(338);
        ringbufDecl();
        break;
      }

      case devilangParser::T__7: {
        enterOuterAlt(_localctx, 6);
        setState(339);
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
    setState(342);
    match(devilangParser::T__93);
    setState(343);
    match(devilangParser::T__1);
    setState(347);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__5)
      | (1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__13)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__15)
      | (1ULL << devilangParser::T__51))) != 0)) {
      setState(344);
      pointerField();
      setState(349);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(350);
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
    setState(380);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__13: {
        enterOuterAlt(_localctx, 1);
        setState(352);
        match(devilangParser::T__13);
        setState(353);
        match(devilangParser::T__89);
        setState(354);
        ref();
        setState(355);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__14: {
        enterOuterAlt(_localctx, 2);
        setState(357);
        match(devilangParser::T__14);
        setState(358);
        match(devilangParser::T__89);
        setState(359);
        typeList();
        setState(360);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__12: {
        enterOuterAlt(_localctx, 3);
        setState(362);
        match(devilangParser::T__12);
        setState(363);
        match(devilangParser::T__89);
        setState(364);
        match(devilangParser::INT);
        setState(365);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__51: {
        enterOuterAlt(_localctx, 4);
        setState(366);
        match(devilangParser::T__51);
        setState(367);
        match(devilangParser::T__89);
        setState(368);
        boolLiteral();
        setState(369);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__5: {
        enterOuterAlt(_localctx, 5);
        setState(371);
        match(devilangParser::T__5);
        setState(372);
        match(devilangParser::T__89);
        setState(373);
        match(devilangParser::INT);
        setState(374);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__15: {
        enterOuterAlt(_localctx, 6);
        setState(375);
        match(devilangParser::T__15);
        setState(376);
        match(devilangParser::T__89);
        setState(377);
        bitRefList();
        setState(378);
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
    setState(382);
    bitRef();
    setState(387);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__94) {
      setState(383);
      match(devilangParser::T__94);
      setState(384);
      bitRef();
      setState(389);
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
    setState(390);
    match(devilangParser::T__95);
    setState(391);
    match(devilangParser::T__82);
    setState(392);
    typeList();
    setState(393);
    match(devilangParser::T__83);
    setState(395);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
      setState(394);
      ident();
    }
    setState(397);
    match(devilangParser::T__1);
    setState(398);
    listBody();
    setState(399);
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
    setState(401);
    match(devilangParser::T__96);
    setState(402);
    match(devilangParser::T__82);
    setState(403);
    typeList();
    setState(404);
    match(devilangParser::T__83);
    setState(406);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
      setState(405);
      ident();
    }
    setState(408);
    match(devilangParser::T__1);
    setState(409);
    dlistBody();
    setState(410);
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
    setState(412);
    match(devilangParser::T__97);
    setState(413);
    match(devilangParser::T__82);
    setState(414);
    typeList();
    setState(415);
    match(devilangParser::T__83);
    setState(417);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
      setState(416);
      ident();
    }
    setState(419);
    match(devilangParser::T__1);
    setState(420);
    ringBody();
    setState(421);
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
    setState(423);
    match(devilangParser::T__98);
    setState(424);
    match(devilangParser::T__82);
    setState(425);
    type_();
    setState(426);
    match(devilangParser::T__83);
    setState(428);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
      setState(427);
      ident();
    }
    setState(430);
    match(devilangParser::T__1);
    setState(431);
    ringbufBody();
    setState(432);
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
    setState(434);
    ident();
    setState(439);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__94) {
      setState(435);
      match(devilangParser::T__94);
      setState(436);
      ident();
      setState(441);
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
    setState(443); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(442);
      ident();
      setState(445); 
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0));
   
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
    setState(447);
    match(devilangParser::T__7);
    setState(448);
    match(devilangParser::T__89);
    setState(449);
    ref();
    setState(450);
    match(devilangParser::T__4);
    setState(451);
    match(devilangParser::T__8);
    setState(452);
    match(devilangParser::T__89);
    setState(453);
    ref();
    setState(454);
    match(devilangParser::T__4);
    setState(455);
    match(devilangParser::T__9);
    setState(456);
    match(devilangParser::T__89);
    setState(457);
    fieldRefOrList();
    setState(458);
    match(devilangParser::T__4);
    setState(464);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__15) {
      setState(459);
      match(devilangParser::T__15);
      setState(460);
      match(devilangParser::T__89);
      setState(461);
      bitRefList();
      setState(462);
      match(devilangParser::T__4);
    }
    setState(470);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(466);
      match(devilangParser::T__12);
      setState(467);
      match(devilangParser::T__89);
      setState(468);
      match(devilangParser::INT);
      setState(469);
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
    setState(472);
    match(devilangParser::T__7);
    setState(473);
    match(devilangParser::T__89);
    setState(474);
    ref();
    setState(475);
    match(devilangParser::T__4);
    setState(476);
    match(devilangParser::T__8);
    setState(477);
    match(devilangParser::T__89);
    setState(478);
    ref();
    setState(479);
    match(devilangParser::T__4);
    setState(480);
    match(devilangParser::T__9);
    setState(481);
    match(devilangParser::T__89);
    setState(482);
    fieldRefOrList();
    setState(483);
    match(devilangParser::T__4);
    setState(484);
    match(devilangParser::T__10);
    setState(485);
    match(devilangParser::T__89);
    setState(486);
    fieldRefOrList();
    setState(487);
    match(devilangParser::T__4);
    setState(493);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__15) {
      setState(488);
      match(devilangParser::T__15);
      setState(489);
      match(devilangParser::T__89);
      setState(490);
      bitRefList();
      setState(491);
      match(devilangParser::T__4);
    }
    setState(499);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(495);
      match(devilangParser::T__12);
      setState(496);
      match(devilangParser::T__89);
      setState(497);
      match(devilangParser::INT);
      setState(498);
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
    setState(501);
    match(devilangParser::T__7);
    setState(502);
    match(devilangParser::T__89);
    setState(503);
    ref();
    setState(504);
    match(devilangParser::T__4);
    setState(505);
    match(devilangParser::T__9);
    setState(506);
    match(devilangParser::T__89);
    setState(507);
    fieldRefOrList();
    setState(508);
    match(devilangParser::T__4);
    setState(513);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(509);
      match(devilangParser::T__12);
      setState(510);
      match(devilangParser::T__89);
      setState(511);
      match(devilangParser::INT);
      setState(512);
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
    setState(531);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__109: {
        enterOuterAlt(_localctx, 1);
        setState(515);
        fieldRef();
        setState(520);
        _errHandler->sync(this);
        _la = _input->LA(1);
        while (_la == devilangParser::T__94) {
          setState(516);
          match(devilangParser::T__94);
          setState(517);
          fieldRef();
          setState(522);
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
      case devilangParser::T__54:
      case devilangParser::T__55:
      case devilangParser::T__56:
      case devilangParser::T__57:
      case devilangParser::T__58:
      case devilangParser::T__59:
      case devilangParser::T__60:
      case devilangParser::T__61:
      case devilangParser::T__62:
      case devilangParser::T__63:
      case devilangParser::T__64:
      case devilangParser::T__65:
      case devilangParser::T__66:
      case devilangParser::T__67:
      case devilangParser::T__68:
      case devilangParser::T__69:
      case devilangParser::T__70:
      case devilangParser::T__71:
      case devilangParser::T__72:
      case devilangParser::T__73:
      case devilangParser::T__74:
      case devilangParser::T__75:
      case devilangParser::T__76:
      case devilangParser::IDENT: {
        enterOuterAlt(_localctx, 2);
        setState(523);
        ident();
        setState(528);
        _errHandler->sync(this);
        _la = _input->LA(1);
        while (_la == devilangParser::T__94) {
          setState(524);
          match(devilangParser::T__94);
          setState(525);
          ident();
          setState(530);
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
    setState(533);
    match(devilangParser::T__11);
    setState(534);
    match(devilangParser::T__89);
    setState(535);
    expr();
    setState(536);
    match(devilangParser::T__4);
    setState(546);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__6: {
        setState(537);
        match(devilangParser::T__6);
        setState(538);
        match(devilangParser::T__89);
        setState(539);
        match(devilangParser::INT);
        setState(540);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__5: {
        setState(541);
        match(devilangParser::T__5);
        setState(542);
        match(devilangParser::T__89);
        setState(543);
        ref();
        setState(544);
        match(devilangParser::T__4);
        break;
      }

    default:
      throw NoViableAltException(this);
    }
    setState(548);
    match(devilangParser::T__7);
    setState(549);
    match(devilangParser::T__89);
    setState(550);
    ref();
    setState(551);
    match(devilangParser::T__4);
    setState(552);
    match(devilangParser::T__8);
    setState(553);
    match(devilangParser::T__89);
    setState(554);
    ref();
    setState(555);
    match(devilangParser::T__4);
    setState(560);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__12) {
      setState(556);
      match(devilangParser::T__12);
      setState(557);
      match(devilangParser::T__89);
      setState(558);
      match(devilangParser::INT);
      setState(559);
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
    setState(562);
    match(devilangParser::T__7);
    setState(564);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
      setState(563);
      headName();
    }
    setState(566);
    match(devilangParser::T__1);
    setState(570);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__12)
      | (1ULL << devilangParser::T__14)
      | (1ULL << devilangParser::T__16))) != 0)) {
      setState(567);
      headField();
      setState(572);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(573);
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
    setState(575);
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
    setState(589);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__16: {
        enterOuterAlt(_localctx, 1);
        setState(577);
        match(devilangParser::T__16);
        setState(578);
        match(devilangParser::T__89);
        setState(579);
        headPosition();
        break;
      }

      case devilangParser::T__14: {
        enterOuterAlt(_localctx, 2);
        setState(580);
        match(devilangParser::T__14);
        setState(581);
        match(devilangParser::T__89);
        setState(582);
        spaceTypeList();
        setState(583);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__12: {
        enterOuterAlt(_localctx, 3);
        setState(585);
        match(devilangParser::T__12);
        setState(586);
        match(devilangParser::T__89);
        setState(587);
        match(devilangParser::INT);
        setState(588);
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
    setState(591);
    headLocation();
    setState(596);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__94) {
      setState(592);
      match(devilangParser::T__94);
      setState(593);
      headLocation();
      setState(598);
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
    setState(599);
    match(devilangParser::T__85);
    setState(619);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 44, _ctx)) {
    case 1: {
      setState(600);
      headKeyValue();
      setState(605);
      _errHandler->sync(this);
      alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 41, _ctx);
      while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER) {
        if (alt == 1) {
          setState(601);
          match(devilangParser::T__4);
          setState(602);
          headKeyValue(); 
        }
        setState(607);
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 41, _ctx);
      }
      setState(609);
      _errHandler->sync(this);

      _la = _input->LA(1);
      if (_la == devilangParser::T__4) {
        setState(608);
        match(devilangParser::T__4);
      }
      break;
    }

    case 2: {
      setState(611);
      headAtom();
      setState(616);
      _errHandler->sync(this);
      _la = _input->LA(1);
      while (_la == devilangParser::T__90) {
        setState(612);
        match(devilangParser::T__90);
        setState(613);
        headAtom();
        setState(618);
        _errHandler->sync(this);
        _la = _input->LA(1);
      }
      break;
    }

    default:
      break;
    }
    setState(621);
    match(devilangParser::T__86);
   
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
    setState(656);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__99: {
        enterOuterAlt(_localctx, 1);
        setState(623);
        match(devilangParser::T__99);
        setState(624);
        match(devilangParser::T__89);
        setState(625);
        qualifiedName();
        break;
      }

      case devilangParser::T__100: {
        enterOuterAlt(_localctx, 2);
        setState(626);
        match(devilangParser::T__100);
        setState(627);
        match(devilangParser::T__89);
        setState(628);
        fileName();
        break;
      }

      case devilangParser::T__101: {
        enterOuterAlt(_localctx, 3);
        setState(629);
        match(devilangParser::T__101);
        setState(630);
        match(devilangParser::T__89);
        setState(631);
        fileName();
        break;
      }

      case devilangParser::T__37: {
        enterOuterAlt(_localctx, 4);
        setState(632);
        match(devilangParser::T__37);
        setState(633);
        match(devilangParser::T__89);
        setState(634);
        qualifiedName();
        break;
      }

      case devilangParser::T__102: {
        enterOuterAlt(_localctx, 5);
        setState(635);
        match(devilangParser::T__102);
        setState(636);
        match(devilangParser::T__89);
        setState(637);
        qualifiedName();
        break;
      }

      case devilangParser::T__103: {
        enterOuterAlt(_localctx, 6);
        setState(638);
        match(devilangParser::T__103);
        setState(639);
        match(devilangParser::T__89);
        setState(640);
        qualifiedName();
        break;
      }

      case devilangParser::T__104: {
        enterOuterAlt(_localctx, 7);
        setState(641);
        match(devilangParser::T__104);
        setState(642);
        match(devilangParser::T__89);
        setState(643);
        qualifiedName();
        break;
      }

      case devilangParser::T__105: {
        enterOuterAlt(_localctx, 8);
        setState(644);
        match(devilangParser::T__105);
        setState(645);
        match(devilangParser::T__89);
        setState(646);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__106: {
        enterOuterAlt(_localctx, 9);
        setState(647);
        match(devilangParser::T__106);
        setState(648);
        match(devilangParser::T__89);
        setState(649);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__32: {
        enterOuterAlt(_localctx, 10);
        setState(650);
        match(devilangParser::T__32);
        setState(651);
        match(devilangParser::T__89);
        setState(652);
        match(devilangParser::INT);
        break;
      }

      case devilangParser::T__107: {
        enterOuterAlt(_localctx, 11);
        setState(653);
        match(devilangParser::T__107);
        setState(654);
        match(devilangParser::T__89);
        setState(655);
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
      case devilangParser::T__54:
      case devilangParser::T__55:
      case devilangParser::T__56:
      case devilangParser::T__57:
      case devilangParser::T__58:
      case devilangParser::T__59:
      case devilangParser::T__60:
      case devilangParser::T__61:
      case devilangParser::T__62:
      case devilangParser::T__63:
      case devilangParser::T__64:
      case devilangParser::T__65:
      case devilangParser::T__66:
      case devilangParser::T__67:
      case devilangParser::T__68:
      case devilangParser::T__69:
      case devilangParser::T__70:
      case devilangParser::T__71:
      case devilangParser::T__72:
      case devilangParser::T__73:
      case devilangParser::T__74:
      case devilangParser::T__75:
      case devilangParser::T__76:
      case devilangParser::IDENT: {
        enterOuterAlt(_localctx, 1);
        setState(658);
        qualifiedName();
        break;
      }

      case devilangParser::INT: {
        enterOuterAlt(_localctx, 2);
        setState(659);
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
    setState(662);
    match(devilangParser::T__108);
    setState(663);
    ident();
    setState(664);
    match(devilangParser::T__1);
    setState(665);
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
    setState(667);
    match(devilangParser::T__34);
    setState(668);
    ident();
    setState(669);
    match(devilangParser::T__1);
    setState(670);
    opBody();
    setState(671);
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
    setState(675);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__33: {
        enterOuterAlt(_localctx, 1);
        setState(673);
        callOp();
        break;
      }

      case devilangParser::T__38: {
        enterOuterAlt(_localctx, 2);
        setState(674);
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
    setState(677);
    match(devilangParser::T__33);
    setState(678);
    extendedName();
    setState(679);
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
    setState(681);
    match(devilangParser::T__38);
    setState(682);
    extendedName();
    setState(683);
    match(devilangParser::T__1);
    setState(687);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__6)
      | (1ULL << devilangParser::T__22)
      | (1ULL << devilangParser::T__39)
      | (1ULL << devilangParser::T__40)
      | (1ULL << devilangParser::T__41))) != 0)) {
      setState(684);
      mmioField();
      setState(689);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(690);
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
    setState(692);
    ident();
    setState(702);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__109) {
      setState(693);
      match(devilangParser::T__109);
      setState(696); 
      _errHandler->sync(this);
      alt = 1;
      do {
        switch (alt) {
          case 1: {
                setState(696);
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
                  case devilangParser::T__54:
                  case devilangParser::T__55:
                  case devilangParser::T__56:
                  case devilangParser::T__57:
                  case devilangParser::T__58:
                  case devilangParser::T__59:
                  case devilangParser::T__60:
                  case devilangParser::T__61:
                  case devilangParser::T__62:
                  case devilangParser::T__63:
                  case devilangParser::T__64:
                  case devilangParser::T__65:
                  case devilangParser::T__66:
                  case devilangParser::T__67:
                  case devilangParser::T__68:
                  case devilangParser::T__69:
                  case devilangParser::T__70:
                  case devilangParser::T__71:
                  case devilangParser::T__72:
                  case devilangParser::T__73:
                  case devilangParser::T__74:
                  case devilangParser::T__75:
                  case devilangParser::T__76:
                  case devilangParser::IDENT: {
                    setState(694);
                    ident();
                    break;
                  }

                  case devilangParser::INT: {
                    setState(695);
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
        setState(698); 
        _errHandler->sync(this);
        alt = getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 50, _ctx);
      } while (alt != 2 && alt != atn::ATN::INVALID_ALT_NUMBER);
      setState(704);
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
    setState(728);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__39: {
        enterOuterAlt(_localctx, 1);
        setState(705);
        match(devilangParser::T__39);
        setState(706);
        match(devilangParser::T__89);
        setState(707);
        mmioDir();
        setState(708);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__40: {
        enterOuterAlt(_localctx, 2);
        setState(710);
        match(devilangParser::T__40);
        setState(711);
        match(devilangParser::T__89);
        setState(712);
        match(devilangParser::INT);
        setState(713);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__41: {
        enterOuterAlt(_localctx, 3);
        setState(714);
        match(devilangParser::T__41);
        setState(715);
        match(devilangParser::T__89);
        setState(716);
        opExpr();
        setState(717);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__6: {
        enterOuterAlt(_localctx, 4);
        setState(719);
        match(devilangParser::T__6);
        setState(720);
        match(devilangParser::T__89);
        setState(721);
        match(devilangParser::INT);
        setState(722);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__22: {
        enterOuterAlt(_localctx, 5);
        setState(723);
        match(devilangParser::T__22);
        setState(724);
        match(devilangParser::T__89);
        setState(725);
        opExpr();
        setState(726);
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
    setState(730);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__42

    || _la == devilangParser::T__43)) {
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
    setState(732);
    match(devilangParser::T__35);
    setState(733);
    extendedName();
    setState(734);
    match(devilangParser::T__1);
    setState(736); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(735);
      topBbItem();
      setState(738); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (_la == devilangParser::T__34);
    setState(740);
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
    setState(742);
    match(devilangParser::T__34);
    setState(743);
    extendedName();
    setState(744);
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
    setState(746);
    match(devilangParser::T__36);
    setState(747);
    extendedName();
    setState(748);
    match(devilangParser::T__1);
    setState(750); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(749);
      topPathItem();
      setState(752); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (_la == devilangParser::T__35);
    setState(754);
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
    setState(756);
    match(devilangParser::T__35);
    setState(757);
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
    setState(759);
    match(devilangParser::T__37);
    setState(760);
    extendedName();
    setState(761);
    match(devilangParser::T__1);
    setState(763); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(762);
      topFuncItem();
      setState(765); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (_la == devilangParser::T__36);
    setState(767);
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
    setState(769);
    match(devilangParser::T__36);
    setState(770);
    extendedName();
    setState(771);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- MachineDeclContext ------------------------------------------------------------------

devilangParser::MachineDeclContext::MachineDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::MachineDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}

std::vector<devilangParser::ImportDeclContext *> devilangParser::MachineDeclContext::importDecl() {
  return getRuleContexts<devilangParser::ImportDeclContext>();
}

devilangParser::ImportDeclContext* devilangParser::MachineDeclContext::importDecl(size_t i) {
  return getRuleContext<devilangParser::ImportDeclContext>(i);
}

std::vector<devilangParser::MachineItemContext *> devilangParser::MachineDeclContext::machineItem() {
  return getRuleContexts<devilangParser::MachineItemContext>();
}

devilangParser::MachineItemContext* devilangParser::MachineDeclContext::machineItem(size_t i) {
  return getRuleContext<devilangParser::MachineItemContext>(i);
}


size_t devilangParser::MachineDeclContext::getRuleIndex() const {
  return devilangParser::RuleMachineDecl;
}

void devilangParser::MachineDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterMachineDecl(this);
}

void devilangParser::MachineDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitMachineDecl(this);
}

devilangParser::MachineDeclContext* devilangParser::machineDecl() {
  MachineDeclContext *_localctx = _tracker.createInstance<MachineDeclContext>(_ctx, getState());
  enterRule(_localctx, 108, devilangParser::RuleMachineDecl);
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
    setState(776);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__61) {
      setState(773);
      importDecl();
      setState(778);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(779);
    match(devilangParser::T__56);
    setState(780);
    ident();
    setState(781);
    match(devilangParser::T__1);
    setState(785);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while ((((_la & ~ 0x3fULL) == 0) &&
      ((1ULL << _la) & ((1ULL << devilangParser::T__52)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__62))) != 0)) {
      setState(782);
      machineItem();
      setState(787);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(788);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- MachineItemContext ------------------------------------------------------------------

devilangParser::MachineItemContext::MachineItemContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::InitialDeclContext* devilangParser::MachineItemContext::initialDecl() {
  return getRuleContext<devilangParser::InitialDeclContext>(0);
}

devilangParser::ScratchDeclContext* devilangParser::MachineItemContext::scratchDecl() {
  return getRuleContext<devilangParser::ScratchDeclContext>(0);
}

devilangParser::MachineStateDeclContext* devilangParser::MachineItemContext::machineStateDecl() {
  return getRuleContext<devilangParser::MachineStateDeclContext>(0);
}

devilangParser::TraceDeclContext* devilangParser::MachineItemContext::traceDecl() {
  return getRuleContext<devilangParser::TraceDeclContext>(0);
}

devilangParser::TransitionDeclContext* devilangParser::MachineItemContext::transitionDecl() {
  return getRuleContext<devilangParser::TransitionDeclContext>(0);
}


size_t devilangParser::MachineItemContext::getRuleIndex() const {
  return devilangParser::RuleMachineItem;
}

void devilangParser::MachineItemContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterMachineItem(this);
}

void devilangParser::MachineItemContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitMachineItem(this);
}

devilangParser::MachineItemContext* devilangParser::machineItem() {
  MachineItemContext *_localctx = _tracker.createInstance<MachineItemContext>(_ctx, getState());
  enterRule(_localctx, 110, devilangParser::RuleMachineItem);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(795);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__57: {
        enterOuterAlt(_localctx, 1);
        setState(790);
        initialDecl();
        break;
      }

      case devilangParser::T__59: {
        enterOuterAlt(_localctx, 2);
        setState(791);
        scratchDecl();
        break;
      }

      case devilangParser::T__52:
      case devilangParser::T__58: {
        enterOuterAlt(_localctx, 3);
        setState(792);
        machineStateDecl();
        break;
      }

      case devilangParser::T__60: {
        enterOuterAlt(_localctx, 4);
        setState(793);
        traceDecl();
        break;
      }

      case devilangParser::T__62: {
        enterOuterAlt(_localctx, 5);
        setState(794);
        transitionDecl();
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

//----------------- ImportDeclContext ------------------------------------------------------------------

devilangParser::ImportDeclContext::ImportDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::ImportDeclContext::STRING() {
  return getToken(devilangParser::STRING, 0);
}


size_t devilangParser::ImportDeclContext::getRuleIndex() const {
  return devilangParser::RuleImportDecl;
}

void devilangParser::ImportDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterImportDecl(this);
}

void devilangParser::ImportDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitImportDecl(this);
}

devilangParser::ImportDeclContext* devilangParser::importDecl() {
  ImportDeclContext *_localctx = _tracker.createInstance<ImportDeclContext>(_ctx, getState());
  enterRule(_localctx, 112, devilangParser::RuleImportDecl);
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
    match(devilangParser::T__61);
    setState(798);
    match(devilangParser::STRING);
    setState(800);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__4) {
      setState(799);
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

//----------------- InitialDeclContext ------------------------------------------------------------------

devilangParser::InitialDeclContext::InitialDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::InitialDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::InitialDeclContext::getRuleIndex() const {
  return devilangParser::RuleInitialDecl;
}

void devilangParser::InitialDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterInitialDecl(this);
}

void devilangParser::InitialDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitInitialDecl(this);
}

devilangParser::InitialDeclContext* devilangParser::initialDecl() {
  InitialDeclContext *_localctx = _tracker.createInstance<InitialDeclContext>(_ctx, getState());
  enterRule(_localctx, 114, devilangParser::RuleInitialDecl);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(802);
    match(devilangParser::T__57);
    setState(803);
    ident();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ScratchDeclContext ------------------------------------------------------------------

devilangParser::ScratchDeclContext::ScratchDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::ScratchFieldContext *> devilangParser::ScratchDeclContext::scratchField() {
  return getRuleContexts<devilangParser::ScratchFieldContext>();
}

devilangParser::ScratchFieldContext* devilangParser::ScratchDeclContext::scratchField(size_t i) {
  return getRuleContext<devilangParser::ScratchFieldContext>(i);
}


size_t devilangParser::ScratchDeclContext::getRuleIndex() const {
  return devilangParser::RuleScratchDecl;
}

void devilangParser::ScratchDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterScratchDecl(this);
}

void devilangParser::ScratchDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitScratchDecl(this);
}

devilangParser::ScratchDeclContext* devilangParser::scratchDecl() {
  ScratchDeclContext *_localctx = _tracker.createInstance<ScratchDeclContext>(_ctx, getState());
  enterRule(_localctx, 116, devilangParser::RuleScratchDecl);
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
    setState(805);
    match(devilangParser::T__59);
    setState(806);
    match(devilangParser::T__1);
    setState(808); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(807);
      scratchField();
      setState(810); 
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::IDENT - 64)))) != 0));
    setState(812);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- ScratchFieldContext ------------------------------------------------------------------

devilangParser::ScratchFieldContext::ScratchFieldContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::ScratchFieldContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}


size_t devilangParser::ScratchFieldContext::getRuleIndex() const {
  return devilangParser::RuleScratchField;
}

void devilangParser::ScratchFieldContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterScratchField(this);
}

void devilangParser::ScratchFieldContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitScratchField(this);
}

devilangParser::ScratchFieldContext* devilangParser::scratchField() {
  ScratchFieldContext *_localctx = _tracker.createInstance<ScratchFieldContext>(_ctx, getState());
  enterRule(_localctx, 118, devilangParser::RuleScratchField);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(814);
    qualifiedName();
    setState(815);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- MachineStateDeclContext ------------------------------------------------------------------

devilangParser::MachineStateDeclContext::MachineStateDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::MachineStateDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::MachineStateDeclContext::getRuleIndex() const {
  return devilangParser::RuleMachineStateDecl;
}

void devilangParser::MachineStateDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterMachineStateDecl(this);
}

void devilangParser::MachineStateDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitMachineStateDecl(this);
}

devilangParser::MachineStateDeclContext* devilangParser::machineStateDecl() {
  MachineStateDeclContext *_localctx = _tracker.createInstance<MachineStateDeclContext>(_ctx, getState());
  enterRule(_localctx, 120, devilangParser::RuleMachineStateDecl);
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
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__58) {
      setState(817);
      match(devilangParser::T__58);
    }
    setState(820);
    match(devilangParser::T__52);
    setState(821);
    ident();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceDeclContext ------------------------------------------------------------------

devilangParser::TraceDeclContext::TraceDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::TraceDeclContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}

std::vector<devilangParser::TraceItemContext *> devilangParser::TraceDeclContext::traceItem() {
  return getRuleContexts<devilangParser::TraceItemContext>();
}

devilangParser::TraceItemContext* devilangParser::TraceDeclContext::traceItem(size_t i) {
  return getRuleContext<devilangParser::TraceItemContext>(i);
}


size_t devilangParser::TraceDeclContext::getRuleIndex() const {
  return devilangParser::RuleTraceDecl;
}

void devilangParser::TraceDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceDecl(this);
}

void devilangParser::TraceDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceDecl(this);
}

devilangParser::TraceDeclContext* devilangParser::traceDecl() {
  TraceDeclContext *_localctx = _tracker.createInstance<TraceDeclContext>(_ctx, getState());
  enterRule(_localctx, 122, devilangParser::RuleTraceDecl);
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
    setState(823);
    match(devilangParser::T__60);
    setState(824);
    ident();
    setState(825);
    match(devilangParser::T__1);
    setState(827); 
    _errHandler->sync(this);
    _la = _input->LA(1);
    do {
      setState(826);
      traceItem();
      setState(829); 
      _errHandler->sync(this);
      _la = _input->LA(1);
    } while (((((_la - 55) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 55)) & ((1ULL << (devilangParser::T__54 - 55))
      | (1ULL << (devilangParser::T__64 - 55))
      | (1ULL << (devilangParser::T__113 - 55)))) != 0));
    setState(831);
    match(devilangParser::T__2);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceItemContext ------------------------------------------------------------------

devilangParser::TraceItemContext::TraceItemContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TraceBlockContext* devilangParser::TraceItemContext::traceBlock() {
  return getRuleContext<devilangParser::TraceBlockContext>(0);
}

devilangParser::TraceLabelBlockContext* devilangParser::TraceItemContext::traceLabelBlock() {
  return getRuleContext<devilangParser::TraceLabelBlockContext>(0);
}


size_t devilangParser::TraceItemContext::getRuleIndex() const {
  return devilangParser::RuleTraceItem;
}

void devilangParser::TraceItemContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceItem(this);
}

void devilangParser::TraceItemContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceItem(this);
}

devilangParser::TraceItemContext* devilangParser::traceItem() {
  TraceItemContext *_localctx = _tracker.createInstance<TraceItemContext>(_ctx, getState());
  enterRule(_localctx, 124, devilangParser::RuleTraceItem);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(835);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__54:
      case devilangParser::T__64: {
        enterOuterAlt(_localctx, 1);
        setState(833);
        traceBlock();
        break;
      }

      case devilangParser::T__113: {
        enterOuterAlt(_localctx, 2);
        setState(834);
        traceLabelBlock();
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

//----------------- TraceBlockContext ------------------------------------------------------------------

devilangParser::TraceBlockContext::TraceBlockContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TraceInstrContext *> devilangParser::TraceBlockContext::traceInstr() {
  return getRuleContexts<devilangParser::TraceInstrContext>();
}

devilangParser::TraceInstrContext* devilangParser::TraceBlockContext::traceInstr(size_t i) {
  return getRuleContext<devilangParser::TraceInstrContext>(i);
}


size_t devilangParser::TraceBlockContext::getRuleIndex() const {
  return devilangParser::RuleTraceBlock;
}

void devilangParser::TraceBlockContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceBlock(this);
}

void devilangParser::TraceBlockContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceBlock(this);
}

devilangParser::TraceBlockContext* devilangParser::traceBlock() {
  TraceBlockContext *_localctx = _tracker.createInstance<TraceBlockContext>(_ctx, getState());
  enterRule(_localctx, 126, devilangParser::RuleTraceBlock);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(855);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__64: {
        enterOuterAlt(_localctx, 1);
        setState(837);
        match(devilangParser::T__64);
        setState(838);
        match(devilangParser::T__1);
        setState(842);
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
          | (1ULL << devilangParser::T__53)
          | (1ULL << devilangParser::T__54)
          | (1ULL << devilangParser::T__55)
          | (1ULL << devilangParser::T__56)
          | (1ULL << devilangParser::T__57)
          | (1ULL << devilangParser::T__58)
          | (1ULL << devilangParser::T__59)
          | (1ULL << devilangParser::T__60)
          | (1ULL << devilangParser::T__61)
          | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
          ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
          | (1ULL << (devilangParser::T__64 - 64))
          | (1ULL << (devilangParser::T__65 - 64))
          | (1ULL << (devilangParser::T__66 - 64))
          | (1ULL << (devilangParser::T__67 - 64))
          | (1ULL << (devilangParser::T__68 - 64))
          | (1ULL << (devilangParser::T__69 - 64))
          | (1ULL << (devilangParser::T__70 - 64))
          | (1ULL << (devilangParser::T__71 - 64))
          | (1ULL << (devilangParser::T__72 - 64))
          | (1ULL << (devilangParser::T__73 - 64))
          | (1ULL << (devilangParser::T__74 - 64))
          | (1ULL << (devilangParser::T__75 - 64))
          | (1ULL << (devilangParser::T__76 - 64))
          | (1ULL << (devilangParser::T__112 - 64))
          | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
          setState(839);
          traceInstr();
          setState(844);
          _errHandler->sync(this);
          _la = _input->LA(1);
        }
        setState(845);
        match(devilangParser::T__2);
        break;
      }

      case devilangParser::T__54: {
        enterOuterAlt(_localctx, 2);
        setState(846);
        match(devilangParser::T__54);
        setState(847);
        match(devilangParser::T__1);
        setState(851);
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
          | (1ULL << devilangParser::T__53)
          | (1ULL << devilangParser::T__54)
          | (1ULL << devilangParser::T__55)
          | (1ULL << devilangParser::T__56)
          | (1ULL << devilangParser::T__57)
          | (1ULL << devilangParser::T__58)
          | (1ULL << devilangParser::T__59)
          | (1ULL << devilangParser::T__60)
          | (1ULL << devilangParser::T__61)
          | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
          ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
          | (1ULL << (devilangParser::T__64 - 64))
          | (1ULL << (devilangParser::T__65 - 64))
          | (1ULL << (devilangParser::T__66 - 64))
          | (1ULL << (devilangParser::T__67 - 64))
          | (1ULL << (devilangParser::T__68 - 64))
          | (1ULL << (devilangParser::T__69 - 64))
          | (1ULL << (devilangParser::T__70 - 64))
          | (1ULL << (devilangParser::T__71 - 64))
          | (1ULL << (devilangParser::T__72 - 64))
          | (1ULL << (devilangParser::T__73 - 64))
          | (1ULL << (devilangParser::T__74 - 64))
          | (1ULL << (devilangParser::T__75 - 64))
          | (1ULL << (devilangParser::T__76 - 64))
          | (1ULL << (devilangParser::T__112 - 64))
          | (1ULL << (devilangParser::IDENT - 64)))) != 0)) {
          setState(848);
          traceInstr();
          setState(853);
          _errHandler->sync(this);
          _la = _input->LA(1);
        }
        setState(854);
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

//----------------- TraceLabelBlockContext ------------------------------------------------------------------

devilangParser::TraceLabelBlockContext::TraceLabelBlockContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::LabelRefContext* devilangParser::TraceLabelBlockContext::labelRef() {
  return getRuleContext<devilangParser::LabelRefContext>(0);
}

devilangParser::TraceBlockContext* devilangParser::TraceLabelBlockContext::traceBlock() {
  return getRuleContext<devilangParser::TraceBlockContext>(0);
}


size_t devilangParser::TraceLabelBlockContext::getRuleIndex() const {
  return devilangParser::RuleTraceLabelBlock;
}

void devilangParser::TraceLabelBlockContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceLabelBlock(this);
}

void devilangParser::TraceLabelBlockContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceLabelBlock(this);
}

devilangParser::TraceLabelBlockContext* devilangParser::traceLabelBlock() {
  TraceLabelBlockContext *_localctx = _tracker.createInstance<TraceLabelBlockContext>(_ctx, getState());
  enterRule(_localctx, 128, devilangParser::RuleTraceLabelBlock);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(857);
    labelRef();
    setState(858);
    match(devilangParser::T__3);
    setState(859);
    traceBlock();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceInstrContext ------------------------------------------------------------------

devilangParser::TraceInstrContext::TraceInstrContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TraceBlockContext* devilangParser::TraceInstrContext::traceBlock() {
  return getRuleContext<devilangParser::TraceBlockContext>(0);
}

devilangParser::TraceAssignContext* devilangParser::TraceInstrContext::traceAssign() {
  return getRuleContext<devilangParser::TraceAssignContext>(0);
}

devilangParser::TraceWriteContext* devilangParser::TraceInstrContext::traceWrite() {
  return getRuleContext<devilangParser::TraceWriteContext>(0);
}

devilangParser::TraceCallContext* devilangParser::TraceInstrContext::traceCall() {
  return getRuleContext<devilangParser::TraceCallContext>(0);
}

devilangParser::TraceNeqjContext* devilangParser::TraceInstrContext::traceNeqj() {
  return getRuleContext<devilangParser::TraceNeqjContext>(0);
}

devilangParser::TraceBugContext* devilangParser::TraceInstrContext::traceBug() {
  return getRuleContext<devilangParser::TraceBugContext>(0);
}

devilangParser::TraceWarnContext* devilangParser::TraceInstrContext::traceWarn() {
  return getRuleContext<devilangParser::TraceWarnContext>(0);
}

devilangParser::EllipsisInstrContext* devilangParser::TraceInstrContext::ellipsisInstr() {
  return getRuleContext<devilangParser::EllipsisInstrContext>(0);
}


size_t devilangParser::TraceInstrContext::getRuleIndex() const {
  return devilangParser::RuleTraceInstr;
}

void devilangParser::TraceInstrContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceInstr(this);
}

void devilangParser::TraceInstrContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceInstr(this);
}

devilangParser::TraceInstrContext* devilangParser::traceInstr() {
  TraceInstrContext *_localctx = _tracker.createInstance<TraceInstrContext>(_ctx, getState());
  enterRule(_localctx, 130, devilangParser::RuleTraceInstr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(869);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 67, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(861);
      traceBlock();
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(862);
      traceAssign();
      break;
    }

    case 3: {
      enterOuterAlt(_localctx, 3);
      setState(863);
      traceWrite();
      break;
    }

    case 4: {
      enterOuterAlt(_localctx, 4);
      setState(864);
      traceCall();
      break;
    }

    case 5: {
      enterOuterAlt(_localctx, 5);
      setState(865);
      traceNeqj();
      break;
    }

    case 6: {
      enterOuterAlt(_localctx, 6);
      setState(866);
      traceBug();
      break;
    }

    case 7: {
      enterOuterAlt(_localctx, 7);
      setState(867);
      traceWarn();
      break;
    }

    case 8: {
      enterOuterAlt(_localctx, 8);
      setState(868);
      ellipsisInstr();
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

//----------------- TraceAssignContext ------------------------------------------------------------------

devilangParser::TraceAssignContext::TraceAssignContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::TraceAssignContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}

devilangParser::TraceExprContext* devilangParser::TraceAssignContext::traceExpr() {
  return getRuleContext<devilangParser::TraceExprContext>(0);
}


size_t devilangParser::TraceAssignContext::getRuleIndex() const {
  return devilangParser::RuleTraceAssign;
}

void devilangParser::TraceAssignContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceAssign(this);
}

void devilangParser::TraceAssignContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceAssign(this);
}

devilangParser::TraceAssignContext* devilangParser::traceAssign() {
  TraceAssignContext *_localctx = _tracker.createInstance<TraceAssignContext>(_ctx, getState());
  enterRule(_localctx, 132, devilangParser::RuleTraceAssign);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(871);
    qualifiedName();
    setState(872);
    match(devilangParser::T__89);
    setState(873);
    traceExpr();
    setState(874);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceWriteContext ------------------------------------------------------------------

devilangParser::TraceWriteContext::TraceWriteContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TraceExprContext *> devilangParser::TraceWriteContext::traceExpr() {
  return getRuleContexts<devilangParser::TraceExprContext>();
}

devilangParser::TraceExprContext* devilangParser::TraceWriteContext::traceExpr(size_t i) {
  return getRuleContext<devilangParser::TraceExprContext>(i);
}


size_t devilangParser::TraceWriteContext::getRuleIndex() const {
  return devilangParser::RuleTraceWrite;
}

void devilangParser::TraceWriteContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceWrite(this);
}

void devilangParser::TraceWriteContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceWrite(this);
}

devilangParser::TraceWriteContext* devilangParser::traceWrite() {
  TraceWriteContext *_localctx = _tracker.createInstance<TraceWriteContext>(_ctx, getState());
  enterRule(_localctx, 134, devilangParser::RuleTraceWrite);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(908);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__69: {
        enterOuterAlt(_localctx, 1);
        setState(876);
        match(devilangParser::T__69);
        setState(877);
        match(devilangParser::T__110);
        setState(878);
        traceExpr();
        setState(879);
        match(devilangParser::T__90);
        setState(880);
        traceExpr();
        setState(881);
        match(devilangParser::T__111);
        setState(882);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__70: {
        enterOuterAlt(_localctx, 2);
        setState(884);
        match(devilangParser::T__70);
        setState(885);
        match(devilangParser::T__110);
        setState(886);
        traceExpr();
        setState(887);
        match(devilangParser::T__90);
        setState(888);
        traceExpr();
        setState(889);
        match(devilangParser::T__111);
        setState(890);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__71: {
        enterOuterAlt(_localctx, 3);
        setState(892);
        match(devilangParser::T__71);
        setState(893);
        match(devilangParser::T__110);
        setState(894);
        traceExpr();
        setState(895);
        match(devilangParser::T__90);
        setState(896);
        traceExpr();
        setState(897);
        match(devilangParser::T__111);
        setState(898);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__72: {
        enterOuterAlt(_localctx, 4);
        setState(900);
        match(devilangParser::T__72);
        setState(901);
        match(devilangParser::T__110);
        setState(902);
        traceExpr();
        setState(903);
        match(devilangParser::T__90);
        setState(904);
        traceExpr();
        setState(905);
        match(devilangParser::T__111);
        setState(906);
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

//----------------- TraceCallContext ------------------------------------------------------------------

devilangParser::TraceCallContext::TraceCallContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::QualifiedNameContext* devilangParser::TraceCallContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}

devilangParser::TraceArgsContext* devilangParser::TraceCallContext::traceArgs() {
  return getRuleContext<devilangParser::TraceArgsContext>(0);
}


size_t devilangParser::TraceCallContext::getRuleIndex() const {
  return devilangParser::RuleTraceCall;
}

void devilangParser::TraceCallContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceCall(this);
}

void devilangParser::TraceCallContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceCall(this);
}

devilangParser::TraceCallContext* devilangParser::traceCall() {
  TraceCallContext *_localctx = _tracker.createInstance<TraceCallContext>(_ctx, getState());
  enterRule(_localctx, 136, devilangParser::RuleTraceCall);
  size_t _la = 0;

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(923);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 70, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(910);
      match(devilangParser::T__33);
      setState(911);
      qualifiedName();
      setState(912);
      match(devilangParser::T__110);
      setState(914);
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
        | (1ULL << devilangParser::T__53)
        | (1ULL << devilangParser::T__54)
        | (1ULL << devilangParser::T__55)
        | (1ULL << devilangParser::T__56)
        | (1ULL << devilangParser::T__57)
        | (1ULL << devilangParser::T__58)
        | (1ULL << devilangParser::T__59)
        | (1ULL << devilangParser::T__60)
        | (1ULL << devilangParser::T__61)
        | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
        ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
        | (1ULL << (devilangParser::T__64 - 64))
        | (1ULL << (devilangParser::T__65 - 64))
        | (1ULL << (devilangParser::T__66 - 64))
        | (1ULL << (devilangParser::T__67 - 64))
        | (1ULL << (devilangParser::T__68 - 64))
        | (1ULL << (devilangParser::T__69 - 64))
        | (1ULL << (devilangParser::T__70 - 64))
        | (1ULL << (devilangParser::T__71 - 64))
        | (1ULL << (devilangParser::T__72 - 64))
        | (1ULL << (devilangParser::T__73 - 64))
        | (1ULL << (devilangParser::T__74 - 64))
        | (1ULL << (devilangParser::T__75 - 64))
        | (1ULL << (devilangParser::T__76 - 64))
        | (1ULL << (devilangParser::T__110 - 64))
        | (1ULL << (devilangParser::IDENT - 64))
        | (1ULL << (devilangParser::INT - 64)))) != 0)) {
        setState(913);
        traceArgs();
      }
      setState(916);
      match(devilangParser::T__111);
      setState(917);
      match(devilangParser::T__4);
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(919);
      match(devilangParser::T__33);
      setState(920);
      qualifiedName();
      setState(921);
      match(devilangParser::T__4);
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

//----------------- TraceArgsContext ------------------------------------------------------------------

devilangParser::TraceArgsContext::TraceArgsContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TraceExprContext *> devilangParser::TraceArgsContext::traceExpr() {
  return getRuleContexts<devilangParser::TraceExprContext>();
}

devilangParser::TraceExprContext* devilangParser::TraceArgsContext::traceExpr(size_t i) {
  return getRuleContext<devilangParser::TraceExprContext>(i);
}


size_t devilangParser::TraceArgsContext::getRuleIndex() const {
  return devilangParser::RuleTraceArgs;
}

void devilangParser::TraceArgsContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceArgs(this);
}

void devilangParser::TraceArgsContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceArgs(this);
}

devilangParser::TraceArgsContext* devilangParser::traceArgs() {
  TraceArgsContext *_localctx = _tracker.createInstance<TraceArgsContext>(_ctx, getState());
  enterRule(_localctx, 138, devilangParser::RuleTraceArgs);
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
    setState(925);
    traceExpr();
    setState(930);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__90) {
      setState(926);
      match(devilangParser::T__90);
      setState(927);
      traceExpr();
      setState(932);
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

//----------------- TraceNeqjContext ------------------------------------------------------------------

devilangParser::TraceNeqjContext::TraceNeqjContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TraceExprContext *> devilangParser::TraceNeqjContext::traceExpr() {
  return getRuleContexts<devilangParser::TraceExprContext>();
}

devilangParser::TraceExprContext* devilangParser::TraceNeqjContext::traceExpr(size_t i) {
  return getRuleContext<devilangParser::TraceExprContext>(i);
}

devilangParser::LabelRefContext* devilangParser::TraceNeqjContext::labelRef() {
  return getRuleContext<devilangParser::LabelRefContext>(0);
}


size_t devilangParser::TraceNeqjContext::getRuleIndex() const {
  return devilangParser::RuleTraceNeqj;
}

void devilangParser::TraceNeqjContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceNeqj(this);
}

void devilangParser::TraceNeqjContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceNeqj(this);
}

devilangParser::TraceNeqjContext* devilangParser::traceNeqj() {
  TraceNeqjContext *_localctx = _tracker.createInstance<TraceNeqjContext>(_ctx, getState());
  enterRule(_localctx, 140, devilangParser::RuleTraceNeqj);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(933);
    match(devilangParser::T__76);
    setState(934);
    traceExpr();
    setState(935);
    match(devilangParser::T__90);
    setState(936);
    traceExpr();
    setState(937);
    match(devilangParser::T__90);
    setState(938);
    labelRef();
    setState(939);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceBugContext ------------------------------------------------------------------

devilangParser::TraceBugContext::TraceBugContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TraceExprContext* devilangParser::TraceBugContext::traceExpr() {
  return getRuleContext<devilangParser::TraceExprContext>(0);
}


size_t devilangParser::TraceBugContext::getRuleIndex() const {
  return devilangParser::RuleTraceBug;
}

void devilangParser::TraceBugContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceBug(this);
}

void devilangParser::TraceBugContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceBug(this);
}

devilangParser::TraceBugContext* devilangParser::traceBug() {
  TraceBugContext *_localctx = _tracker.createInstance<TraceBugContext>(_ctx, getState());
  enterRule(_localctx, 142, devilangParser::RuleTraceBug);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(951);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__73: {
        enterOuterAlt(_localctx, 1);
        setState(941);
        match(devilangParser::T__73);
        setState(942);
        match(devilangParser::T__110);
        setState(943);
        match(devilangParser::T__111);
        setState(944);
        match(devilangParser::T__4);
        break;
      }

      case devilangParser::T__74: {
        enterOuterAlt(_localctx, 2);
        setState(945);
        match(devilangParser::T__74);
        setState(946);
        match(devilangParser::T__110);
        setState(947);
        traceExpr();
        setState(948);
        match(devilangParser::T__111);
        setState(949);
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

//----------------- TraceWarnContext ------------------------------------------------------------------

devilangParser::TraceWarnContext::TraceWarnContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TraceExprContext* devilangParser::TraceWarnContext::traceExpr() {
  return getRuleContext<devilangParser::TraceExprContext>(0);
}


size_t devilangParser::TraceWarnContext::getRuleIndex() const {
  return devilangParser::RuleTraceWarn;
}

void devilangParser::TraceWarnContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceWarn(this);
}

void devilangParser::TraceWarnContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceWarn(this);
}

devilangParser::TraceWarnContext* devilangParser::traceWarn() {
  TraceWarnContext *_localctx = _tracker.createInstance<TraceWarnContext>(_ctx, getState());
  enterRule(_localctx, 144, devilangParser::RuleTraceWarn);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(953);
    match(devilangParser::T__75);
    setState(954);
    match(devilangParser::T__110);
    setState(955);
    traceExpr();
    setState(956);
    match(devilangParser::T__111);
    setState(957);
    match(devilangParser::T__4);
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- EllipsisInstrContext ------------------------------------------------------------------

devilangParser::EllipsisInstrContext::EllipsisInstrContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}


size_t devilangParser::EllipsisInstrContext::getRuleIndex() const {
  return devilangParser::RuleEllipsisInstr;
}

void devilangParser::EllipsisInstrContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterEllipsisInstr(this);
}

void devilangParser::EllipsisInstrContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitEllipsisInstr(this);
}

devilangParser::EllipsisInstrContext* devilangParser::ellipsisInstr() {
  EllipsisInstrContext *_localctx = _tracker.createInstance<EllipsisInstrContext>(_ctx, getState());
  enterRule(_localctx, 146, devilangParser::RuleEllipsisInstr);
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
    setState(959);
    match(devilangParser::T__112);
    setState(961);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__4) {
      setState(960);
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

//----------------- LabelRefContext ------------------------------------------------------------------

devilangParser::LabelRefContext::LabelRefContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::IdentContext* devilangParser::LabelRefContext::ident() {
  return getRuleContext<devilangParser::IdentContext>(0);
}


size_t devilangParser::LabelRefContext::getRuleIndex() const {
  return devilangParser::RuleLabelRef;
}

void devilangParser::LabelRefContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterLabelRef(this);
}

void devilangParser::LabelRefContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitLabelRef(this);
}

devilangParser::LabelRefContext* devilangParser::labelRef() {
  LabelRefContext *_localctx = _tracker.createInstance<LabelRefContext>(_ctx, getState());
  enterRule(_localctx, 148, devilangParser::RuleLabelRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(963);
    match(devilangParser::T__113);
    setState(964);
    ident();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TransitionDeclContext ------------------------------------------------------------------

devilangParser::TransitionDeclContext::TransitionDeclContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::IdentContext *> devilangParser::TransitionDeclContext::ident() {
  return getRuleContexts<devilangParser::IdentContext>();
}

devilangParser::IdentContext* devilangParser::TransitionDeclContext::ident(size_t i) {
  return getRuleContext<devilangParser::IdentContext>(i);
}


size_t devilangParser::TransitionDeclContext::getRuleIndex() const {
  return devilangParser::RuleTransitionDecl;
}

void devilangParser::TransitionDeclContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTransitionDecl(this);
}

void devilangParser::TransitionDeclContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTransitionDecl(this);
}

devilangParser::TransitionDeclContext* devilangParser::transitionDecl() {
  TransitionDeclContext *_localctx = _tracker.createInstance<TransitionDeclContext>(_ctx, getState());
  enterRule(_localctx, 150, devilangParser::RuleTransitionDecl);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(966);
    match(devilangParser::T__62);
    setState(967);
    ident();
    setState(968);
    match(devilangParser::T__114);
    setState(969);
    ident();
    setState(970);
    match(devilangParser::T__63);
    setState(971);
    ident();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceExprContext ------------------------------------------------------------------

devilangParser::TraceExprContext::TraceExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TraceOrExprContext* devilangParser::TraceExprContext::traceOrExpr() {
  return getRuleContext<devilangParser::TraceOrExprContext>(0);
}


size_t devilangParser::TraceExprContext::getRuleIndex() const {
  return devilangParser::RuleTraceExpr;
}

void devilangParser::TraceExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceExpr(this);
}

void devilangParser::TraceExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceExpr(this);
}

devilangParser::TraceExprContext* devilangParser::traceExpr() {
  TraceExprContext *_localctx = _tracker.createInstance<TraceExprContext>(_ctx, getState());
  enterRule(_localctx, 152, devilangParser::RuleTraceExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(973);
    traceOrExpr();
   
  }
  catch (RecognitionException &e) {
    _errHandler->reportError(this, e);
    _localctx->exception = std::current_exception();
    _errHandler->recover(this, _localctx->exception);
  }

  return _localctx;
}

//----------------- TraceOrExprContext ------------------------------------------------------------------

devilangParser::TraceOrExprContext::TraceOrExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TraceShiftExprContext *> devilangParser::TraceOrExprContext::traceShiftExpr() {
  return getRuleContexts<devilangParser::TraceShiftExprContext>();
}

devilangParser::TraceShiftExprContext* devilangParser::TraceOrExprContext::traceShiftExpr(size_t i) {
  return getRuleContext<devilangParser::TraceShiftExprContext>(i);
}


size_t devilangParser::TraceOrExprContext::getRuleIndex() const {
  return devilangParser::RuleTraceOrExpr;
}

void devilangParser::TraceOrExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceOrExpr(this);
}

void devilangParser::TraceOrExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceOrExpr(this);
}

devilangParser::TraceOrExprContext* devilangParser::traceOrExpr() {
  TraceOrExprContext *_localctx = _tracker.createInstance<TraceOrExprContext>(_ctx, getState());
  enterRule(_localctx, 154, devilangParser::RuleTraceOrExpr);
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
    setState(975);
    traceShiftExpr();
    setState(980);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__94) {
      setState(976);
      match(devilangParser::T__94);
      setState(977);
      traceShiftExpr();
      setState(982);
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

//----------------- TraceShiftExprContext ------------------------------------------------------------------

devilangParser::TraceShiftExprContext::TraceShiftExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TraceAddExprContext *> devilangParser::TraceShiftExprContext::traceAddExpr() {
  return getRuleContexts<devilangParser::TraceAddExprContext>();
}

devilangParser::TraceAddExprContext* devilangParser::TraceShiftExprContext::traceAddExpr(size_t i) {
  return getRuleContext<devilangParser::TraceAddExprContext>(i);
}


size_t devilangParser::TraceShiftExprContext::getRuleIndex() const {
  return devilangParser::RuleTraceShiftExpr;
}

void devilangParser::TraceShiftExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceShiftExpr(this);
}

void devilangParser::TraceShiftExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceShiftExpr(this);
}

devilangParser::TraceShiftExprContext* devilangParser::traceShiftExpr() {
  TraceShiftExprContext *_localctx = _tracker.createInstance<TraceShiftExprContext>(_ctx, getState());
  enterRule(_localctx, 156, devilangParser::RuleTraceShiftExpr);
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
    setState(983);
    traceAddExpr();
    setState(988);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__115

    || _la == devilangParser::T__116) {
      setState(984);
      _la = _input->LA(1);
      if (!(_la == devilangParser::T__115

      || _la == devilangParser::T__116)) {
      _errHandler->recoverInline(this);
      }
      else {
        _errHandler->reportMatch(this);
        consume();
      }
      setState(985);
      traceAddExpr();
      setState(990);
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

//----------------- TraceAddExprContext ------------------------------------------------------------------

devilangParser::TraceAddExprContext::TraceAddExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

std::vector<devilangParser::TracePrimaryExprContext *> devilangParser::TraceAddExprContext::tracePrimaryExpr() {
  return getRuleContexts<devilangParser::TracePrimaryExprContext>();
}

devilangParser::TracePrimaryExprContext* devilangParser::TraceAddExprContext::tracePrimaryExpr(size_t i) {
  return getRuleContext<devilangParser::TracePrimaryExprContext>(i);
}


size_t devilangParser::TraceAddExprContext::getRuleIndex() const {
  return devilangParser::RuleTraceAddExpr;
}

void devilangParser::TraceAddExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTraceAddExpr(this);
}

void devilangParser::TraceAddExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTraceAddExpr(this);
}

devilangParser::TraceAddExprContext* devilangParser::traceAddExpr() {
  TraceAddExprContext *_localctx = _tracker.createInstance<TraceAddExprContext>(_ctx, getState());
  enterRule(_localctx, 158, devilangParser::RuleTraceAddExpr);
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
    setState(991);
    tracePrimaryExpr();
    setState(996);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__117

    || _la == devilangParser::T__118) {
      setState(992);
      _la = _input->LA(1);
      if (!(_la == devilangParser::T__117

      || _la == devilangParser::T__118)) {
      _errHandler->recoverInline(this);
      }
      else {
        _errHandler->reportMatch(this);
        consume();
      }
      setState(993);
      tracePrimaryExpr();
      setState(998);
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

//----------------- TracePrimaryExprContext ------------------------------------------------------------------

devilangParser::TracePrimaryExprContext::TracePrimaryExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

tree::TerminalNode* devilangParser::TracePrimaryExprContext::INT() {
  return getToken(devilangParser::INT, 0);
}

devilangParser::QualifiedNameContext* devilangParser::TracePrimaryExprContext::qualifiedName() {
  return getRuleContext<devilangParser::QualifiedNameContext>(0);
}

devilangParser::ReadExprContext* devilangParser::TracePrimaryExprContext::readExpr() {
  return getRuleContext<devilangParser::ReadExprContext>(0);
}

devilangParser::FuncCallContext* devilangParser::TracePrimaryExprContext::funcCall() {
  return getRuleContext<devilangParser::FuncCallContext>(0);
}

devilangParser::TraceExprContext* devilangParser::TracePrimaryExprContext::traceExpr() {
  return getRuleContext<devilangParser::TraceExprContext>(0);
}


size_t devilangParser::TracePrimaryExprContext::getRuleIndex() const {
  return devilangParser::RuleTracePrimaryExpr;
}

void devilangParser::TracePrimaryExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterTracePrimaryExpr(this);
}

void devilangParser::TracePrimaryExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitTracePrimaryExpr(this);
}

devilangParser::TracePrimaryExprContext* devilangParser::tracePrimaryExpr() {
  TracePrimaryExprContext *_localctx = _tracker.createInstance<TracePrimaryExprContext>(_ctx, getState());
  enterRule(_localctx, 160, devilangParser::RuleTracePrimaryExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(1008);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 77, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(999);
      match(devilangParser::INT);
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(1000);
      match(devilangParser::T__44);
      break;
    }

    case 3: {
      enterOuterAlt(_localctx, 3);
      setState(1001);
      qualifiedName();
      break;
    }

    case 4: {
      enterOuterAlt(_localctx, 4);
      setState(1002);
      readExpr();
      break;
    }

    case 5: {
      enterOuterAlt(_localctx, 5);
      setState(1003);
      funcCall();
      break;
    }

    case 6: {
      enterOuterAlt(_localctx, 6);
      setState(1004);
      match(devilangParser::T__110);
      setState(1005);
      traceExpr();
      setState(1006);
      match(devilangParser::T__111);
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

//----------------- ReadExprContext ------------------------------------------------------------------

devilangParser::ReadExprContext::ReadExprContext(ParserRuleContext *parent, size_t invokingState)
  : ParserRuleContext(parent, invokingState) {
}

devilangParser::TraceExprContext* devilangParser::ReadExprContext::traceExpr() {
  return getRuleContext<devilangParser::TraceExprContext>(0);
}


size_t devilangParser::ReadExprContext::getRuleIndex() const {
  return devilangParser::RuleReadExpr;
}

void devilangParser::ReadExprContext::enterRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->enterReadExpr(this);
}

void devilangParser::ReadExprContext::exitRule(tree::ParseTreeListener *listener) {
  auto parserListener = dynamic_cast<devilangListener *>(listener);
  if (parserListener != nullptr)
    parserListener->exitReadExpr(this);
}

devilangParser::ReadExprContext* devilangParser::readExpr() {
  ReadExprContext *_localctx = _tracker.createInstance<ReadExprContext>(_ctx, getState());
  enterRule(_localctx, 162, devilangParser::RuleReadExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(1030);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::T__65: {
        enterOuterAlt(_localctx, 1);
        setState(1010);
        match(devilangParser::T__65);
        setState(1011);
        match(devilangParser::T__110);
        setState(1012);
        traceExpr();
        setState(1013);
        match(devilangParser::T__111);
        break;
      }

      case devilangParser::T__66: {
        enterOuterAlt(_localctx, 2);
        setState(1015);
        match(devilangParser::T__66);
        setState(1016);
        match(devilangParser::T__110);
        setState(1017);
        traceExpr();
        setState(1018);
        match(devilangParser::T__111);
        break;
      }

      case devilangParser::T__67: {
        enterOuterAlt(_localctx, 3);
        setState(1020);
        match(devilangParser::T__67);
        setState(1021);
        match(devilangParser::T__110);
        setState(1022);
        traceExpr();
        setState(1023);
        match(devilangParser::T__111);
        break;
      }

      case devilangParser::T__68: {
        enterOuterAlt(_localctx, 4);
        setState(1025);
        match(devilangParser::T__68);
        setState(1026);
        match(devilangParser::T__110);
        setState(1027);
        traceExpr();
        setState(1028);
        match(devilangParser::T__111);
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
  enterRule(_localctx, 164, devilangParser::RuleOpExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(1032);
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
  enterRule(_localctx, 166, devilangParser::RuleOpOrExpr);
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
    setState(1034);
    opAndExpr();
    setState(1039);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__94) {
      setState(1035);
      match(devilangParser::T__94);
      setState(1036);
      opAndExpr();
      setState(1041);
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
  enterRule(_localctx, 168, devilangParser::RuleOpAndExpr);
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
    setState(1042);
    opAddExpr();
    setState(1047);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__119) {
      setState(1043);
      match(devilangParser::T__119);
      setState(1044);
      opAddExpr();
      setState(1049);
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
  enterRule(_localctx, 170, devilangParser::RuleOpAddExpr);
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
    setState(1050);
    opShiftExpr();
    setState(1055);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__117) {
      setState(1051);
      match(devilangParser::T__117);
      setState(1052);
      opShiftExpr();
      setState(1057);
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
  enterRule(_localctx, 172, devilangParser::RuleOpShiftExpr);
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
    setState(1058);
    opPrimaryExpr();
    setState(1063);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__115

    || _la == devilangParser::T__116) {
      setState(1059);
      _la = _input->LA(1);
      if (!(_la == devilangParser::T__115

      || _la == devilangParser::T__116)) {
      _errHandler->recoverInline(this);
      }
      else {
        _errHandler->reportMatch(this);
        consume();
      }
      setState(1060);
      opPrimaryExpr();
      setState(1065);
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
  enterRule(_localctx, 174, devilangParser::RuleOpPrimaryExpr);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(1074);
    _errHandler->sync(this);
    switch (getInterpreter<atn::ParserATNSimulator>()->adaptivePredict(_input, 83, _ctx)) {
    case 1: {
      enterOuterAlt(_localctx, 1);
      setState(1066);
      match(devilangParser::INT);
      break;
    }

    case 2: {
      enterOuterAlt(_localctx, 2);
      setState(1067);
      match(devilangParser::T__44);
      break;
    }

    case 3: {
      enterOuterAlt(_localctx, 3);
      setState(1068);
      ref();
      break;
    }

    case 4: {
      enterOuterAlt(_localctx, 4);
      setState(1069);
      funcCall();
      break;
    }

    case 5: {
      enterOuterAlt(_localctx, 5);
      setState(1070);
      match(devilangParser::T__110);
      setState(1071);
      opExpr();
      setState(1072);
      match(devilangParser::T__111);
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
  enterRule(_localctx, 176, devilangParser::RuleFuncCall);
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
    setState(1076);
    qualifiedName();
    setState(1077);
    match(devilangParser::T__110);
    setState(1079);
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
      | (1ULL << devilangParser::T__53)
      | (1ULL << devilangParser::T__54)
      | (1ULL << devilangParser::T__55)
      | (1ULL << devilangParser::T__56)
      | (1ULL << devilangParser::T__57)
      | (1ULL << devilangParser::T__58)
      | (1ULL << devilangParser::T__59)
      | (1ULL << devilangParser::T__60)
      | (1ULL << devilangParser::T__61)
      | (1ULL << devilangParser::T__62))) != 0) || ((((_la - 64) & ~ 0x3fULL) == 0) &&
      ((1ULL << (_la - 64)) & ((1ULL << (devilangParser::T__63 - 64))
      | (1ULL << (devilangParser::T__64 - 64))
      | (1ULL << (devilangParser::T__65 - 64))
      | (1ULL << (devilangParser::T__66 - 64))
      | (1ULL << (devilangParser::T__67 - 64))
      | (1ULL << (devilangParser::T__68 - 64))
      | (1ULL << (devilangParser::T__69 - 64))
      | (1ULL << (devilangParser::T__70 - 64))
      | (1ULL << (devilangParser::T__71 - 64))
      | (1ULL << (devilangParser::T__72 - 64))
      | (1ULL << (devilangParser::T__73 - 64))
      | (1ULL << (devilangParser::T__74 - 64))
      | (1ULL << (devilangParser::T__75 - 64))
      | (1ULL << (devilangParser::T__76 - 64))
      | (1ULL << (devilangParser::T__110 - 64))
      | (1ULL << (devilangParser::IDENT - 64))
      | (1ULL << (devilangParser::INT - 64)))) != 0)) {
      setState(1078);
      funcArgs();
    }
    setState(1081);
    match(devilangParser::T__111);
   
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
  enterRule(_localctx, 178, devilangParser::RuleFuncArgs);
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
    setState(1083);
    opExpr();
    setState(1088);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__90) {
      setState(1084);
      match(devilangParser::T__90);
      setState(1085);
      opExpr();
      setState(1090);
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
  enterRule(_localctx, 180, devilangParser::RuleQualifiedName);
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
    setState(1091);
    ident();
    setState(1096);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__109) {
      setState(1092);
      match(devilangParser::T__109);
      setState(1093);
      ident();
      setState(1098);
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
  enterRule(_localctx, 182, devilangParser::RuleFileName);
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
    setState(1099);
    ident();
    setState(1104);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__118) {
      setState(1100);
      match(devilangParser::T__118);
      setState(1101);
      ident();
      setState(1106);
      _errHandler->sync(this);
      _la = _input->LA(1);
    }
    setState(1109);
    _errHandler->sync(this);

    _la = _input->LA(1);
    if (_la == devilangParser::T__109) {
      setState(1107);
      match(devilangParser::T__109);
      setState(1108);
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
  enterRule(_localctx, 184, devilangParser::RuleRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(1111);
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
  enterRule(_localctx, 186, devilangParser::RuleFieldRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(1113);
    match(devilangParser::T__109);
    setState(1114);
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
  enterRule(_localctx, 188, devilangParser::RuleBitRef);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    enterOuterAlt(_localctx, 1);
    setState(1116);
    ref();
    setState(1117);
    match(devilangParser::T__85);
    setState(1118);
    match(devilangParser::INT);
    setState(1119);
    match(devilangParser::T__86);
   
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
  enterRule(_localctx, 190, devilangParser::RuleExpr);
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
    setState(1121);
    primary();
    setState(1126);
    _errHandler->sync(this);
    _la = _input->LA(1);
    while (_la == devilangParser::T__117

    || _la == devilangParser::T__118) {
      setState(1122);
      _la = _input->LA(1);
      if (!(_la == devilangParser::T__117

      || _la == devilangParser::T__118)) {
      _errHandler->recoverInline(this);
      }
      else {
        _errHandler->reportMatch(this);
        consume();
      }
      setState(1123);
      primary();
      setState(1128);
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
  enterRule(_localctx, 192, devilangParser::RulePrimary);

#if __cplusplus > 201703L
  auto onExit = finally([=, this] {
#else
  auto onExit = finally([=] {
#endif
    exitRule();
  });
  try {
    setState(1135);
    _errHandler->sync(this);
    switch (_input->LA(1)) {
      case devilangParser::INT: {
        enterOuterAlt(_localctx, 1);
        setState(1129);
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
      case devilangParser::T__54:
      case devilangParser::T__55:
      case devilangParser::T__56:
      case devilangParser::T__57:
      case devilangParser::T__58:
      case devilangParser::T__59:
      case devilangParser::T__60:
      case devilangParser::T__61:
      case devilangParser::T__62:
      case devilangParser::T__63:
      case devilangParser::T__64:
      case devilangParser::T__65:
      case devilangParser::T__66:
      case devilangParser::T__67:
      case devilangParser::T__68:
      case devilangParser::T__69:
      case devilangParser::T__70:
      case devilangParser::T__71:
      case devilangParser::T__72:
      case devilangParser::T__73:
      case devilangParser::T__74:
      case devilangParser::T__75:
      case devilangParser::T__76:
      case devilangParser::IDENT: {
        enterOuterAlt(_localctx, 2);
        setState(1130);
        ref();
        break;
      }

      case devilangParser::T__110: {
        enterOuterAlt(_localctx, 3);
        setState(1131);
        match(devilangParser::T__110);
        setState(1132);
        expr();
        setState(1133);
        match(devilangParser::T__111);
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
  enterRule(_localctx, 194, devilangParser::RuleBoolLiteral);
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
    setState(1137);
    _la = _input->LA(1);
    if (!(_la == devilangParser::T__120

    || _la == devilangParser::T__121)) {
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
  "topFuncItem", "machineDecl", "machineItem", "importDecl", "initialDecl", 
  "scratchDecl", "scratchField", "machineStateDecl", "traceDecl", "traceItem", 
  "traceBlock", "traceLabelBlock", "traceInstr", "traceAssign", "traceWrite", 
  "traceCall", "traceArgs", "traceNeqj", "traceBug", "traceWarn", "ellipsisInstr", 
  "labelRef", "transitionDecl", "traceExpr", "traceOrExpr", "traceShiftExpr", 
  "traceAddExpr", "tracePrimaryExpr", "readExpr", "opExpr", "opOrExpr", 
  "opAndExpr", "opAddExpr", "opShiftExpr", "opPrimaryExpr", "funcCall", 
  "funcArgs", "qualifiedName", "fileName", "ref", "fieldRef", "bitRef", 
  "expr", "primary", "boolLiteral"
};

std::vector<std::string> devilangParser::_literalNames = {
  "", "'struct'", "'{'", "'}'", "':'", "';'", "'count'", "'size'", "'head'", 
  "'tail'", "'next'", "'prev'", "'base'", "'align'", "'from'", "'to'", "'sentinel'", 
  "'position'", "'link'", "'status'", "'command'", "'control'", "'flags'", 
  "'data'", "'addr'", "'buf'", "'buffer'", "'tag'", "'id'", "'sig'", "'ctrl'", 
  "'token'", "'inst'", "'arg'", "'call'", "'op'", "'bb'", "'path'", "'func'", 
  "'mmio'", "'direction'", "'region'", "'address'", "'r'", "'w'", "'unknown'", 
  "'phi'", "'select'", "'num'", "'var'", "'flag'", "'random'", "'immediate'", 
  "'state'", "'seq'", "'repeat'", "'value'", "'machine'", "'initial'", "'final'", 
  "'scratch'", "'trace'", "'import'", "'transition'", "'on'", "'sequence'", 
  "'read8'", "'read16'", "'read32'", "'read64'", "'write8'", "'write16'", 
  "'write32'", "'write64'", "'BUG'", "'BUG_ON'", "'WARN_ON'", "'neqj'", 
  "'u8'", "'u16'", "'u32'", "'u64'", "'ptr'", "'<'", "'>'", "'bytes'", "'['", 
  "']'", "'bits'", "'..'", "'='", "','", "'imm'", "'range'", "'pointer'", 
  "'|'", "'list'", "'dlist'", "'ring'", "'ringbuf'", "'backend'", "'file'", 
  "'filename'", "'caller'", "'target'", "'callee'", "'depth'", "'call_depth'", 
  "'argument_index'", "'action'", "'.'", "'('", "')'", "'...'", "'@'", "'->'", 
  "'<<'", "'>>'", "'+'", "'-'", "'&'", "'true'", "'false'"
};

std::vector<std::string> devilangParser::_symbolicNames = {
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "IDENT", "INT", 
  "STRING", "WS", "LINE_COMMENT", "BLOCK_COMMENT"
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
       0x3, 0x82, 0x476, 0x4, 0x2, 0x9, 0x2, 0x4, 0x3, 0x9, 0x3, 0x4, 0x4, 
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
       0x9, 0x50, 0x4, 0x51, 0x9, 0x51, 0x4, 0x52, 0x9, 0x52, 0x4, 0x53, 
       0x9, 0x53, 0x4, 0x54, 0x9, 0x54, 0x4, 0x55, 0x9, 0x55, 0x4, 0x56, 
       0x9, 0x56, 0x4, 0x57, 0x9, 0x57, 0x4, 0x58, 0x9, 0x58, 0x4, 0x59, 
       0x9, 0x59, 0x4, 0x5a, 0x9, 0x5a, 0x4, 0x5b, 0x9, 0x5b, 0x4, 0x5c, 
       0x9, 0x5c, 0x4, 0x5d, 0x9, 0x5d, 0x4, 0x5e, 0x9, 0x5e, 0x4, 0x5f, 
       0x9, 0x5f, 0x4, 0x60, 0x9, 0x60, 0x4, 0x61, 0x9, 0x61, 0x4, 0x62, 
       0x9, 0x62, 0x4, 0x63, 0x9, 0x63, 0x3, 0x2, 0x7, 0x2, 0xc8, 0xa, 0x2, 
       0xc, 0x2, 0xe, 0x2, 0xcb, 0xb, 0x2, 0x3, 0x2, 0x3, 0x2, 0x3, 0x3, 
       0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 
       0x3, 0x5, 0x3, 0xd7, 0xa, 0x3, 0x3, 0x4, 0x3, 0x4, 0x3, 0x4, 0x3, 
       0x4, 0x7, 0x4, 0xdd, 0xa, 0x4, 0xc, 0x4, 0xe, 0x4, 0xe0, 0xb, 0x4, 
       0x3, 0x4, 0x3, 0x4, 0x3, 0x5, 0x3, 0x5, 0x3, 0x5, 0x3, 0x5, 0x7, 
       0x5, 0xe8, 0xa, 0x5, 0xc, 0x5, 0xe, 0x5, 0xeb, 0xb, 0x5, 0x3, 0x5, 
       0x5, 0x5, 0xee, 0xa, 0x5, 0x3, 0x5, 0x5, 0x5, 0xf1, 0xa, 0x5, 0x3, 
       0x5, 0x3, 0x5, 0x3, 0x6, 0x3, 0x6, 0x3, 0x7, 0x3, 0x7, 0x3, 0x7, 
       0x5, 0x7, 0xfa, 0xa, 0x7, 0x3, 0x8, 0x3, 0x8, 0x3, 0x9, 0x3, 0x9, 
       0x3, 0x9, 0x3, 0x9, 0x3, 0x9, 0x3, 0xa, 0x3, 0xa, 0x3, 0xa, 0x3, 
       0xa, 0x3, 0xa, 0x3, 0xb, 0x3, 0xb, 0x3, 0xb, 0x3, 0xb, 0x3, 0xb, 
       0x5, 0xb, 0x10d, 0xa, 0xb, 0x3, 0xc, 0x3, 0xc, 0x3, 0xc, 0x3, 0xc, 
       0x3, 0xc, 0x7, 0xc, 0x114, 0xa, 0xc, 0xc, 0xc, 0xe, 0xc, 0x117, 0xb, 
       0xc, 0x3, 0xc, 0x5, 0xc, 0x11a, 0xa, 0xc, 0x5, 0xc, 0x11c, 0xa, 0xc, 
       0x3, 0xc, 0x3, 0xc, 0x3, 0xd, 0x3, 0xd, 0x5, 0xd, 0x122, 0xa, 0xd, 
       0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 0xe, 0x3, 
       0xe, 0x5, 0xe, 0x12b, 0xa, 0xe, 0x3, 0xf, 0x3, 0xf, 0x3, 0xf, 0x3, 
       0x10, 0x3, 0x10, 0x3, 0x11, 0x3, 0x11, 0x3, 0x11, 0x3, 0x11, 0x3, 
       0x11, 0x7, 0x11, 0x137, 0xa, 0x11, 0xc, 0x11, 0xe, 0x11, 0x13a, 0xb, 
       0x11, 0x3, 0x11, 0x5, 0x11, 0x13d, 0xa, 0x11, 0x5, 0x11, 0x13f, 0xa, 
       0x11, 0x3, 0x11, 0x3, 0x11, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 
       0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 0x12, 0x3, 
       0x12, 0x5, 0x12, 0x14d, 0xa, 0x12, 0x3, 0x13, 0x3, 0x13, 0x3, 0x14, 
       0x3, 0x14, 0x3, 0x14, 0x3, 0x14, 0x3, 0x14, 0x3, 0x14, 0x5, 0x14, 
       0x157, 0xa, 0x14, 0x3, 0x15, 0x3, 0x15, 0x3, 0x15, 0x7, 0x15, 0x15c, 
       0xa, 0x15, 0xc, 0x15, 0xe, 0x15, 0x15f, 0xb, 0x15, 0x3, 0x15, 0x3, 
       0x15, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 
       0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x3, 0x16, 0x5, 0x16, 0x17f, 
       0xa, 0x16, 0x3, 0x17, 0x3, 0x17, 0x3, 0x17, 0x7, 0x17, 0x184, 0xa, 
       0x17, 0xc, 0x17, 0xe, 0x17, 0x187, 0xb, 0x17, 0x3, 0x18, 0x3, 0x18, 
       0x3, 0x18, 0x3, 0x18, 0x3, 0x18, 0x5, 0x18, 0x18e, 0xa, 0x18, 0x3, 
       0x18, 0x3, 0x18, 0x3, 0x18, 0x3, 0x18, 0x3, 0x19, 0x3, 0x19, 0x3, 
       0x19, 0x3, 0x19, 0x3, 0x19, 0x5, 0x19, 0x199, 0xa, 0x19, 0x3, 0x19, 
       0x3, 0x19, 0x3, 0x19, 0x3, 0x19, 0x3, 0x1a, 0x3, 0x1a, 0x3, 0x1a, 
       0x3, 0x1a, 0x3, 0x1a, 0x5, 0x1a, 0x1a4, 0xa, 0x1a, 0x3, 0x1a, 0x3, 
       0x1a, 0x3, 0x1a, 0x3, 0x1a, 0x3, 0x1b, 0x3, 0x1b, 0x3, 0x1b, 0x3, 
       0x1b, 0x3, 0x1b, 0x5, 0x1b, 0x1af, 0xa, 0x1b, 0x3, 0x1b, 0x3, 0x1b, 
       0x3, 0x1b, 0x3, 0x1b, 0x3, 0x1c, 0x3, 0x1c, 0x3, 0x1c, 0x7, 0x1c, 
       0x1b8, 0xa, 0x1c, 0xc, 0x1c, 0xe, 0x1c, 0x1bb, 0xb, 0x1c, 0x3, 0x1d, 
       0x6, 0x1d, 0x1be, 0xa, 0x1d, 0xd, 0x1d, 0xe, 0x1d, 0x1bf, 0x3, 0x1e, 
       0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 
       0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 
       0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x5, 0x1e, 0x1d3, 0xa, 
       0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x3, 0x1e, 0x5, 0x1e, 0x1d9, 
       0xa, 0x1e, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 
       0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 
       0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 
       0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x5, 0x1f, 0x1f0, 0xa, 
       0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x3, 0x1f, 0x5, 0x1f, 0x1f6, 
       0xa, 0x1f, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 
       0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 0x3, 0x20, 
       0x3, 0x20, 0x5, 0x20, 0x204, 0xa, 0x20, 0x3, 0x21, 0x3, 0x21, 0x3, 
       0x21, 0x7, 0x21, 0x209, 0xa, 0x21, 0xc, 0x21, 0xe, 0x21, 0x20c, 0xb, 
       0x21, 0x3, 0x21, 0x3, 0x21, 0x3, 0x21, 0x7, 0x21, 0x211, 0xa, 0x21, 
       0xc, 0x21, 0xe, 0x21, 0x214, 0xb, 0x21, 0x5, 0x21, 0x216, 0xa, 0x21, 
       0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 
       0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 
       0x3, 0x22, 0x5, 0x22, 0x225, 0xa, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 
       0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 
       0x22, 0x3, 0x22, 0x3, 0x22, 0x3, 0x22, 0x5, 0x22, 0x233, 0xa, 0x22, 
       0x3, 0x23, 0x3, 0x23, 0x5, 0x23, 0x237, 0xa, 0x23, 0x3, 0x23, 0x3, 
       0x23, 0x7, 0x23, 0x23b, 0xa, 0x23, 0xc, 0x23, 0xe, 0x23, 0x23e, 0xb, 
       0x23, 0x3, 0x23, 0x3, 0x23, 0x3, 0x24, 0x3, 0x24, 0x3, 0x25, 0x3, 
       0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 
       0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x3, 0x25, 0x5, 0x25, 0x250, 
       0xa, 0x25, 0x3, 0x26, 0x3, 0x26, 0x3, 0x26, 0x7, 0x26, 0x255, 0xa, 
       0x26, 0xc, 0x26, 0xe, 0x26, 0x258, 0xb, 0x26, 0x3, 0x27, 0x3, 0x27, 
       0x3, 0x27, 0x3, 0x27, 0x7, 0x27, 0x25e, 0xa, 0x27, 0xc, 0x27, 0xe, 
       0x27, 0x261, 0xb, 0x27, 0x3, 0x27, 0x5, 0x27, 0x264, 0xa, 0x27, 0x3, 
       0x27, 0x3, 0x27, 0x3, 0x27, 0x7, 0x27, 0x269, 0xa, 0x27, 0xc, 0x27, 
       0xe, 0x27, 0x26c, 0xb, 0x27, 0x5, 0x27, 0x26e, 0xa, 0x27, 0x3, 0x27, 
       0x3, 0x27, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 
       0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x3, 0x28, 0x5, 0x28, 0x293, 0xa, 
       0x28, 0x3, 0x29, 0x3, 0x29, 0x5, 0x29, 0x297, 0xa, 0x29, 0x3, 0x2a, 
       0x3, 0x2a, 0x3, 0x2a, 0x3, 0x2a, 0x3, 0x2a, 0x3, 0x2b, 0x3, 0x2b, 
       0x3, 0x2b, 0x3, 0x2b, 0x3, 0x2b, 0x3, 0x2b, 0x3, 0x2c, 0x3, 0x2c, 
       0x5, 0x2c, 0x2a6, 0xa, 0x2c, 0x3, 0x2d, 0x3, 0x2d, 0x3, 0x2d, 0x3, 
       0x2d, 0x3, 0x2e, 0x3, 0x2e, 0x3, 0x2e, 0x3, 0x2e, 0x7, 0x2e, 0x2b0, 
       0xa, 0x2e, 0xc, 0x2e, 0xe, 0x2e, 0x2b3, 0xb, 0x2e, 0x3, 0x2e, 0x3, 
       0x2e, 0x3, 0x2f, 0x3, 0x2f, 0x3, 0x2f, 0x3, 0x2f, 0x6, 0x2f, 0x2bb, 
       0xa, 0x2f, 0xd, 0x2f, 0xe, 0x2f, 0x2bc, 0x7, 0x2f, 0x2bf, 0xa, 0x2f, 
       0xc, 0x2f, 0xe, 0x2f, 0x2c2, 0xb, 0x2f, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 0x30, 0x3, 
       0x30, 0x3, 0x30, 0x3, 0x30, 0x5, 0x30, 0x2db, 0xa, 0x30, 0x3, 0x31, 
       0x3, 0x31, 0x3, 0x32, 0x3, 0x32, 0x3, 0x32, 0x3, 0x32, 0x6, 0x32, 
       0x2e3, 0xa, 0x32, 0xd, 0x32, 0xe, 0x32, 0x2e4, 0x3, 0x32, 0x3, 0x32, 
       0x3, 0x33, 0x3, 0x33, 0x3, 0x33, 0x3, 0x33, 0x3, 0x34, 0x3, 0x34, 
       0x3, 0x34, 0x3, 0x34, 0x6, 0x34, 0x2f1, 0xa, 0x34, 0xd, 0x34, 0xe, 
       0x34, 0x2f2, 0x3, 0x34, 0x3, 0x34, 0x3, 0x35, 0x3, 0x35, 0x3, 0x35, 
       0x3, 0x36, 0x3, 0x36, 0x3, 0x36, 0x3, 0x36, 0x6, 0x36, 0x2fe, 0xa, 
       0x36, 0xd, 0x36, 0xe, 0x36, 0x2ff, 0x3, 0x36, 0x3, 0x36, 0x3, 0x37, 
       0x3, 0x37, 0x3, 0x37, 0x3, 0x37, 0x3, 0x38, 0x7, 0x38, 0x309, 0xa, 
       0x38, 0xc, 0x38, 0xe, 0x38, 0x30c, 0xb, 0x38, 0x3, 0x38, 0x3, 0x38, 
       0x3, 0x38, 0x3, 0x38, 0x7, 0x38, 0x312, 0xa, 0x38, 0xc, 0x38, 0xe, 
       0x38, 0x315, 0xb, 0x38, 0x3, 0x38, 0x3, 0x38, 0x3, 0x39, 0x3, 0x39, 
       0x3, 0x39, 0x3, 0x39, 0x3, 0x39, 0x5, 0x39, 0x31e, 0xa, 0x39, 0x3, 
       0x3a, 0x3, 0x3a, 0x3, 0x3a, 0x5, 0x3a, 0x323, 0xa, 0x3a, 0x3, 0x3b, 
       0x3, 0x3b, 0x3, 0x3b, 0x3, 0x3c, 0x3, 0x3c, 0x3, 0x3c, 0x6, 0x3c, 
       0x32b, 0xa, 0x3c, 0xd, 0x3c, 0xe, 0x3c, 0x32c, 0x3, 0x3c, 0x3, 0x3c, 
       0x3, 0x3d, 0x3, 0x3d, 0x3, 0x3d, 0x3, 0x3e, 0x5, 0x3e, 0x335, 0xa, 
       0x3e, 0x3, 0x3e, 0x3, 0x3e, 0x3, 0x3e, 0x3, 0x3f, 0x3, 0x3f, 0x3, 
       0x3f, 0x3, 0x3f, 0x6, 0x3f, 0x33e, 0xa, 0x3f, 0xd, 0x3f, 0xe, 0x3f, 
       0x33f, 0x3, 0x3f, 0x3, 0x3f, 0x3, 0x40, 0x3, 0x40, 0x5, 0x40, 0x346, 
       0xa, 0x40, 0x3, 0x41, 0x3, 0x41, 0x3, 0x41, 0x7, 0x41, 0x34b, 0xa, 
       0x41, 0xc, 0x41, 0xe, 0x41, 0x34e, 0xb, 0x41, 0x3, 0x41, 0x3, 0x41, 
       0x3, 0x41, 0x3, 0x41, 0x7, 0x41, 0x354, 0xa, 0x41, 0xc, 0x41, 0xe, 
       0x41, 0x357, 0xb, 0x41, 0x3, 0x41, 0x5, 0x41, 0x35a, 0xa, 0x41, 0x3, 
       0x42, 0x3, 0x42, 0x3, 0x42, 0x3, 0x42, 0x3, 0x43, 0x3, 0x43, 0x3, 
       0x43, 0x3, 0x43, 0x3, 0x43, 0x3, 0x43, 0x3, 0x43, 0x3, 0x43, 0x5, 
       0x43, 0x368, 0xa, 0x43, 0x3, 0x44, 0x3, 0x44, 0x3, 0x44, 0x3, 0x44, 
       0x3, 0x44, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 
       0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 
       0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 
       0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 
       0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 
       0x3, 0x45, 0x3, 0x45, 0x3, 0x45, 0x5, 0x45, 0x38f, 0xa, 0x45, 0x3, 
       0x46, 0x3, 0x46, 0x3, 0x46, 0x3, 0x46, 0x5, 0x46, 0x395, 0xa, 0x46, 
       0x3, 0x46, 0x3, 0x46, 0x3, 0x46, 0x3, 0x46, 0x3, 0x46, 0x3, 0x46, 
       0x3, 0x46, 0x5, 0x46, 0x39e, 0xa, 0x46, 0x3, 0x47, 0x3, 0x47, 0x3, 
       0x47, 0x7, 0x47, 0x3a3, 0xa, 0x47, 0xc, 0x47, 0xe, 0x47, 0x3a6, 0xb, 
       0x47, 0x3, 0x48, 0x3, 0x48, 0x3, 0x48, 0x3, 0x48, 0x3, 0x48, 0x3, 
       0x48, 0x3, 0x48, 0x3, 0x48, 0x3, 0x49, 0x3, 0x49, 0x3, 0x49, 0x3, 
       0x49, 0x3, 0x49, 0x3, 0x49, 0x3, 0x49, 0x3, 0x49, 0x3, 0x49, 0x3, 
       0x49, 0x5, 0x49, 0x3ba, 0xa, 0x49, 0x3, 0x4a, 0x3, 0x4a, 0x3, 0x4a, 
       0x3, 0x4a, 0x3, 0x4a, 0x3, 0x4a, 0x3, 0x4b, 0x3, 0x4b, 0x5, 0x4b, 
       0x3c4, 0xa, 0x4b, 0x3, 0x4c, 0x3, 0x4c, 0x3, 0x4c, 0x3, 0x4d, 0x3, 
       0x4d, 0x3, 0x4d, 0x3, 0x4d, 0x3, 0x4d, 0x3, 0x4d, 0x3, 0x4d, 0x3, 
       0x4e, 0x3, 0x4e, 0x3, 0x4f, 0x3, 0x4f, 0x3, 0x4f, 0x7, 0x4f, 0x3d5, 
       0xa, 0x4f, 0xc, 0x4f, 0xe, 0x4f, 0x3d8, 0xb, 0x4f, 0x3, 0x50, 0x3, 
       0x50, 0x3, 0x50, 0x7, 0x50, 0x3dd, 0xa, 0x50, 0xc, 0x50, 0xe, 0x50, 
       0x3e0, 0xb, 0x50, 0x3, 0x51, 0x3, 0x51, 0x3, 0x51, 0x7, 0x51, 0x3e5, 
       0xa, 0x51, 0xc, 0x51, 0xe, 0x51, 0x3e8, 0xb, 0x51, 0x3, 0x52, 0x3, 
       0x52, 0x3, 0x52, 0x3, 0x52, 0x3, 0x52, 0x3, 0x52, 0x3, 0x52, 0x3, 
       0x52, 0x3, 0x52, 0x5, 0x52, 0x3f3, 0xa, 0x52, 0x3, 0x53, 0x3, 0x53, 
       0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 
       0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 
       0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 0x3, 0x53, 
       0x5, 0x53, 0x409, 0xa, 0x53, 0x3, 0x54, 0x3, 0x54, 0x3, 0x55, 0x3, 
       0x55, 0x3, 0x55, 0x7, 0x55, 0x410, 0xa, 0x55, 0xc, 0x55, 0xe, 0x55, 
       0x413, 0xb, 0x55, 0x3, 0x56, 0x3, 0x56, 0x3, 0x56, 0x7, 0x56, 0x418, 
       0xa, 0x56, 0xc, 0x56, 0xe, 0x56, 0x41b, 0xb, 0x56, 0x3, 0x57, 0x3, 
       0x57, 0x3, 0x57, 0x7, 0x57, 0x420, 0xa, 0x57, 0xc, 0x57, 0xe, 0x57, 
       0x423, 0xb, 0x57, 0x3, 0x58, 0x3, 0x58, 0x3, 0x58, 0x7, 0x58, 0x428, 
       0xa, 0x58, 0xc, 0x58, 0xe, 0x58, 0x42b, 0xb, 0x58, 0x3, 0x59, 0x3, 
       0x59, 0x3, 0x59, 0x3, 0x59, 0x3, 0x59, 0x3, 0x59, 0x3, 0x59, 0x3, 
       0x59, 0x5, 0x59, 0x435, 0xa, 0x59, 0x3, 0x5a, 0x3, 0x5a, 0x3, 0x5a, 
       0x5, 0x5a, 0x43a, 0xa, 0x5a, 0x3, 0x5a, 0x3, 0x5a, 0x3, 0x5b, 0x3, 
       0x5b, 0x3, 0x5b, 0x7, 0x5b, 0x441, 0xa, 0x5b, 0xc, 0x5b, 0xe, 0x5b, 
       0x444, 0xb, 0x5b, 0x3, 0x5c, 0x3, 0x5c, 0x3, 0x5c, 0x7, 0x5c, 0x449, 
       0xa, 0x5c, 0xc, 0x5c, 0xe, 0x5c, 0x44c, 0xb, 0x5c, 0x3, 0x5d, 0x3, 
       0x5d, 0x3, 0x5d, 0x7, 0x5d, 0x451, 0xa, 0x5d, 0xc, 0x5d, 0xe, 0x5d, 
       0x454, 0xb, 0x5d, 0x3, 0x5d, 0x3, 0x5d, 0x5, 0x5d, 0x458, 0xa, 0x5d, 
       0x3, 0x5e, 0x3, 0x5e, 0x3, 0x5f, 0x3, 0x5f, 0x3, 0x5f, 0x3, 0x60, 
       0x3, 0x60, 0x3, 0x60, 0x3, 0x60, 0x3, 0x60, 0x3, 0x61, 0x3, 0x61, 
       0x3, 0x61, 0x7, 0x61, 0x467, 0xa, 0x61, 0xc, 0x61, 0xe, 0x61, 0x46a, 
       0xb, 0x61, 0x3, 0x62, 0x3, 0x62, 0x3, 0x62, 0x3, 0x62, 0x3, 0x62, 
       0x3, 0x62, 0x5, 0x62, 0x472, 0xa, 0x62, 0x3, 0x63, 0x3, 0x63, 0x3, 
       0x63, 0x2, 0x2, 0x64, 0x2, 0x4, 0x6, 0x8, 0xa, 0xc, 0xe, 0x10, 0x12, 
       0x14, 0x16, 0x18, 0x1a, 0x1c, 0x1e, 0x20, 0x22, 0x24, 0x26, 0x28, 
       0x2a, 0x2c, 0x2e, 0x30, 0x32, 0x34, 0x36, 0x38, 0x3a, 0x3c, 0x3e, 
       0x40, 0x42, 0x44, 0x46, 0x48, 0x4a, 0x4c, 0x4e, 0x50, 0x52, 0x54, 
       0x56, 0x58, 0x5a, 0x5c, 0x5e, 0x60, 0x62, 0x64, 0x66, 0x68, 0x6a, 
       0x6c, 0x6e, 0x70, 0x72, 0x74, 0x76, 0x78, 0x7a, 0x7c, 0x7e, 0x80, 
       0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e, 0x90, 0x92, 0x94, 0x96, 
       0x98, 0x9a, 0x9c, 0x9e, 0xa0, 0xa2, 0xa4, 0xa6, 0xa8, 0xaa, 0xac, 
       0xae, 0xb0, 0xb2, 0xb4, 0xb6, 0xb8, 0xba, 0xbc, 0xbe, 0xc0, 0xc2, 
       0xc4, 0x2, 0x9, 0x4, 0x2, 0x8, 0x4f, 0x7d, 0x7d, 0x3, 0x2, 0x50, 
       0x53, 0x4, 0x2, 0x7, 0x7, 0x5d, 0x5d, 0x3, 0x2, 0x2d, 0x2e, 0x3, 
       0x2, 0x76, 0x77, 0x3, 0x2, 0x78, 0x79, 0x3, 0x2, 0x7b, 0x7c, 0x2, 
       0x4a3, 0x2, 0xc9, 0x3, 0x2, 0x2, 0x2, 0x4, 0xd6, 0x3, 0x2, 0x2, 0x2, 
       0x6, 0xd8, 0x3, 0x2, 0x2, 0x2, 0x8, 0xe3, 0x3, 0x2, 0x2, 0x2, 0xa, 
       0xf4, 0x3, 0x2, 0x2, 0x2, 0xc, 0xf9, 0x3, 0x2, 0x2, 0x2, 0xe, 0xfb, 
       0x3, 0x2, 0x2, 0x2, 0x10, 0xfd, 0x3, 0x2, 0x2, 0x2, 0x12, 0x102, 
       0x3, 0x2, 0x2, 0x2, 0x14, 0x10c, 0x3, 0x2, 0x2, 0x2, 0x16, 0x10e, 
       0x3, 0x2, 0x2, 0x2, 0x18, 0x11f, 0x3, 0x2, 0x2, 0x2, 0x1a, 0x12a, 
       0x3, 0x2, 0x2, 0x2, 0x1c, 0x12c, 0x3, 0x2, 0x2, 0x2, 0x1e, 0x12f, 
       0x3, 0x2, 0x2, 0x2, 0x20, 0x131, 0x3, 0x2, 0x2, 0x2, 0x22, 0x14c, 
       0x3, 0x2, 0x2, 0x2, 0x24, 0x14e, 0x3, 0x2, 0x2, 0x2, 0x26, 0x156, 
       0x3, 0x2, 0x2, 0x2, 0x28, 0x158, 0x3, 0x2, 0x2, 0x2, 0x2a, 0x17e, 
       0x3, 0x2, 0x2, 0x2, 0x2c, 0x180, 0x3, 0x2, 0x2, 0x2, 0x2e, 0x188, 
       0x3, 0x2, 0x2, 0x2, 0x30, 0x193, 0x3, 0x2, 0x2, 0x2, 0x32, 0x19e, 
       0x3, 0x2, 0x2, 0x2, 0x34, 0x1a9, 0x3, 0x2, 0x2, 0x2, 0x36, 0x1b4, 
       0x3, 0x2, 0x2, 0x2, 0x38, 0x1bd, 0x3, 0x2, 0x2, 0x2, 0x3a, 0x1c1, 
       0x3, 0x2, 0x2, 0x2, 0x3c, 0x1da, 0x3, 0x2, 0x2, 0x2, 0x3e, 0x1f7, 
       0x3, 0x2, 0x2, 0x2, 0x40, 0x215, 0x3, 0x2, 0x2, 0x2, 0x42, 0x217, 
       0x3, 0x2, 0x2, 0x2, 0x44, 0x234, 0x3, 0x2, 0x2, 0x2, 0x46, 0x241, 
       0x3, 0x2, 0x2, 0x2, 0x48, 0x24f, 0x3, 0x2, 0x2, 0x2, 0x4a, 0x251, 
       0x3, 0x2, 0x2, 0x2, 0x4c, 0x259, 0x3, 0x2, 0x2, 0x2, 0x4e, 0x292, 
       0x3, 0x2, 0x2, 0x2, 0x50, 0x296, 0x3, 0x2, 0x2, 0x2, 0x52, 0x298, 
       0x3, 0x2, 0x2, 0x2, 0x54, 0x29d, 0x3, 0x2, 0x2, 0x2, 0x56, 0x2a5, 
       0x3, 0x2, 0x2, 0x2, 0x58, 0x2a7, 0x3, 0x2, 0x2, 0x2, 0x5a, 0x2ab, 
       0x3, 0x2, 0x2, 0x2, 0x5c, 0x2b6, 0x3, 0x2, 0x2, 0x2, 0x5e, 0x2da, 
       0x3, 0x2, 0x2, 0x2, 0x60, 0x2dc, 0x3, 0x2, 0x2, 0x2, 0x62, 0x2de, 
       0x3, 0x2, 0x2, 0x2, 0x64, 0x2e8, 0x3, 0x2, 0x2, 0x2, 0x66, 0x2ec, 
       0x3, 0x2, 0x2, 0x2, 0x68, 0x2f6, 0x3, 0x2, 0x2, 0x2, 0x6a, 0x2f9, 
       0x3, 0x2, 0x2, 0x2, 0x6c, 0x303, 0x3, 0x2, 0x2, 0x2, 0x6e, 0x30a, 
       0x3, 0x2, 0x2, 0x2, 0x70, 0x31d, 0x3, 0x2, 0x2, 0x2, 0x72, 0x31f, 
       0x3, 0x2, 0x2, 0x2, 0x74, 0x324, 0x3, 0x2, 0x2, 0x2, 0x76, 0x327, 
       0x3, 0x2, 0x2, 0x2, 0x78, 0x330, 0x3, 0x2, 0x2, 0x2, 0x7a, 0x334, 
       0x3, 0x2, 0x2, 0x2, 0x7c, 0x339, 0x3, 0x2, 0x2, 0x2, 0x7e, 0x345, 
       0x3, 0x2, 0x2, 0x2, 0x80, 0x359, 0x3, 0x2, 0x2, 0x2, 0x82, 0x35b, 
       0x3, 0x2, 0x2, 0x2, 0x84, 0x367, 0x3, 0x2, 0x2, 0x2, 0x86, 0x369, 
       0x3, 0x2, 0x2, 0x2, 0x88, 0x38e, 0x3, 0x2, 0x2, 0x2, 0x8a, 0x39d, 
       0x3, 0x2, 0x2, 0x2, 0x8c, 0x39f, 0x3, 0x2, 0x2, 0x2, 0x8e, 0x3a7, 
       0x3, 0x2, 0x2, 0x2, 0x90, 0x3b9, 0x3, 0x2, 0x2, 0x2, 0x92, 0x3bb, 
       0x3, 0x2, 0x2, 0x2, 0x94, 0x3c1, 0x3, 0x2, 0x2, 0x2, 0x96, 0x3c5, 
       0x3, 0x2, 0x2, 0x2, 0x98, 0x3c8, 0x3, 0x2, 0x2, 0x2, 0x9a, 0x3cf, 
       0x3, 0x2, 0x2, 0x2, 0x9c, 0x3d1, 0x3, 0x2, 0x2, 0x2, 0x9e, 0x3d9, 
       0x3, 0x2, 0x2, 0x2, 0xa0, 0x3e1, 0x3, 0x2, 0x2, 0x2, 0xa2, 0x3f2, 
       0x3, 0x2, 0x2, 0x2, 0xa4, 0x408, 0x3, 0x2, 0x2, 0x2, 0xa6, 0x40a, 
       0x3, 0x2, 0x2, 0x2, 0xa8, 0x40c, 0x3, 0x2, 0x2, 0x2, 0xaa, 0x414, 
       0x3, 0x2, 0x2, 0x2, 0xac, 0x41c, 0x3, 0x2, 0x2, 0x2, 0xae, 0x424, 
       0x3, 0x2, 0x2, 0x2, 0xb0, 0x434, 0x3, 0x2, 0x2, 0x2, 0xb2, 0x436, 
       0x3, 0x2, 0x2, 0x2, 0xb4, 0x43d, 0x3, 0x2, 0x2, 0x2, 0xb6, 0x445, 
       0x3, 0x2, 0x2, 0x2, 0xb8, 0x44d, 0x3, 0x2, 0x2, 0x2, 0xba, 0x459, 
       0x3, 0x2, 0x2, 0x2, 0xbc, 0x45b, 0x3, 0x2, 0x2, 0x2, 0xbe, 0x45e, 
       0x3, 0x2, 0x2, 0x2, 0xc0, 0x463, 0x3, 0x2, 0x2, 0x2, 0xc2, 0x471, 
       0x3, 0x2, 0x2, 0x2, 0xc4, 0x473, 0x3, 0x2, 0x2, 0x2, 0xc6, 0xc8, 
       0x5, 0x4, 0x3, 0x2, 0xc7, 0xc6, 0x3, 0x2, 0x2, 0x2, 0xc8, 0xcb, 0x3, 
       0x2, 0x2, 0x2, 0xc9, 0xc7, 0x3, 0x2, 0x2, 0x2, 0xc9, 0xca, 0x3, 0x2, 
       0x2, 0x2, 0xca, 0xcc, 0x3, 0x2, 0x2, 0x2, 0xcb, 0xc9, 0x3, 0x2, 0x2, 
       0x2, 0xcc, 0xcd, 0x7, 0x2, 0x2, 0x3, 0xcd, 0x3, 0x3, 0x2, 0x2, 0x2, 
       0xce, 0xd7, 0x5, 0x6, 0x4, 0x2, 0xcf, 0xd7, 0x5, 0x26, 0x14, 0x2, 
       0xd0, 0xd7, 0x5, 0x52, 0x2a, 0x2, 0xd1, 0xd7, 0x5, 0x54, 0x2b, 0x2, 
       0xd2, 0xd7, 0x5, 0x62, 0x32, 0x2, 0xd3, 0xd7, 0x5, 0x66, 0x34, 0x2, 
       0xd4, 0xd7, 0x5, 0x6a, 0x36, 0x2, 0xd5, 0xd7, 0x5, 0x6e, 0x38, 0x2, 
       0xd6, 0xce, 0x3, 0x2, 0x2, 0x2, 0xd6, 0xcf, 0x3, 0x2, 0x2, 0x2, 0xd6, 
       0xd0, 0x3, 0x2, 0x2, 0x2, 0xd6, 0xd1, 0x3, 0x2, 0x2, 0x2, 0xd6, 0xd2, 
       0x3, 0x2, 0x2, 0x2, 0xd6, 0xd3, 0x3, 0x2, 0x2, 0x2, 0xd6, 0xd4, 0x3, 
       0x2, 0x2, 0x2, 0xd6, 0xd5, 0x3, 0x2, 0x2, 0x2, 0xd7, 0x5, 0x3, 0x2, 
       0x2, 0x2, 0xd8, 0xd9, 0x7, 0x3, 0x2, 0x2, 0xd9, 0xda, 0x5, 0xa, 0x6, 
       0x2, 0xda, 0xde, 0x7, 0x4, 0x2, 0x2, 0xdb, 0xdd, 0x5, 0x8, 0x5, 0x2, 
       0xdc, 0xdb, 0x3, 0x2, 0x2, 0x2, 0xdd, 0xe0, 0x3, 0x2, 0x2, 0x2, 0xde, 
       0xdc, 0x3, 0x2, 0x2, 0x2, 0xde, 0xdf, 0x3, 0x2, 0x2, 0x2, 0xdf, 0xe1, 
       0x3, 0x2, 0x2, 0x2, 0xe0, 0xde, 0x3, 0x2, 0x2, 0x2, 0xe1, 0xe2, 0x7, 
       0x5, 0x2, 0x2, 0xe2, 0x7, 0x3, 0x2, 0x2, 0x2, 0xe3, 0xe4, 0x5, 0xa, 
       0x6, 0x2, 0xe4, 0xe5, 0x7, 0x6, 0x2, 0x2, 0xe5, 0xe9, 0x5, 0xc, 0x7, 
       0x2, 0xe6, 0xe8, 0x5, 0x14, 0xb, 0x2, 0xe7, 0xe6, 0x3, 0x2, 0x2, 
       0x2, 0xe8, 0xeb, 0x3, 0x2, 0x2, 0x2, 0xe9, 0xe7, 0x3, 0x2, 0x2, 0x2, 
       0xe9, 0xea, 0x3, 0x2, 0x2, 0x2, 0xea, 0xed, 0x3, 0x2, 0x2, 0x2, 0xeb, 
       0xe9, 0x3, 0x2, 0x2, 0x2, 0xec, 0xee, 0x5, 0x16, 0xc, 0x2, 0xed, 
       0xec, 0x3, 0x2, 0x2, 0x2, 0xed, 0xee, 0x3, 0x2, 0x2, 0x2, 0xee, 0xf0, 
       0x3, 0x2, 0x2, 0x2, 0xef, 0xf1, 0x5, 0x20, 0x11, 0x2, 0xf0, 0xef, 
       0x3, 0x2, 0x2, 0x2, 0xf0, 0xf1, 0x3, 0x2, 0x2, 0x2, 0xf1, 0xf2, 0x3, 
       0x2, 0x2, 0x2, 0xf2, 0xf3, 0x7, 0x7, 0x2, 0x2, 0xf3, 0x9, 0x3, 0x2, 
       0x2, 0x2, 0xf4, 0xf5, 0x9, 0x2, 0x2, 0x2, 0xf5, 0xb, 0x3, 0x2, 0x2, 
       0x2, 0xf6, 0xfa, 0x5, 0xe, 0x8, 0x2, 0xf7, 0xfa, 0x5, 0x10, 0x9, 
       0x2, 0xf8, 0xfa, 0x5, 0x12, 0xa, 0x2, 0xf9, 0xf6, 0x3, 0x2, 0x2, 
       0x2, 0xf9, 0xf7, 0x3, 0x2, 0x2, 0x2, 0xf9, 0xf8, 0x3, 0x2, 0x2, 0x2, 
       0xfa, 0xd, 0x3, 0x2, 0x2, 0x2, 0xfb, 0xfc, 0x9, 0x3, 0x2, 0x2, 0xfc, 
       0xf, 0x3, 0x2, 0x2, 0x2, 0xfd, 0xfe, 0x7, 0x54, 0x2, 0x2, 0xfe, 0xff, 
       0x7, 0x55, 0x2, 0x2, 0xff, 0x100, 0x5, 0xc, 0x7, 0x2, 0x100, 0x101, 
       0x7, 0x56, 0x2, 0x2, 0x101, 0x11, 0x3, 0x2, 0x2, 0x2, 0x102, 0x103, 
       0x7, 0x57, 0x2, 0x2, 0x103, 0x104, 0x7, 0x58, 0x2, 0x2, 0x104, 0x105, 
       0x7, 0x7e, 0x2, 0x2, 0x105, 0x106, 0x7, 0x59, 0x2, 0x2, 0x106, 0x13, 
       0x3, 0x2, 0x2, 0x2, 0x107, 0x10d, 0x7, 0x34, 0x2, 0x2, 0x108, 0x10d, 
       0x7, 0x35, 0x2, 0x2, 0x109, 0x10d, 0x7, 0x36, 0x2, 0x2, 0x10a, 0x10b, 
       0x7, 0xf, 0x2, 0x2, 0x10b, 0x10d, 0x7, 0x7e, 0x2, 0x2, 0x10c, 0x107, 
       0x3, 0x2, 0x2, 0x2, 0x10c, 0x108, 0x3, 0x2, 0x2, 0x2, 0x10c, 0x109, 
       0x3, 0x2, 0x2, 0x2, 0x10c, 0x10a, 0x3, 0x2, 0x2, 0x2, 0x10d, 0x15, 
       0x3, 0x2, 0x2, 0x2, 0x10e, 0x11b, 0x7, 0x58, 0x2, 0x2, 0x10f, 0x115, 
       0x5, 0x18, 0xd, 0x2, 0x110, 0x111, 0x5, 0x1e, 0x10, 0x2, 0x111, 0x112, 
       0x5, 0x18, 0xd, 0x2, 0x112, 0x114, 0x3, 0x2, 0x2, 0x2, 0x113, 0x110, 
       0x3, 0x2, 0x2, 0x2, 0x114, 0x117, 0x3, 0x2, 0x2, 0x2, 0x115, 0x113, 
       0x3, 0x2, 0x2, 0x2, 0x115, 0x116, 0x3, 0x2, 0x2, 0x2, 0x116, 0x119, 
       0x3, 0x2, 0x2, 0x2, 0x117, 0x115, 0x3, 0x2, 0x2, 0x2, 0x118, 0x11a, 
       0x5, 0x1e, 0x10, 0x2, 0x119, 0x118, 0x3, 0x2, 0x2, 0x2, 0x119, 0x11a, 
       0x3, 0x2, 0x2, 0x2, 0x11a, 0x11c, 0x3, 0x2, 0x2, 0x2, 0x11b, 0x10f, 
       0x3, 0x2, 0x2, 0x2, 0x11b, 0x11c, 0x3, 0x2, 0x2, 0x2, 0x11c, 0x11d, 
       0x3, 0x2, 0x2, 0x2, 0x11d, 0x11e, 0x7, 0x59, 0x2, 0x2, 0x11e, 0x17, 
       0x3, 0x2, 0x2, 0x2, 0x11f, 0x121, 0x5, 0x1a, 0xe, 0x2, 0x120, 0x122, 
       0x5, 0x1c, 0xf, 0x2, 0x121, 0x120, 0x3, 0x2, 0x2, 0x2, 0x121, 0x122, 
       0x3, 0x2, 0x2, 0x2, 0x122, 0x19, 0x3, 0x2, 0x2, 0x2, 0x123, 0x124, 
       0x7, 0x5a, 0x2, 0x2, 0x124, 0x125, 0x7, 0x7e, 0x2, 0x2, 0x125, 0x126, 
       0x7, 0x5b, 0x2, 0x2, 0x126, 0x12b, 0x7, 0x7e, 0x2, 0x2, 0x127, 0x128, 
       0x7, 0x7e, 0x2, 0x2, 0x128, 0x129, 0x7, 0x5b, 0x2, 0x2, 0x129, 0x12b, 
       0x7, 0x7e, 0x2, 0x2, 0x12a, 0x123, 0x3, 0x2, 0x2, 0x2, 0x12a, 0x127, 
       0x3, 0x2, 0x2, 0x2, 0x12b, 0x1b, 0x3, 0x2, 0x2, 0x2, 0x12c, 0x12d, 
       0x7, 0x5c, 0x2, 0x2, 0x12d, 0x12e, 0x7, 0x7e, 0x2, 0x2, 0x12e, 0x1d, 
       0x3, 0x2, 0x2, 0x2, 0x12f, 0x130, 0x9, 0x4, 0x2, 0x2, 0x130, 0x1f, 
       0x3, 0x2, 0x2, 0x2, 0x131, 0x13e, 0x7, 0x58, 0x2, 0x2, 0x132, 0x138, 
       0x5, 0x22, 0x12, 0x2, 0x133, 0x134, 0x5, 0x24, 0x13, 0x2, 0x134, 
       0x135, 0x5, 0x22, 0x12, 0x2, 0x135, 0x137, 0x3, 0x2, 0x2, 0x2, 0x136, 
       0x133, 0x3, 0x2, 0x2, 0x2, 0x137, 0x13a, 0x3, 0x2, 0x2, 0x2, 0x138, 
       0x136, 0x3, 0x2, 0x2, 0x2, 0x138, 0x139, 0x3, 0x2, 0x2, 0x2, 0x139, 
       0x13c, 0x3, 0x2, 0x2, 0x2, 0x13a, 0x138, 0x3, 0x2, 0x2, 0x2, 0x13b, 
       0x13d, 0x5, 0x24, 0x13, 0x2, 0x13c, 0x13b, 0x3, 0x2, 0x2, 0x2, 0x13c, 
       0x13d, 0x3, 0x2, 0x2, 0x2, 0x13d, 0x13f, 0x3, 0x2, 0x2, 0x2, 0x13e, 
       0x132, 0x3, 0x2, 0x2, 0x2, 0x13e, 0x13f, 0x3, 0x2, 0x2, 0x2, 0x13f, 
       0x140, 0x3, 0x2, 0x2, 0x2, 0x140, 0x141, 0x7, 0x59, 0x2, 0x2, 0x141, 
       0x21, 0x3, 0x2, 0x2, 0x2, 0x142, 0x143, 0x7, 0x5e, 0x2, 0x2, 0x143, 
       0x14d, 0x7, 0x7e, 0x2, 0x2, 0x144, 0x145, 0x7, 0x5f, 0x2, 0x2, 0x145, 
       0x146, 0x7, 0x7e, 0x2, 0x2, 0x146, 0x147, 0x7, 0x5b, 0x2, 0x2, 0x147, 
       0x14d, 0x7, 0x7e, 0x2, 0x2, 0x148, 0x14d, 0x7, 0x7e, 0x2, 0x2, 0x149, 
       0x14a, 0x7, 0x7e, 0x2, 0x2, 0x14a, 0x14b, 0x7, 0x5b, 0x2, 0x2, 0x14b, 
       0x14d, 0x7, 0x7e, 0x2, 0x2, 0x14c, 0x142, 0x3, 0x2, 0x2, 0x2, 0x14c, 
       0x144, 0x3, 0x2, 0x2, 0x2, 0x14c, 0x148, 0x3, 0x2, 0x2, 0x2, 0x14c, 
       0x149, 0x3, 0x2, 0x2, 0x2, 0x14d, 0x23, 0x3, 0x2, 0x2, 0x2, 0x14e, 
       0x14f, 0x9, 0x4, 0x2, 0x2, 0x14f, 0x25, 0x3, 0x2, 0x2, 0x2, 0x150, 
       0x157, 0x5, 0x28, 0x15, 0x2, 0x151, 0x157, 0x5, 0x2e, 0x18, 0x2, 
       0x152, 0x157, 0x5, 0x30, 0x19, 0x2, 0x153, 0x157, 0x5, 0x32, 0x1a, 
       0x2, 0x154, 0x157, 0x5, 0x34, 0x1b, 0x2, 0x155, 0x157, 0x5, 0x44, 
       0x23, 0x2, 0x156, 0x150, 0x3, 0x2, 0x2, 0x2, 0x156, 0x151, 0x3, 0x2, 
       0x2, 0x2, 0x156, 0x152, 0x3, 0x2, 0x2, 0x2, 0x156, 0x153, 0x3, 0x2, 
       0x2, 0x2, 0x156, 0x154, 0x3, 0x2, 0x2, 0x2, 0x156, 0x155, 0x3, 0x2, 
       0x2, 0x2, 0x157, 0x27, 0x3, 0x2, 0x2, 0x2, 0x158, 0x159, 0x7, 0x60, 
       0x2, 0x2, 0x159, 0x15d, 0x7, 0x4, 0x2, 0x2, 0x15a, 0x15c, 0x5, 0x2a, 
       0x16, 0x2, 0x15b, 0x15a, 0x3, 0x2, 0x2, 0x2, 0x15c, 0x15f, 0x3, 0x2, 
       0x2, 0x2, 0x15d, 0x15b, 0x3, 0x2, 0x2, 0x2, 0x15d, 0x15e, 0x3, 0x2, 
       0x2, 0x2, 0x15e, 0x160, 0x3, 0x2, 0x2, 0x2, 0x15f, 0x15d, 0x3, 0x2, 
       0x2, 0x2, 0x160, 0x161, 0x7, 0x5, 0x2, 0x2, 0x161, 0x29, 0x3, 0x2, 
       0x2, 0x2, 0x162, 0x163, 0x7, 0x10, 0x2, 0x2, 0x163, 0x164, 0x7, 0x5c, 
       0x2, 0x2, 0x164, 0x165, 0x5, 0xba, 0x5e, 0x2, 0x165, 0x166, 0x7, 
       0x7, 0x2, 0x2, 0x166, 0x17f, 0x3, 0x2, 0x2, 0x2, 0x167, 0x168, 0x7, 
       0x11, 0x2, 0x2, 0x168, 0x169, 0x7, 0x5c, 0x2, 0x2, 0x169, 0x16a, 
       0x5, 0x36, 0x1c, 0x2, 0x16a, 0x16b, 0x7, 0x7, 0x2, 0x2, 0x16b, 0x17f, 
       0x3, 0x2, 0x2, 0x2, 0x16c, 0x16d, 0x7, 0xf, 0x2, 0x2, 0x16d, 0x16e, 
       0x7, 0x5c, 0x2, 0x2, 0x16e, 0x16f, 0x7, 0x7e, 0x2, 0x2, 0x16f, 0x17f, 
       0x7, 0x7, 0x2, 0x2, 0x170, 0x171, 0x7, 0x36, 0x2, 0x2, 0x171, 0x172, 
       0x7, 0x5c, 0x2, 0x2, 0x172, 0x173, 0x5, 0xc4, 0x63, 0x2, 0x173, 0x174, 
       0x7, 0x7, 0x2, 0x2, 0x174, 0x17f, 0x3, 0x2, 0x2, 0x2, 0x175, 0x176, 
       0x7, 0x8, 0x2, 0x2, 0x176, 0x177, 0x7, 0x5c, 0x2, 0x2, 0x177, 0x178, 
       0x7, 0x7e, 0x2, 0x2, 0x178, 0x17f, 0x7, 0x7, 0x2, 0x2, 0x179, 0x17a, 
       0x7, 0x12, 0x2, 0x2, 0x17a, 0x17b, 0x7, 0x5c, 0x2, 0x2, 0x17b, 0x17c, 
       0x5, 0x2c, 0x17, 0x2, 0x17c, 0x17d, 0x7, 0x7, 0x2, 0x2, 0x17d, 0x17f, 
       0x3, 0x2, 0x2, 0x2, 0x17e, 0x162, 0x3, 0x2, 0x2, 0x2, 0x17e, 0x167, 
       0x3, 0x2, 0x2, 0x2, 0x17e, 0x16c, 0x3, 0x2, 0x2, 0x2, 0x17e, 0x170, 
       0x3, 0x2, 0x2, 0x2, 0x17e, 0x175, 0x3, 0x2, 0x2, 0x2, 0x17e, 0x179, 
       0x3, 0x2, 0x2, 0x2, 0x17f, 0x2b, 0x3, 0x2, 0x2, 0x2, 0x180, 0x185, 
       0x5, 0xbe, 0x60, 0x2, 0x181, 0x182, 0x7, 0x61, 0x2, 0x2, 0x182, 0x184, 
       0x5, 0xbe, 0x60, 0x2, 0x183, 0x181, 0x3, 0x2, 0x2, 0x2, 0x184, 0x187, 
       0x3, 0x2, 0x2, 0x2, 0x185, 0x183, 0x3, 0x2, 0x2, 0x2, 0x185, 0x186, 
       0x3, 0x2, 0x2, 0x2, 0x186, 0x2d, 0x3, 0x2, 0x2, 0x2, 0x187, 0x185, 
       0x3, 0x2, 0x2, 0x2, 0x188, 0x189, 0x7, 0x62, 0x2, 0x2, 0x189, 0x18a, 
       0x7, 0x55, 0x2, 0x2, 0x18a, 0x18b, 0x5, 0x36, 0x1c, 0x2, 0x18b, 0x18d, 
       0x7, 0x56, 0x2, 0x2, 0x18c, 0x18e, 0x5, 0xa, 0x6, 0x2, 0x18d, 0x18c, 
       0x3, 0x2, 0x2, 0x2, 0x18d, 0x18e, 0x3, 0x2, 0x2, 0x2, 0x18e, 0x18f, 
       0x3, 0x2, 0x2, 0x2, 0x18f, 0x190, 0x7, 0x4, 0x2, 0x2, 0x190, 0x191, 
       0x5, 0x3a, 0x1e, 0x2, 0x191, 0x192, 0x7, 0x5, 0x2, 0x2, 0x192, 0x2f, 
       0x3, 0x2, 0x2, 0x2, 0x193, 0x194, 0x7, 0x63, 0x2, 0x2, 0x194, 0x195, 
       0x7, 0x55, 0x2, 0x2, 0x195, 0x196, 0x5, 0x36, 0x1c, 0x2, 0x196, 0x198, 
       0x7, 0x56, 0x2, 0x2, 0x197, 0x199, 0x5, 0xa, 0x6, 0x2, 0x198, 0x197, 
       0x3, 0x2, 0x2, 0x2, 0x198, 0x199, 0x3, 0x2, 0x2, 0x2, 0x199, 0x19a, 
       0x3, 0x2, 0x2, 0x2, 0x19a, 0x19b, 0x7, 0x4, 0x2, 0x2, 0x19b, 0x19c, 
       0x5, 0x3c, 0x1f, 0x2, 0x19c, 0x19d, 0x7, 0x5, 0x2, 0x2, 0x19d, 0x31, 
       0x3, 0x2, 0x2, 0x2, 0x19e, 0x19f, 0x7, 0x64, 0x2, 0x2, 0x19f, 0x1a0, 
       0x7, 0x55, 0x2, 0x2, 0x1a0, 0x1a1, 0x5, 0x36, 0x1c, 0x2, 0x1a1, 0x1a3, 
       0x7, 0x56, 0x2, 0x2, 0x1a2, 0x1a4, 0x5, 0xa, 0x6, 0x2, 0x1a3, 0x1a2, 
       0x3, 0x2, 0x2, 0x2, 0x1a3, 0x1a4, 0x3, 0x2, 0x2, 0x2, 0x1a4, 0x1a5, 
       0x3, 0x2, 0x2, 0x2, 0x1a5, 0x1a6, 0x7, 0x4, 0x2, 0x2, 0x1a6, 0x1a7, 
       0x5, 0x3e, 0x20, 0x2, 0x1a7, 0x1a8, 0x7, 0x5, 0x2, 0x2, 0x1a8, 0x33, 
       0x3, 0x2, 0x2, 0x2, 0x1a9, 0x1aa, 0x7, 0x65, 0x2, 0x2, 0x1aa, 0x1ab, 
       0x7, 0x55, 0x2, 0x2, 0x1ab, 0x1ac, 0x5, 0xc, 0x7, 0x2, 0x1ac, 0x1ae, 
       0x7, 0x56, 0x2, 0x2, 0x1ad, 0x1af, 0x5, 0xa, 0x6, 0x2, 0x1ae, 0x1ad, 
       0x3, 0x2, 0x2, 0x2, 0x1ae, 0x1af, 0x3, 0x2, 0x2, 0x2, 0x1af, 0x1b0, 
       0x3, 0x2, 0x2, 0x2, 0x1b0, 0x1b1, 0x7, 0x4, 0x2, 0x2, 0x1b1, 0x1b2, 
       0x5, 0x42, 0x22, 0x2, 0x1b2, 0x1b3, 0x7, 0x5, 0x2, 0x2, 0x1b3, 0x35, 
       0x3, 0x2, 0x2, 0x2, 0x1b4, 0x1b9, 0x5, 0xa, 0x6, 0x2, 0x1b5, 0x1b6, 
       0x7, 0x61, 0x2, 0x2, 0x1b6, 0x1b8, 0x5, 0xa, 0x6, 0x2, 0x1b7, 0x1b5, 
       0x3, 0x2, 0x2, 0x2, 0x1b8, 0x1bb, 0x3, 0x2, 0x2, 0x2, 0x1b9, 0x1b7, 
       0x3, 0x2, 0x2, 0x2, 0x1b9, 0x1ba, 0x3, 0x2, 0x2, 0x2, 0x1ba, 0x37, 
       0x3, 0x2, 0x2, 0x2, 0x1bb, 0x1b9, 0x3, 0x2, 0x2, 0x2, 0x1bc, 0x1be, 
       0x5, 0xa, 0x6, 0x2, 0x1bd, 0x1bc, 0x3, 0x2, 0x2, 0x2, 0x1be, 0x1bf, 
       0x3, 0x2, 0x2, 0x2, 0x1bf, 0x1bd, 0x3, 0x2, 0x2, 0x2, 0x1bf, 0x1c0, 
       0x3, 0x2, 0x2, 0x2, 0x1c0, 0x39, 0x3, 0x2, 0x2, 0x2, 0x1c1, 0x1c2, 
       0x7, 0xa, 0x2, 0x2, 0x1c2, 0x1c3, 0x7, 0x5c, 0x2, 0x2, 0x1c3, 0x1c4, 
       0x5, 0xba, 0x5e, 0x2, 0x1c4, 0x1c5, 0x7, 0x7, 0x2, 0x2, 0x1c5, 0x1c6, 
       0x7, 0xb, 0x2, 0x2, 0x1c6, 0x1c7, 0x7, 0x5c, 0x2, 0x2, 0x1c7, 0x1c8, 
       0x5, 0xba, 0x5e, 0x2, 0x1c8, 0x1c9, 0x7, 0x7, 0x2, 0x2, 0x1c9, 0x1ca, 
       0x7, 0xc, 0x2, 0x2, 0x1ca, 0x1cb, 0x7, 0x5c, 0x2, 0x2, 0x1cb, 0x1cc, 
       0x5, 0x40, 0x21, 0x2, 0x1cc, 0x1d2, 0x7, 0x7, 0x2, 0x2, 0x1cd, 0x1ce, 
       0x7, 0x12, 0x2, 0x2, 0x1ce, 0x1cf, 0x7, 0x5c, 0x2, 0x2, 0x1cf, 0x1d0, 
       0x5, 0x2c, 0x17, 0x2, 0x1d0, 0x1d1, 0x7, 0x7, 0x2, 0x2, 0x1d1, 0x1d3, 
       0x3, 0x2, 0x2, 0x2, 0x1d2, 0x1cd, 0x3, 0x2, 0x2, 0x2, 0x1d2, 0x1d3, 
       0x3, 0x2, 0x2, 0x2, 0x1d3, 0x1d8, 0x3, 0x2, 0x2, 0x2, 0x1d4, 0x1d5, 
       0x7, 0xf, 0x2, 0x2, 0x1d5, 0x1d6, 0x7, 0x5c, 0x2, 0x2, 0x1d6, 0x1d7, 
       0x7, 0x7e, 0x2, 0x2, 0x1d7, 0x1d9, 0x7, 0x7, 0x2, 0x2, 0x1d8, 0x1d4, 
       0x3, 0x2, 0x2, 0x2, 0x1d8, 0x1d9, 0x3, 0x2, 0x2, 0x2, 0x1d9, 0x3b, 
       0x3, 0x2, 0x2, 0x2, 0x1da, 0x1db, 0x7, 0xa, 0x2, 0x2, 0x1db, 0x1dc, 
       0x7, 0x5c, 0x2, 0x2, 0x1dc, 0x1dd, 0x5, 0xba, 0x5e, 0x2, 0x1dd, 0x1de, 
       0x7, 0x7, 0x2, 0x2, 0x1de, 0x1df, 0x7, 0xb, 0x2, 0x2, 0x1df, 0x1e0, 
       0x7, 0x5c, 0x2, 0x2, 0x1e0, 0x1e1, 0x5, 0xba, 0x5e, 0x2, 0x1e1, 0x1e2, 
       0x7, 0x7, 0x2, 0x2, 0x1e2, 0x1e3, 0x7, 0xc, 0x2, 0x2, 0x1e3, 0x1e4, 
       0x7, 0x5c, 0x2, 0x2, 0x1e4, 0x1e5, 0x5, 0x40, 0x21, 0x2, 0x1e5, 0x1e6, 
       0x7, 0x7, 0x2, 0x2, 0x1e6, 0x1e7, 0x7, 0xd, 0x2, 0x2, 0x1e7, 0x1e8, 
       0x7, 0x5c, 0x2, 0x2, 0x1e8, 0x1e9, 0x5, 0x40, 0x21, 0x2, 0x1e9, 0x1ef, 
       0x7, 0x7, 0x2, 0x2, 0x1ea, 0x1eb, 0x7, 0x12, 0x2, 0x2, 0x1eb, 0x1ec, 
       0x7, 0x5c, 0x2, 0x2, 0x1ec, 0x1ed, 0x5, 0x2c, 0x17, 0x2, 0x1ed, 0x1ee, 
       0x7, 0x7, 0x2, 0x2, 0x1ee, 0x1f0, 0x3, 0x2, 0x2, 0x2, 0x1ef, 0x1ea, 
       0x3, 0x2, 0x2, 0x2, 0x1ef, 0x1f0, 0x3, 0x2, 0x2, 0x2, 0x1f0, 0x1f5, 
       0x3, 0x2, 0x2, 0x2, 0x1f1, 0x1f2, 0x7, 0xf, 0x2, 0x2, 0x1f2, 0x1f3, 
       0x7, 0x5c, 0x2, 0x2, 0x1f3, 0x1f4, 0x7, 0x7e, 0x2, 0x2, 0x1f4, 0x1f6, 
       0x7, 0x7, 0x2, 0x2, 0x1f5, 0x1f1, 0x3, 0x2, 0x2, 0x2, 0x1f5, 0x1f6, 
       0x3, 0x2, 0x2, 0x2, 0x1f6, 0x3d, 0x3, 0x2, 0x2, 0x2, 0x1f7, 0x1f8, 
       0x7, 0xa, 0x2, 0x2, 0x1f8, 0x1f9, 0x7, 0x5c, 0x2, 0x2, 0x1f9, 0x1fa, 
       0x5, 0xba, 0x5e, 0x2, 0x1fa, 0x1fb, 0x7, 0x7, 0x2, 0x2, 0x1fb, 0x1fc, 
       0x7, 0xc, 0x2, 0x2, 0x1fc, 0x1fd, 0x7, 0x5c, 0x2, 0x2, 0x1fd, 0x1fe, 
       0x5, 0x40, 0x21, 0x2, 0x1fe, 0x203, 0x7, 0x7, 0x2, 0x2, 0x1ff, 0x200, 
       0x7, 0xf, 0x2, 0x2, 0x200, 0x201, 0x7, 0x5c, 0x2, 0x2, 0x201, 0x202, 
       0x7, 0x7e, 0x2, 0x2, 0x202, 0x204, 0x7, 0x7, 0x2, 0x2, 0x203, 0x1ff, 
       0x3, 0x2, 0x2, 0x2, 0x203, 0x204, 0x3, 0x2, 0x2, 0x2, 0x204, 0x3f, 
       0x3, 0x2, 0x2, 0x2, 0x205, 0x20a, 0x5, 0xbc, 0x5f, 0x2, 0x206, 0x207, 
       0x7, 0x61, 0x2, 0x2, 0x207, 0x209, 0x5, 0xbc, 0x5f, 0x2, 0x208, 0x206, 
       0x3, 0x2, 0x2, 0x2, 0x209, 0x20c, 0x3, 0x2, 0x2, 0x2, 0x20a, 0x208, 
       0x3, 0x2, 0x2, 0x2, 0x20a, 0x20b, 0x3, 0x2, 0x2, 0x2, 0x20b, 0x216, 
       0x3, 0x2, 0x2, 0x2, 0x20c, 0x20a, 0x3, 0x2, 0x2, 0x2, 0x20d, 0x212, 
       0x5, 0xa, 0x6, 0x2, 0x20e, 0x20f, 0x7, 0x61, 0x2, 0x2, 0x20f, 0x211, 
       0x5, 0xa, 0x6, 0x2, 0x210, 0x20e, 0x3, 0x2, 0x2, 0x2, 0x211, 0x214, 
       0x3, 0x2, 0x2, 0x2, 0x212, 0x210, 0x3, 0x2, 0x2, 0x2, 0x212, 0x213, 
       0x3, 0x2, 0x2, 0x2, 0x213, 0x216, 0x3, 0x2, 0x2, 0x2, 0x214, 0x212, 
       0x3, 0x2, 0x2, 0x2, 0x215, 0x205, 0x3, 0x2, 0x2, 0x2, 0x215, 0x20d, 
       0x3, 0x2, 0x2, 0x2, 0x216, 0x41, 0x3, 0x2, 0x2, 0x2, 0x217, 0x218, 
       0x7, 0xe, 0x2, 0x2, 0x218, 0x219, 0x7, 0x5c, 0x2, 0x2, 0x219, 0x21a, 
       0x5, 0xc0, 0x61, 0x2, 0x21a, 0x224, 0x7, 0x7, 0x2, 0x2, 0x21b, 0x21c, 
       0x7, 0x9, 0x2, 0x2, 0x21c, 0x21d, 0x7, 0x5c, 0x2, 0x2, 0x21d, 0x21e, 
       0x7, 0x7e, 0x2, 0x2, 0x21e, 0x225, 0x7, 0x7, 0x2, 0x2, 0x21f, 0x220, 
       0x7, 0x8, 0x2, 0x2, 0x220, 0x221, 0x7, 0x5c, 0x2, 0x2, 0x221, 0x222, 
       0x5, 0xba, 0x5e, 0x2, 0x222, 0x223, 0x7, 0x7, 0x2, 0x2, 0x223, 0x225, 
       0x3, 0x2, 0x2, 0x2, 0x224, 0x21b, 0x3, 0x2, 0x2, 0x2, 0x224, 0x21f, 
       0x3, 0x2, 0x2, 0x2, 0x225, 0x226, 0x3, 0x2, 0x2, 0x2, 0x226, 0x227, 
       0x7, 0xa, 0x2, 0x2, 0x227, 0x228, 0x7, 0x5c, 0x2, 0x2, 0x228, 0x229, 
       0x5, 0xba, 0x5e, 0x2, 0x229, 0x22a, 0x7, 0x7, 0x2, 0x2, 0x22a, 0x22b, 
       0x7, 0xb, 0x2, 0x2, 0x22b, 0x22c, 0x7, 0x5c, 0x2, 0x2, 0x22c, 0x22d, 
       0x5, 0xba, 0x5e, 0x2, 0x22d, 0x232, 0x7, 0x7, 0x2, 0x2, 0x22e, 0x22f, 
       0x7, 0xf, 0x2, 0x2, 0x22f, 0x230, 0x7, 0x5c, 0x2, 0x2, 0x230, 0x231, 
       0x7, 0x7e, 0x2, 0x2, 0x231, 0x233, 0x7, 0x7, 0x2, 0x2, 0x232, 0x22e, 
       0x3, 0x2, 0x2, 0x2, 0x232, 0x233, 0x3, 0x2, 0x2, 0x2, 0x233, 0x43, 
       0x3, 0x2, 0x2, 0x2, 0x234, 0x236, 0x7, 0xa, 0x2, 0x2, 0x235, 0x237, 
       0x5, 0x46, 0x24, 0x2, 0x236, 0x235, 0x3, 0x2, 0x2, 0x2, 0x236, 0x237, 
       0x3, 0x2, 0x2, 0x2, 0x237, 0x238, 0x3, 0x2, 0x2, 0x2, 0x238, 0x23c, 
       0x7, 0x4, 0x2, 0x2, 0x239, 0x23b, 0x5, 0x48, 0x25, 0x2, 0x23a, 0x239, 
       0x3, 0x2, 0x2, 0x2, 0x23b, 0x23e, 0x3, 0x2, 0x2, 0x2, 0x23c, 0x23a, 
       0x3, 0x2, 0x2, 0x2, 0x23c, 0x23d, 0x3, 0x2, 0x2, 0x2, 0x23d, 0x23f, 
       0x3, 0x2, 0x2, 0x2, 0x23e, 0x23c, 0x3, 0x2, 0x2, 0x2, 0x23f, 0x240, 
       0x7, 0x5, 0x2, 0x2, 0x240, 0x45, 0x3, 0x2, 0x2, 0x2, 0x241, 0x242, 
       0x5, 0xa, 0x6, 0x2, 0x242, 0x47, 0x3, 0x2, 0x2, 0x2, 0x243, 0x244, 
       0x7, 0x13, 0x2, 0x2, 0x244, 0x245, 0x7, 0x5c, 0x2, 0x2, 0x245, 0x250, 
       0x5, 0x4a, 0x26, 0x2, 0x246, 0x247, 0x7, 0x11, 0x2, 0x2, 0x247, 0x248, 
       0x7, 0x5c, 0x2, 0x2, 0x248, 0x249, 0x5, 0x38, 0x1d, 0x2, 0x249, 0x24a, 
       0x7, 0x7, 0x2, 0x2, 0x24a, 0x250, 0x3, 0x2, 0x2, 0x2, 0x24b, 0x24c, 
       0x7, 0xf, 0x2, 0x2, 0x24c, 0x24d, 0x7, 0x5c, 0x2, 0x2, 0x24d, 0x24e, 
       0x7, 0x7e, 0x2, 0x2, 0x24e, 0x250, 0x7, 0x7, 0x2, 0x2, 0x24f, 0x243, 
       0x3, 0x2, 0x2, 0x2, 0x24f, 0x246, 0x3, 0x2, 0x2, 0x2, 0x24f, 0x24b, 
       0x3, 0x2, 0x2, 0x2, 0x250, 0x49, 0x3, 0x2, 0x2, 0x2, 0x251, 0x256, 
       0x5, 0x4c, 0x27, 0x2, 0x252, 0x253, 0x7, 0x61, 0x2, 0x2, 0x253, 0x255, 
       0x5, 0x4c, 0x27, 0x2, 0x254, 0x252, 0x3, 0x2, 0x2, 0x2, 0x255, 0x258, 
       0x3, 0x2, 0x2, 0x2, 0x256, 0x254, 0x3, 0x2, 0x2, 0x2, 0x256, 0x257, 
       0x3, 0x2, 0x2, 0x2, 0x257, 0x4b, 0x3, 0x2, 0x2, 0x2, 0x258, 0x256, 
       0x3, 0x2, 0x2, 0x2, 0x259, 0x26d, 0x7, 0x58, 0x2, 0x2, 0x25a, 0x25f, 
       0x5, 0x4e, 0x28, 0x2, 0x25b, 0x25c, 0x7, 0x7, 0x2, 0x2, 0x25c, 0x25e, 
       0x5, 0x4e, 0x28, 0x2, 0x25d, 0x25b, 0x3, 0x2, 0x2, 0x2, 0x25e, 0x261, 
       0x3, 0x2, 0x2, 0x2, 0x25f, 0x25d, 0x3, 0x2, 0x2, 0x2, 0x25f, 0x260, 
       0x3, 0x2, 0x2, 0x2, 0x260, 0x263, 0x3, 0x2, 0x2, 0x2, 0x261, 0x25f, 
       0x3, 0x2, 0x2, 0x2, 0x262, 0x264, 0x7, 0x7, 0x2, 0x2, 0x263, 0x262, 
       0x3, 0x2, 0x2, 0x2, 0x263, 0x264, 0x3, 0x2, 0x2, 0x2, 0x264, 0x26e, 
       0x3, 0x2, 0x2, 0x2, 0x265, 0x26a, 0x5, 0x50, 0x29, 0x2, 0x266, 0x267, 
       0x7, 0x5d, 0x2, 0x2, 0x267, 0x269, 0x5, 0x50, 0x29, 0x2, 0x268, 0x266, 
       0x3, 0x2, 0x2, 0x2, 0x269, 0x26c, 0x3, 0x2, 0x2, 0x2, 0x26a, 0x268, 
       0x3, 0x2, 0x2, 0x2, 0x26a, 0x26b, 0x3, 0x2, 0x2, 0x2, 0x26b, 0x26e, 
       0x3, 0x2, 0x2, 0x2, 0x26c, 0x26a, 0x3, 0x2, 0x2, 0x2, 0x26d, 0x25a, 
       0x3, 0x2, 0x2, 0x2, 0x26d, 0x265, 0x3, 0x2, 0x2, 0x2, 0x26e, 0x26f, 
       0x3, 0x2, 0x2, 0x2, 0x26f, 0x270, 0x7, 0x59, 0x2, 0x2, 0x270, 0x4d, 
       0x3, 0x2, 0x2, 0x2, 0x271, 0x272, 0x7, 0x66, 0x2, 0x2, 0x272, 0x273, 
       0x7, 0x5c, 0x2, 0x2, 0x273, 0x293, 0x5, 0xb6, 0x5c, 0x2, 0x274, 0x275, 
       0x7, 0x67, 0x2, 0x2, 0x275, 0x276, 0x7, 0x5c, 0x2, 0x2, 0x276, 0x293, 
       0x5, 0xb8, 0x5d, 0x2, 0x277, 0x278, 0x7, 0x68, 0x2, 0x2, 0x278, 0x279, 
       0x7, 0x5c, 0x2, 0x2, 0x279, 0x293, 0x5, 0xb8, 0x5d, 0x2, 0x27a, 0x27b, 
       0x7, 0x28, 0x2, 0x2, 0x27b, 0x27c, 0x7, 0x5c, 0x2, 0x2, 0x27c, 0x293, 
       0x5, 0xb6, 0x5c, 0x2, 0x27d, 0x27e, 0x7, 0x69, 0x2, 0x2, 0x27e, 0x27f, 
       0x7, 0x5c, 0x2, 0x2, 0x27f, 0x293, 0x5, 0xb6, 0x5c, 0x2, 0x280, 0x281, 
       0x7, 0x6a, 0x2, 0x2, 0x281, 0x282, 0x7, 0x5c, 0x2, 0x2, 0x282, 0x293, 
       0x5, 0xb6, 0x5c, 0x2, 0x283, 0x284, 0x7, 0x6b, 0x2, 0x2, 0x284, 0x285, 
       0x7, 0x5c, 0x2, 0x2, 0x285, 0x293, 0x5, 0xb6, 0x5c, 0x2, 0x286, 0x287, 
       0x7, 0x6c, 0x2, 0x2, 0x287, 0x288, 0x7, 0x5c, 0x2, 0x2, 0x288, 0x293, 
       0x7, 0x7e, 0x2, 0x2, 0x289, 0x28a, 0x7, 0x6d, 0x2, 0x2, 0x28a, 0x28b, 
       0x7, 0x5c, 0x2, 0x2, 0x28b, 0x293, 0x7, 0x7e, 0x2, 0x2, 0x28c, 0x28d, 
       0x7, 0x23, 0x2, 0x2, 0x28d, 0x28e, 0x7, 0x5c, 0x2, 0x2, 0x28e, 0x293, 
       0x7, 0x7e, 0x2, 0x2, 0x28f, 0x290, 0x7, 0x6e, 0x2, 0x2, 0x290, 0x291, 
       0x7, 0x5c, 0x2, 0x2, 0x291, 0x293, 0x7, 0x7e, 0x2, 0x2, 0x292, 0x271, 
       0x3, 0x2, 0x2, 0x2, 0x292, 0x274, 0x3, 0x2, 0x2, 0x2, 0x292, 0x277, 
       0x3, 0x2, 0x2, 0x2, 0x292, 0x27a, 0x3, 0x2, 0x2, 0x2, 0x292, 0x27d, 
       0x3, 0x2, 0x2, 0x2, 0x292, 0x280, 0x3, 0x2, 0x2, 0x2, 0x292, 0x283, 
       0x3, 0x2, 0x2, 0x2, 0x292, 0x286, 0x3, 0x2, 0x2, 0x2, 0x292, 0x289, 
       0x3, 0x2, 0x2, 0x2, 0x292, 0x28c, 0x3, 0x2, 0x2, 0x2, 0x292, 0x28f, 
       0x3, 0x2, 0x2, 0x2, 0x293, 0x4f, 0x3, 0x2, 0x2, 0x2, 0x294, 0x297, 
       0x5, 0xb6, 0x5c, 0x2, 0x295, 0x297, 0x7, 0x7e, 0x2, 0x2, 0x296, 0x294, 
       0x3, 0x2, 0x2, 0x2, 0x296, 0x295, 0x3, 0x2, 0x2, 0x2, 0x297, 0x51, 
       0x3, 0x2, 0x2, 0x2, 0x298, 0x299, 0x7, 0x6f, 0x2, 0x2, 0x299, 0x29a, 
       0x5, 0xa, 0x6, 0x2, 0x29a, 0x29b, 0x7, 0x4, 0x2, 0x2, 0x29b, 0x29c, 
       0x7, 0x5, 0x2, 0x2, 0x29c, 0x53, 0x3, 0x2, 0x2, 0x2, 0x29d, 0x29e, 
       0x7, 0x25, 0x2, 0x2, 0x29e, 0x29f, 0x5, 0xa, 0x6, 0x2, 0x29f, 0x2a0, 
       0x7, 0x4, 0x2, 0x2, 0x2a0, 0x2a1, 0x5, 0x56, 0x2c, 0x2, 0x2a1, 0x2a2, 
       0x7, 0x5, 0x2, 0x2, 0x2a2, 0x55, 0x3, 0x2, 0x2, 0x2, 0x2a3, 0x2a6, 
       0x5, 0x58, 0x2d, 0x2, 0x2a4, 0x2a6, 0x5, 0x5a, 0x2e, 0x2, 0x2a5, 
       0x2a3, 0x3, 0x2, 0x2, 0x2, 0x2a5, 0x2a4, 0x3, 0x2, 0x2, 0x2, 0x2a6, 
       0x57, 0x3, 0x2, 0x2, 0x2, 0x2a7, 0x2a8, 0x7, 0x24, 0x2, 0x2, 0x2a8, 
       0x2a9, 0x5, 0x5c, 0x2f, 0x2, 0x2a9, 0x2aa, 0x7, 0x7, 0x2, 0x2, 0x2aa, 
       0x59, 0x3, 0x2, 0x2, 0x2, 0x2ab, 0x2ac, 0x7, 0x29, 0x2, 0x2, 0x2ac, 
       0x2ad, 0x5, 0x5c, 0x2f, 0x2, 0x2ad, 0x2b1, 0x7, 0x4, 0x2, 0x2, 0x2ae, 
       0x2b0, 0x5, 0x5e, 0x30, 0x2, 0x2af, 0x2ae, 0x3, 0x2, 0x2, 0x2, 0x2b0, 
       0x2b3, 0x3, 0x2, 0x2, 0x2, 0x2b1, 0x2af, 0x3, 0x2, 0x2, 0x2, 0x2b1, 
       0x2b2, 0x3, 0x2, 0x2, 0x2, 0x2b2, 0x2b4, 0x3, 0x2, 0x2, 0x2, 0x2b3, 
       0x2b1, 0x3, 0x2, 0x2, 0x2, 0x2b4, 0x2b5, 0x7, 0x5, 0x2, 0x2, 0x2b5, 
       0x5b, 0x3, 0x2, 0x2, 0x2, 0x2b6, 0x2c0, 0x5, 0xa, 0x6, 0x2, 0x2b7, 
       0x2ba, 0x7, 0x70, 0x2, 0x2, 0x2b8, 0x2bb, 0x5, 0xa, 0x6, 0x2, 0x2b9, 
       0x2bb, 0x7, 0x7e, 0x2, 0x2, 0x2ba, 0x2b8, 0x3, 0x2, 0x2, 0x2, 0x2ba, 
       0x2b9, 0x3, 0x2, 0x2, 0x2, 0x2bb, 0x2bc, 0x3, 0x2, 0x2, 0x2, 0x2bc, 
       0x2ba, 0x3, 0x2, 0x2, 0x2, 0x2bc, 0x2bd, 0x3, 0x2, 0x2, 0x2, 0x2bd, 
       0x2bf, 0x3, 0x2, 0x2, 0x2, 0x2be, 0x2b7, 0x3, 0x2, 0x2, 0x2, 0x2bf, 
       0x2c2, 0x3, 0x2, 0x2, 0x2, 0x2c0, 0x2be, 0x3, 0x2, 0x2, 0x2, 0x2c0, 
       0x2c1, 0x3, 0x2, 0x2, 0x2, 0x2c1, 0x5d, 0x3, 0x2, 0x2, 0x2, 0x2c2, 
       0x2c0, 0x3, 0x2, 0x2, 0x2, 0x2c3, 0x2c4, 0x7, 0x2a, 0x2, 0x2, 0x2c4, 
       0x2c5, 0x7, 0x5c, 0x2, 0x2, 0x2c5, 0x2c6, 0x5, 0x60, 0x31, 0x2, 0x2c6, 
       0x2c7, 0x7, 0x7, 0x2, 0x2, 0x2c7, 0x2db, 0x3, 0x2, 0x2, 0x2, 0x2c8, 
       0x2c9, 0x7, 0x2b, 0x2, 0x2, 0x2c9, 0x2ca, 0x7, 0x5c, 0x2, 0x2, 0x2ca, 
       0x2cb, 0x7, 0x7e, 0x2, 0x2, 0x2cb, 0x2db, 0x7, 0x7, 0x2, 0x2, 0x2cc, 
       0x2cd, 0x7, 0x2c, 0x2, 0x2, 0x2cd, 0x2ce, 0x7, 0x5c, 0x2, 0x2, 0x2ce, 
       0x2cf, 0x5, 0xa6, 0x54, 0x2, 0x2cf, 0x2d0, 0x7, 0x7, 0x2, 0x2, 0x2d0, 
       0x2db, 0x3, 0x2, 0x2, 0x2, 0x2d1, 0x2d2, 0x7, 0x9, 0x2, 0x2, 0x2d2, 
       0x2d3, 0x7, 0x5c, 0x2, 0x2, 0x2d3, 0x2d4, 0x7, 0x7e, 0x2, 0x2, 0x2d4, 
       0x2db, 0x7, 0x7, 0x2, 0x2, 0x2d5, 0x2d6, 0x7, 0x19, 0x2, 0x2, 0x2d6, 
       0x2d7, 0x7, 0x5c, 0x2, 0x2, 0x2d7, 0x2d8, 0x5, 0xa6, 0x54, 0x2, 0x2d8, 
       0x2d9, 0x7, 0x7, 0x2, 0x2, 0x2d9, 0x2db, 0x3, 0x2, 0x2, 0x2, 0x2da, 
       0x2c3, 0x3, 0x2, 0x2, 0x2, 0x2da, 0x2c8, 0x3, 0x2, 0x2, 0x2, 0x2da, 
       0x2cc, 0x3, 0x2, 0x2, 0x2, 0x2da, 0x2d1, 0x3, 0x2, 0x2, 0x2, 0x2da, 
       0x2d5, 0x3, 0x2, 0x2, 0x2, 0x2db, 0x5f, 0x3, 0x2, 0x2, 0x2, 0x2dc, 
       0x2dd, 0x9, 0x5, 0x2, 0x2, 0x2dd, 0x61, 0x3, 0x2, 0x2, 0x2, 0x2de, 
       0x2df, 0x7, 0x26, 0x2, 0x2, 0x2df, 0x2e0, 0x5, 0x5c, 0x2f, 0x2, 0x2e0, 
       0x2e2, 0x7, 0x4, 0x2, 0x2, 0x2e1, 0x2e3, 0x5, 0x64, 0x33, 0x2, 0x2e2, 
       0x2e1, 0x3, 0x2, 0x2, 0x2, 0x2e3, 0x2e4, 0x3, 0x2, 0x2, 0x2, 0x2e4, 
       0x2e2, 0x3, 0x2, 0x2, 0x2, 0x2e4, 0x2e5, 0x3, 0x2, 0x2, 0x2, 0x2e5, 
       0x2e6, 0x3, 0x2, 0x2, 0x2, 0x2e6, 0x2e7, 0x7, 0x5, 0x2, 0x2, 0x2e7, 
       0x63, 0x3, 0x2, 0x2, 0x2, 0x2e8, 0x2e9, 0x7, 0x25, 0x2, 0x2, 0x2e9, 
       0x2ea, 0x5, 0x5c, 0x2f, 0x2, 0x2ea, 0x2eb, 0x7, 0x7, 0x2, 0x2, 0x2eb, 
       0x65, 0x3, 0x2, 0x2, 0x2, 0x2ec, 0x2ed, 0x7, 0x27, 0x2, 0x2, 0x2ed, 
       0x2ee, 0x5, 0x5c, 0x2f, 0x2, 0x2ee, 0x2f0, 0x7, 0x4, 0x2, 0x2, 0x2ef, 
       0x2f1, 0x5, 0x68, 0x35, 0x2, 0x2f0, 0x2ef, 0x3, 0x2, 0x2, 0x2, 0x2f1, 
       0x2f2, 0x3, 0x2, 0x2, 0x2, 0x2f2, 0x2f0, 0x3, 0x2, 0x2, 0x2, 0x2f2, 
       0x2f3, 0x3, 0x2, 0x2, 0x2, 0x2f3, 0x2f4, 0x3, 0x2, 0x2, 0x2, 0x2f4, 
       0x2f5, 0x7, 0x5, 0x2, 0x2, 0x2f5, 0x67, 0x3, 0x2, 0x2, 0x2, 0x2f6, 
       0x2f7, 0x7, 0x26, 0x2, 0x2, 0x2f7, 0x2f8, 0x5, 0x5c, 0x2f, 0x2, 0x2f8, 
       0x69, 0x3, 0x2, 0x2, 0x2, 0x2f9, 0x2fa, 0x7, 0x28, 0x2, 0x2, 0x2fa, 
       0x2fb, 0x5, 0x5c, 0x2f, 0x2, 0x2fb, 0x2fd, 0x7, 0x4, 0x2, 0x2, 0x2fc, 
       0x2fe, 0x5, 0x6c, 0x37, 0x2, 0x2fd, 0x2fc, 0x3, 0x2, 0x2, 0x2, 0x2fe, 
       0x2ff, 0x3, 0x2, 0x2, 0x2, 0x2ff, 0x2fd, 0x3, 0x2, 0x2, 0x2, 0x2ff, 
       0x300, 0x3, 0x2, 0x2, 0x2, 0x300, 0x301, 0x3, 0x2, 0x2, 0x2, 0x301, 
       0x302, 0x7, 0x5, 0x2, 0x2, 0x302, 0x6b, 0x3, 0x2, 0x2, 0x2, 0x303, 
       0x304, 0x7, 0x27, 0x2, 0x2, 0x304, 0x305, 0x5, 0x5c, 0x2f, 0x2, 0x305, 
       0x306, 0x7, 0x7, 0x2, 0x2, 0x306, 0x6d, 0x3, 0x2, 0x2, 0x2, 0x307, 
       0x309, 0x5, 0x72, 0x3a, 0x2, 0x308, 0x307, 0x3, 0x2, 0x2, 0x2, 0x309, 
       0x30c, 0x3, 0x2, 0x2, 0x2, 0x30a, 0x308, 0x3, 0x2, 0x2, 0x2, 0x30a, 
       0x30b, 0x3, 0x2, 0x2, 0x2, 0x30b, 0x30d, 0x3, 0x2, 0x2, 0x2, 0x30c, 
       0x30a, 0x3, 0x2, 0x2, 0x2, 0x30d, 0x30e, 0x7, 0x3b, 0x2, 0x2, 0x30e, 
       0x30f, 0x5, 0xa, 0x6, 0x2, 0x30f, 0x313, 0x7, 0x4, 0x2, 0x2, 0x310, 
       0x312, 0x5, 0x70, 0x39, 0x2, 0x311, 0x310, 0x3, 0x2, 0x2, 0x2, 0x312, 
       0x315, 0x3, 0x2, 0x2, 0x2, 0x313, 0x311, 0x3, 0x2, 0x2, 0x2, 0x313, 
       0x314, 0x3, 0x2, 0x2, 0x2, 0x314, 0x316, 0x3, 0x2, 0x2, 0x2, 0x315, 
       0x313, 0x3, 0x2, 0x2, 0x2, 0x316, 0x317, 0x7, 0x5, 0x2, 0x2, 0x317, 
       0x6f, 0x3, 0x2, 0x2, 0x2, 0x318, 0x31e, 0x5, 0x74, 0x3b, 0x2, 0x319, 
       0x31e, 0x5, 0x76, 0x3c, 0x2, 0x31a, 0x31e, 0x5, 0x7a, 0x3e, 0x2, 
       0x31b, 0x31e, 0x5, 0x7c, 0x3f, 0x2, 0x31c, 0x31e, 0x5, 0x98, 0x4d, 
       0x2, 0x31d, 0x318, 0x3, 0x2, 0x2, 0x2, 0x31d, 0x319, 0x3, 0x2, 0x2, 
       0x2, 0x31d, 0x31a, 0x3, 0x2, 0x2, 0x2, 0x31d, 0x31b, 0x3, 0x2, 0x2, 
       0x2, 0x31d, 0x31c, 0x3, 0x2, 0x2, 0x2, 0x31e, 0x71, 0x3, 0x2, 0x2, 
       0x2, 0x31f, 0x320, 0x7, 0x40, 0x2, 0x2, 0x320, 0x322, 0x7, 0x7f, 
       0x2, 0x2, 0x321, 0x323, 0x7, 0x7, 0x2, 0x2, 0x322, 0x321, 0x3, 0x2, 
       0x2, 0x2, 0x322, 0x323, 0x3, 0x2, 0x2, 0x2, 0x323, 0x73, 0x3, 0x2, 
       0x2, 0x2, 0x324, 0x325, 0x7, 0x3c, 0x2, 0x2, 0x325, 0x326, 0x5, 0xa, 
       0x6, 0x2, 0x326, 0x75, 0x3, 0x2, 0x2, 0x2, 0x327, 0x328, 0x7, 0x3e, 
       0x2, 0x2, 0x328, 0x32a, 0x7, 0x4, 0x2, 0x2, 0x329, 0x32b, 0x5, 0x78, 
       0x3d, 0x2, 0x32a, 0x329, 0x3, 0x2, 0x2, 0x2, 0x32b, 0x32c, 0x3, 0x2, 
       0x2, 0x2, 0x32c, 0x32a, 0x3, 0x2, 0x2, 0x2, 0x32c, 0x32d, 0x3, 0x2, 
       0x2, 0x2, 0x32d, 0x32e, 0x3, 0x2, 0x2, 0x2, 0x32e, 0x32f, 0x7, 0x5, 
       0x2, 0x2, 0x32f, 0x77, 0x3, 0x2, 0x2, 0x2, 0x330, 0x331, 0x5, 0xb6, 
       0x5c, 0x2, 0x331, 0x332, 0x7, 0x7, 0x2, 0x2, 0x332, 0x79, 0x3, 0x2, 
       0x2, 0x2, 0x333, 0x335, 0x7, 0x3d, 0x2, 0x2, 0x334, 0x333, 0x3, 0x2, 
       0x2, 0x2, 0x334, 0x335, 0x3, 0x2, 0x2, 0x2, 0x335, 0x336, 0x3, 0x2, 
       0x2, 0x2, 0x336, 0x337, 0x7, 0x37, 0x2, 0x2, 0x337, 0x338, 0x5, 0xa, 
       0x6, 0x2, 0x338, 0x7b, 0x3, 0x2, 0x2, 0x2, 0x339, 0x33a, 0x7, 0x3f, 
       0x2, 0x2, 0x33a, 0x33b, 0x5, 0xa, 0x6, 0x2, 0x33b, 0x33d, 0x7, 0x4, 
       0x2, 0x2, 0x33c, 0x33e, 0x5, 0x7e, 0x40, 0x2, 0x33d, 0x33c, 0x3, 
       0x2, 0x2, 0x2, 0x33e, 0x33f, 0x3, 0x2, 0x2, 0x2, 0x33f, 0x33d, 0x3, 
       0x2, 0x2, 0x2, 0x33f, 0x340, 0x3, 0x2, 0x2, 0x2, 0x340, 0x341, 0x3, 
       0x2, 0x2, 0x2, 0x341, 0x342, 0x7, 0x5, 0x2, 0x2, 0x342, 0x7d, 0x3, 
       0x2, 0x2, 0x2, 0x343, 0x346, 0x5, 0x80, 0x41, 0x2, 0x344, 0x346, 
       0x5, 0x82, 0x42, 0x2, 0x345, 0x343, 0x3, 0x2, 0x2, 0x2, 0x345, 0x344, 
       0x3, 0x2, 0x2, 0x2, 0x346, 0x7f, 0x3, 0x2, 0x2, 0x2, 0x347, 0x348, 
       0x7, 0x43, 0x2, 0x2, 0x348, 0x34c, 0x7, 0x4, 0x2, 0x2, 0x349, 0x34b, 
       0x5, 0x84, 0x43, 0x2, 0x34a, 0x349, 0x3, 0x2, 0x2, 0x2, 0x34b, 0x34e, 
       0x3, 0x2, 0x2, 0x2, 0x34c, 0x34a, 0x3, 0x2, 0x2, 0x2, 0x34c, 0x34d, 
       0x3, 0x2, 0x2, 0x2, 0x34d, 0x34f, 0x3, 0x2, 0x2, 0x2, 0x34e, 0x34c, 
       0x3, 0x2, 0x2, 0x2, 0x34f, 0x35a, 0x7, 0x5, 0x2, 0x2, 0x350, 0x351, 
       0x7, 0x39, 0x2, 0x2, 0x351, 0x355, 0x7, 0x4, 0x2, 0x2, 0x352, 0x354, 
       0x5, 0x84, 0x43, 0x2, 0x353, 0x352, 0x3, 0x2, 0x2, 0x2, 0x354, 0x357, 
       0x3, 0x2, 0x2, 0x2, 0x355, 0x353, 0x3, 0x2, 0x2, 0x2, 0x355, 0x356, 
       0x3, 0x2, 0x2, 0x2, 0x356, 0x358, 0x3, 0x2, 0x2, 0x2, 0x357, 0x355, 
       0x3, 0x2, 0x2, 0x2, 0x358, 0x35a, 0x7, 0x5, 0x2, 0x2, 0x359, 0x347, 
       0x3, 0x2, 0x2, 0x2, 0x359, 0x350, 0x3, 0x2, 0x2, 0x2, 0x35a, 0x81, 
       0x3, 0x2, 0x2, 0x2, 0x35b, 0x35c, 0x5, 0x96, 0x4c, 0x2, 0x35c, 0x35d, 
       0x7, 0x6, 0x2, 0x2, 0x35d, 0x35e, 0x5, 0x80, 0x41, 0x2, 0x35e, 0x83, 
       0x3, 0x2, 0x2, 0x2, 0x35f, 0x368, 0x5, 0x80, 0x41, 0x2, 0x360, 0x368, 
       0x5, 0x86, 0x44, 0x2, 0x361, 0x368, 0x5, 0x88, 0x45, 0x2, 0x362, 
       0x368, 0x5, 0x8a, 0x46, 0x2, 0x363, 0x368, 0x5, 0x8e, 0x48, 0x2, 
       0x364, 0x368, 0x5, 0x90, 0x49, 0x2, 0x365, 0x368, 0x5, 0x92, 0x4a, 
       0x2, 0x366, 0x368, 0x5, 0x94, 0x4b, 0x2, 0x367, 0x35f, 0x3, 0x2, 
       0x2, 0x2, 0x367, 0x360, 0x3, 0x2, 0x2, 0x2, 0x367, 0x361, 0x3, 0x2, 
       0x2, 0x2, 0x367, 0x362, 0x3, 0x2, 0x2, 0x2, 0x367, 0x363, 0x3, 0x2, 
       0x2, 0x2, 0x367, 0x364, 0x3, 0x2, 0x2, 0x2, 0x367, 0x365, 0x3, 0x2, 
       0x2, 0x2, 0x367, 0x366, 0x3, 0x2, 0x2, 0x2, 0x368, 0x85, 0x3, 0x2, 
       0x2, 0x2, 0x369, 0x36a, 0x5, 0xb6, 0x5c, 0x2, 0x36a, 0x36b, 0x7, 
       0x5c, 0x2, 0x2, 0x36b, 0x36c, 0x5, 0x9a, 0x4e, 0x2, 0x36c, 0x36d, 
       0x7, 0x7, 0x2, 0x2, 0x36d, 0x87, 0x3, 0x2, 0x2, 0x2, 0x36e, 0x36f, 
       0x7, 0x48, 0x2, 0x2, 0x36f, 0x370, 0x7, 0x71, 0x2, 0x2, 0x370, 0x371, 
       0x5, 0x9a, 0x4e, 0x2, 0x371, 0x372, 0x7, 0x5d, 0x2, 0x2, 0x372, 0x373, 
       0x5, 0x9a, 0x4e, 0x2, 0x373, 0x374, 0x7, 0x72, 0x2, 0x2, 0x374, 0x375, 
       0x7, 0x7, 0x2, 0x2, 0x375, 0x38f, 0x3, 0x2, 0x2, 0x2, 0x376, 0x377, 
       0x7, 0x49, 0x2, 0x2, 0x377, 0x378, 0x7, 0x71, 0x2, 0x2, 0x378, 0x379, 
       0x5, 0x9a, 0x4e, 0x2, 0x379, 0x37a, 0x7, 0x5d, 0x2, 0x2, 0x37a, 0x37b, 
       0x5, 0x9a, 0x4e, 0x2, 0x37b, 0x37c, 0x7, 0x72, 0x2, 0x2, 0x37c, 0x37d, 
       0x7, 0x7, 0x2, 0x2, 0x37d, 0x38f, 0x3, 0x2, 0x2, 0x2, 0x37e, 0x37f, 
       0x7, 0x4a, 0x2, 0x2, 0x37f, 0x380, 0x7, 0x71, 0x2, 0x2, 0x380, 0x381, 
       0x5, 0x9a, 0x4e, 0x2, 0x381, 0x382, 0x7, 0x5d, 0x2, 0x2, 0x382, 0x383, 
       0x5, 0x9a, 0x4e, 0x2, 0x383, 0x384, 0x7, 0x72, 0x2, 0x2, 0x384, 0x385, 
       0x7, 0x7, 0x2, 0x2, 0x385, 0x38f, 0x3, 0x2, 0x2, 0x2, 0x386, 0x387, 
       0x7, 0x4b, 0x2, 0x2, 0x387, 0x388, 0x7, 0x71, 0x2, 0x2, 0x388, 0x389, 
       0x5, 0x9a, 0x4e, 0x2, 0x389, 0x38a, 0x7, 0x5d, 0x2, 0x2, 0x38a, 0x38b, 
       0x5, 0x9a, 0x4e, 0x2, 0x38b, 0x38c, 0x7, 0x72, 0x2, 0x2, 0x38c, 0x38d, 
       0x7, 0x7, 0x2, 0x2, 0x38d, 0x38f, 0x3, 0x2, 0x2, 0x2, 0x38e, 0x36e, 
       0x3, 0x2, 0x2, 0x2, 0x38e, 0x376, 0x3, 0x2, 0x2, 0x2, 0x38e, 0x37e, 
       0x3, 0x2, 0x2, 0x2, 0x38e, 0x386, 0x3, 0x2, 0x2, 0x2, 0x38f, 0x89, 
       0x3, 0x2, 0x2, 0x2, 0x390, 0x391, 0x7, 0x24, 0x2, 0x2, 0x391, 0x392, 
       0x5, 0xb6, 0x5c, 0x2, 0x392, 0x394, 0x7, 0x71, 0x2, 0x2, 0x393, 0x395, 
       0x5, 0x8c, 0x47, 0x2, 0x394, 0x393, 0x3, 0x2, 0x2, 0x2, 0x394, 0x395, 
       0x3, 0x2, 0x2, 0x2, 0x395, 0x396, 0x3, 0x2, 0x2, 0x2, 0x396, 0x397, 
       0x7, 0x72, 0x2, 0x2, 0x397, 0x398, 0x7, 0x7, 0x2, 0x2, 0x398, 0x39e, 
       0x3, 0x2, 0x2, 0x2, 0x399, 0x39a, 0x7, 0x24, 0x2, 0x2, 0x39a, 0x39b, 
       0x5, 0xb6, 0x5c, 0x2, 0x39b, 0x39c, 0x7, 0x7, 0x2, 0x2, 0x39c, 0x39e, 
       0x3, 0x2, 0x2, 0x2, 0x39d, 0x390, 0x3, 0x2, 0x2, 0x2, 0x39d, 0x399, 
       0x3, 0x2, 0x2, 0x2, 0x39e, 0x8b, 0x3, 0x2, 0x2, 0x2, 0x39f, 0x3a4, 
       0x5, 0x9a, 0x4e, 0x2, 0x3a0, 0x3a1, 0x7, 0x5d, 0x2, 0x2, 0x3a1, 0x3a3, 
       0x5, 0x9a, 0x4e, 0x2, 0x3a2, 0x3a0, 0x3, 0x2, 0x2, 0x2, 0x3a3, 0x3a6, 
       0x3, 0x2, 0x2, 0x2, 0x3a4, 0x3a2, 0x3, 0x2, 0x2, 0x2, 0x3a4, 0x3a5, 
       0x3, 0x2, 0x2, 0x2, 0x3a5, 0x8d, 0x3, 0x2, 0x2, 0x2, 0x3a6, 0x3a4, 
       0x3, 0x2, 0x2, 0x2, 0x3a7, 0x3a8, 0x7, 0x4f, 0x2, 0x2, 0x3a8, 0x3a9, 
       0x5, 0x9a, 0x4e, 0x2, 0x3a9, 0x3aa, 0x7, 0x5d, 0x2, 0x2, 0x3aa, 0x3ab, 
       0x5, 0x9a, 0x4e, 0x2, 0x3ab, 0x3ac, 0x7, 0x5d, 0x2, 0x2, 0x3ac, 0x3ad, 
       0x5, 0x96, 0x4c, 0x2, 0x3ad, 0x3ae, 0x7, 0x7, 0x2, 0x2, 0x3ae, 0x8f, 
       0x3, 0x2, 0x2, 0x2, 0x3af, 0x3b0, 0x7, 0x4c, 0x2, 0x2, 0x3b0, 0x3b1, 
       0x7, 0x71, 0x2, 0x2, 0x3b1, 0x3b2, 0x7, 0x72, 0x2, 0x2, 0x3b2, 0x3ba, 
       0x7, 0x7, 0x2, 0x2, 0x3b3, 0x3b4, 0x7, 0x4d, 0x2, 0x2, 0x3b4, 0x3b5, 
       0x7, 0x71, 0x2, 0x2, 0x3b5, 0x3b6, 0x5, 0x9a, 0x4e, 0x2, 0x3b6, 0x3b7, 
       0x7, 0x72, 0x2, 0x2, 0x3b7, 0x3b8, 0x7, 0x7, 0x2, 0x2, 0x3b8, 0x3ba, 
       0x3, 0x2, 0x2, 0x2, 0x3b9, 0x3af, 0x3, 0x2, 0x2, 0x2, 0x3b9, 0x3b3, 
       0x3, 0x2, 0x2, 0x2, 0x3ba, 0x91, 0x3, 0x2, 0x2, 0x2, 0x3bb, 0x3bc, 
       0x7, 0x4e, 0x2, 0x2, 0x3bc, 0x3bd, 0x7, 0x71, 0x2, 0x2, 0x3bd, 0x3be, 
       0x5, 0x9a, 0x4e, 0x2, 0x3be, 0x3bf, 0x7, 0x72, 0x2, 0x2, 0x3bf, 0x3c0, 
       0x7, 0x7, 0x2, 0x2, 0x3c0, 0x93, 0x3, 0x2, 0x2, 0x2, 0x3c1, 0x3c3, 
       0x7, 0x73, 0x2, 0x2, 0x3c2, 0x3c4, 0x7, 0x7, 0x2, 0x2, 0x3c3, 0x3c2, 
       0x3, 0x2, 0x2, 0x2, 0x3c3, 0x3c4, 0x3, 0x2, 0x2, 0x2, 0x3c4, 0x95, 
       0x3, 0x2, 0x2, 0x2, 0x3c5, 0x3c6, 0x7, 0x74, 0x2, 0x2, 0x3c6, 0x3c7, 
       0x5, 0xa, 0x6, 0x2, 0x3c7, 0x97, 0x3, 0x2, 0x2, 0x2, 0x3c8, 0x3c9, 
       0x7, 0x41, 0x2, 0x2, 0x3c9, 0x3ca, 0x5, 0xa, 0x6, 0x2, 0x3ca, 0x3cb, 
       0x7, 0x75, 0x2, 0x2, 0x3cb, 0x3cc, 0x5, 0xa, 0x6, 0x2, 0x3cc, 0x3cd, 
       0x7, 0x42, 0x2, 0x2, 0x3cd, 0x3ce, 0x5, 0xa, 0x6, 0x2, 0x3ce, 0x99, 
       0x3, 0x2, 0x2, 0x2, 0x3cf, 0x3d0, 0x5, 0x9c, 0x4f, 0x2, 0x3d0, 0x9b, 
       0x3, 0x2, 0x2, 0x2, 0x3d1, 0x3d6, 0x5, 0x9e, 0x50, 0x2, 0x3d2, 0x3d3, 
       0x7, 0x61, 0x2, 0x2, 0x3d3, 0x3d5, 0x5, 0x9e, 0x50, 0x2, 0x3d4, 0x3d2, 
       0x3, 0x2, 0x2, 0x2, 0x3d5, 0x3d8, 0x3, 0x2, 0x2, 0x2, 0x3d6, 0x3d4, 
       0x3, 0x2, 0x2, 0x2, 0x3d6, 0x3d7, 0x3, 0x2, 0x2, 0x2, 0x3d7, 0x9d, 
       0x3, 0x2, 0x2, 0x2, 0x3d8, 0x3d6, 0x3, 0x2, 0x2, 0x2, 0x3d9, 0x3de, 
       0x5, 0xa0, 0x51, 0x2, 0x3da, 0x3db, 0x9, 0x6, 0x2, 0x2, 0x3db, 0x3dd, 
       0x5, 0xa0, 0x51, 0x2, 0x3dc, 0x3da, 0x3, 0x2, 0x2, 0x2, 0x3dd, 0x3e0, 
       0x3, 0x2, 0x2, 0x2, 0x3de, 0x3dc, 0x3, 0x2, 0x2, 0x2, 0x3de, 0x3df, 
       0x3, 0x2, 0x2, 0x2, 0x3df, 0x9f, 0x3, 0x2, 0x2, 0x2, 0x3e0, 0x3de, 
       0x3, 0x2, 0x2, 0x2, 0x3e1, 0x3e6, 0x5, 0xa2, 0x52, 0x2, 0x3e2, 0x3e3, 
       0x9, 0x7, 0x2, 0x2, 0x3e3, 0x3e5, 0x5, 0xa2, 0x52, 0x2, 0x3e4, 0x3e2, 
       0x3, 0x2, 0x2, 0x2, 0x3e5, 0x3e8, 0x3, 0x2, 0x2, 0x2, 0x3e6, 0x3e4, 
       0x3, 0x2, 0x2, 0x2, 0x3e6, 0x3e7, 0x3, 0x2, 0x2, 0x2, 0x3e7, 0xa1, 
       0x3, 0x2, 0x2, 0x2, 0x3e8, 0x3e6, 0x3, 0x2, 0x2, 0x2, 0x3e9, 0x3f3, 
       0x7, 0x7e, 0x2, 0x2, 0x3ea, 0x3f3, 0x7, 0x2f, 0x2, 0x2, 0x3eb, 0x3f3, 
       0x5, 0xb6, 0x5c, 0x2, 0x3ec, 0x3f3, 0x5, 0xa4, 0x53, 0x2, 0x3ed, 
       0x3f3, 0x5, 0xb2, 0x5a, 0x2, 0x3ee, 0x3ef, 0x7, 0x71, 0x2, 0x2, 0x3ef, 
       0x3f0, 0x5, 0x9a, 0x4e, 0x2, 0x3f0, 0x3f1, 0x7, 0x72, 0x2, 0x2, 0x3f1, 
       0x3f3, 0x3, 0x2, 0x2, 0x2, 0x3f2, 0x3e9, 0x3, 0x2, 0x2, 0x2, 0x3f2, 
       0x3ea, 0x3, 0x2, 0x2, 0x2, 0x3f2, 0x3eb, 0x3, 0x2, 0x2, 0x2, 0x3f2, 
       0x3ec, 0x3, 0x2, 0x2, 0x2, 0x3f2, 0x3ed, 0x3, 0x2, 0x2, 0x2, 0x3f2, 
       0x3ee, 0x3, 0x2, 0x2, 0x2, 0x3f3, 0xa3, 0x3, 0x2, 0x2, 0x2, 0x3f4, 
       0x3f5, 0x7, 0x44, 0x2, 0x2, 0x3f5, 0x3f6, 0x7, 0x71, 0x2, 0x2, 0x3f6, 
       0x3f7, 0x5, 0x9a, 0x4e, 0x2, 0x3f7, 0x3f8, 0x7, 0x72, 0x2, 0x2, 0x3f8, 
       0x409, 0x3, 0x2, 0x2, 0x2, 0x3f9, 0x3fa, 0x7, 0x45, 0x2, 0x2, 0x3fa, 
       0x3fb, 0x7, 0x71, 0x2, 0x2, 0x3fb, 0x3fc, 0x5, 0x9a, 0x4e, 0x2, 0x3fc, 
       0x3fd, 0x7, 0x72, 0x2, 0x2, 0x3fd, 0x409, 0x3, 0x2, 0x2, 0x2, 0x3fe, 
       0x3ff, 0x7, 0x46, 0x2, 0x2, 0x3ff, 0x400, 0x7, 0x71, 0x2, 0x2, 0x400, 
       0x401, 0x5, 0x9a, 0x4e, 0x2, 0x401, 0x402, 0x7, 0x72, 0x2, 0x2, 0x402, 
       0x409, 0x3, 0x2, 0x2, 0x2, 0x403, 0x404, 0x7, 0x47, 0x2, 0x2, 0x404, 
       0x405, 0x7, 0x71, 0x2, 0x2, 0x405, 0x406, 0x5, 0x9a, 0x4e, 0x2, 0x406, 
       0x407, 0x7, 0x72, 0x2, 0x2, 0x407, 0x409, 0x3, 0x2, 0x2, 0x2, 0x408, 
       0x3f4, 0x3, 0x2, 0x2, 0x2, 0x408, 0x3f9, 0x3, 0x2, 0x2, 0x2, 0x408, 
       0x3fe, 0x3, 0x2, 0x2, 0x2, 0x408, 0x403, 0x3, 0x2, 0x2, 0x2, 0x409, 
       0xa5, 0x3, 0x2, 0x2, 0x2, 0x40a, 0x40b, 0x5, 0xa8, 0x55, 0x2, 0x40b, 
       0xa7, 0x3, 0x2, 0x2, 0x2, 0x40c, 0x411, 0x5, 0xaa, 0x56, 0x2, 0x40d, 
       0x40e, 0x7, 0x61, 0x2, 0x2, 0x40e, 0x410, 0x5, 0xaa, 0x56, 0x2, 0x40f, 
       0x40d, 0x3, 0x2, 0x2, 0x2, 0x410, 0x413, 0x3, 0x2, 0x2, 0x2, 0x411, 
       0x40f, 0x3, 0x2, 0x2, 0x2, 0x411, 0x412, 0x3, 0x2, 0x2, 0x2, 0x412, 
       0xa9, 0x3, 0x2, 0x2, 0x2, 0x413, 0x411, 0x3, 0x2, 0x2, 0x2, 0x414, 
       0x419, 0x5, 0xac, 0x57, 0x2, 0x415, 0x416, 0x7, 0x7a, 0x2, 0x2, 0x416, 
       0x418, 0x5, 0xac, 0x57, 0x2, 0x417, 0x415, 0x3, 0x2, 0x2, 0x2, 0x418, 
       0x41b, 0x3, 0x2, 0x2, 0x2, 0x419, 0x417, 0x3, 0x2, 0x2, 0x2, 0x419, 
       0x41a, 0x3, 0x2, 0x2, 0x2, 0x41a, 0xab, 0x3, 0x2, 0x2, 0x2, 0x41b, 
       0x419, 0x3, 0x2, 0x2, 0x2, 0x41c, 0x421, 0x5, 0xae, 0x58, 0x2, 0x41d, 
       0x41e, 0x7, 0x78, 0x2, 0x2, 0x41e, 0x420, 0x5, 0xae, 0x58, 0x2, 0x41f, 
       0x41d, 0x3, 0x2, 0x2, 0x2, 0x420, 0x423, 0x3, 0x2, 0x2, 0x2, 0x421, 
       0x41f, 0x3, 0x2, 0x2, 0x2, 0x421, 0x422, 0x3, 0x2, 0x2, 0x2, 0x422, 
       0xad, 0x3, 0x2, 0x2, 0x2, 0x423, 0x421, 0x3, 0x2, 0x2, 0x2, 0x424, 
       0x429, 0x5, 0xb0, 0x59, 0x2, 0x425, 0x426, 0x9, 0x6, 0x2, 0x2, 0x426, 
       0x428, 0x5, 0xb0, 0x59, 0x2, 0x427, 0x425, 0x3, 0x2, 0x2, 0x2, 0x428, 
       0x42b, 0x3, 0x2, 0x2, 0x2, 0x429, 0x427, 0x3, 0x2, 0x2, 0x2, 0x429, 
       0x42a, 0x3, 0x2, 0x2, 0x2, 0x42a, 0xaf, 0x3, 0x2, 0x2, 0x2, 0x42b, 
       0x429, 0x3, 0x2, 0x2, 0x2, 0x42c, 0x435, 0x7, 0x7e, 0x2, 0x2, 0x42d, 
       0x435, 0x7, 0x2f, 0x2, 0x2, 0x42e, 0x435, 0x5, 0xba, 0x5e, 0x2, 0x42f, 
       0x435, 0x5, 0xb2, 0x5a, 0x2, 0x430, 0x431, 0x7, 0x71, 0x2, 0x2, 0x431, 
       0x432, 0x5, 0xa6, 0x54, 0x2, 0x432, 0x433, 0x7, 0x72, 0x2, 0x2, 0x433, 
       0x435, 0x3, 0x2, 0x2, 0x2, 0x434, 0x42c, 0x3, 0x2, 0x2, 0x2, 0x434, 
       0x42d, 0x3, 0x2, 0x2, 0x2, 0x434, 0x42e, 0x3, 0x2, 0x2, 0x2, 0x434, 
       0x42f, 0x3, 0x2, 0x2, 0x2, 0x434, 0x430, 0x3, 0x2, 0x2, 0x2, 0x435, 
       0xb1, 0x3, 0x2, 0x2, 0x2, 0x436, 0x437, 0x5, 0xb6, 0x5c, 0x2, 0x437, 
       0x439, 0x7, 0x71, 0x2, 0x2, 0x438, 0x43a, 0x5, 0xb4, 0x5b, 0x2, 0x439, 
       0x438, 0x3, 0x2, 0x2, 0x2, 0x439, 0x43a, 0x3, 0x2, 0x2, 0x2, 0x43a, 
       0x43b, 0x3, 0x2, 0x2, 0x2, 0x43b, 0x43c, 0x7, 0x72, 0x2, 0x2, 0x43c, 
       0xb3, 0x3, 0x2, 0x2, 0x2, 0x43d, 0x442, 0x5, 0xa6, 0x54, 0x2, 0x43e, 
       0x43f, 0x7, 0x5d, 0x2, 0x2, 0x43f, 0x441, 0x5, 0xa6, 0x54, 0x2, 0x440, 
       0x43e, 0x3, 0x2, 0x2, 0x2, 0x441, 0x444, 0x3, 0x2, 0x2, 0x2, 0x442, 
       0x440, 0x3, 0x2, 0x2, 0x2, 0x442, 0x443, 0x3, 0x2, 0x2, 0x2, 0x443, 
       0xb5, 0x3, 0x2, 0x2, 0x2, 0x444, 0x442, 0x3, 0x2, 0x2, 0x2, 0x445, 
       0x44a, 0x5, 0xa, 0x6, 0x2, 0x446, 0x447, 0x7, 0x70, 0x2, 0x2, 0x447, 
       0x449, 0x5, 0xa, 0x6, 0x2, 0x448, 0x446, 0x3, 0x2, 0x2, 0x2, 0x449, 
       0x44c, 0x3, 0x2, 0x2, 0x2, 0x44a, 0x448, 0x3, 0x2, 0x2, 0x2, 0x44a, 
       0x44b, 0x3, 0x2, 0x2, 0x2, 0x44b, 0xb7, 0x3, 0x2, 0x2, 0x2, 0x44c, 
       0x44a, 0x3, 0x2, 0x2, 0x2, 0x44d, 0x452, 0x5, 0xa, 0x6, 0x2, 0x44e, 
       0x44f, 0x7, 0x79, 0x2, 0x2, 0x44f, 0x451, 0x5, 0xa, 0x6, 0x2, 0x450, 
       0x44e, 0x3, 0x2, 0x2, 0x2, 0x451, 0x454, 0x3, 0x2, 0x2, 0x2, 0x452, 
       0x450, 0x3, 0x2, 0x2, 0x2, 0x452, 0x453, 0x3, 0x2, 0x2, 0x2, 0x453, 
       0x457, 0x3, 0x2, 0x2, 0x2, 0x454, 0x452, 0x3, 0x2, 0x2, 0x2, 0x455, 
       0x456, 0x7, 0x70, 0x2, 0x2, 0x456, 0x458, 0x5, 0xa, 0x6, 0x2, 0x457, 
       0x455, 0x3, 0x2, 0x2, 0x2, 0x457, 0x458, 0x3, 0x2, 0x2, 0x2, 0x458, 
       0xb9, 0x3, 0x2, 0x2, 0x2, 0x459, 0x45a, 0x5, 0xb6, 0x5c, 0x2, 0x45a, 
       0xbb, 0x3, 0x2, 0x2, 0x2, 0x45b, 0x45c, 0x7, 0x70, 0x2, 0x2, 0x45c, 
       0x45d, 0x5, 0xa, 0x6, 0x2, 0x45d, 0xbd, 0x3, 0x2, 0x2, 0x2, 0x45e, 
       0x45f, 0x5, 0xba, 0x5e, 0x2, 0x45f, 0x460, 0x7, 0x58, 0x2, 0x2, 0x460, 
       0x461, 0x7, 0x7e, 0x2, 0x2, 0x461, 0x462, 0x7, 0x59, 0x2, 0x2, 0x462, 
       0xbf, 0x3, 0x2, 0x2, 0x2, 0x463, 0x468, 0x5, 0xc2, 0x62, 0x2, 0x464, 
       0x465, 0x9, 0x7, 0x2, 0x2, 0x465, 0x467, 0x5, 0xc2, 0x62, 0x2, 0x466, 
       0x464, 0x3, 0x2, 0x2, 0x2, 0x467, 0x46a, 0x3, 0x2, 0x2, 0x2, 0x468, 
       0x466, 0x3, 0x2, 0x2, 0x2, 0x468, 0x469, 0x3, 0x2, 0x2, 0x2, 0x469, 
       0xc1, 0x3, 0x2, 0x2, 0x2, 0x46a, 0x468, 0x3, 0x2, 0x2, 0x2, 0x46b, 
       0x472, 0x7, 0x7e, 0x2, 0x2, 0x46c, 0x472, 0x5, 0xba, 0x5e, 0x2, 0x46d, 
       0x46e, 0x7, 0x71, 0x2, 0x2, 0x46e, 0x46f, 0x5, 0xc0, 0x61, 0x2, 0x46f, 
       0x470, 0x7, 0x72, 0x2, 0x2, 0x470, 0x472, 0x3, 0x2, 0x2, 0x2, 0x471, 
       0x46b, 0x3, 0x2, 0x2, 0x2, 0x471, 0x46c, 0x3, 0x2, 0x2, 0x2, 0x471, 
       0x46d, 0x3, 0x2, 0x2, 0x2, 0x472, 0xc3, 0x3, 0x2, 0x2, 0x2, 0x473, 
       0x474, 0x9, 0x8, 0x2, 0x2, 0x474, 0xc5, 0x3, 0x2, 0x2, 0x2, 0x5d, 
       0xc9, 0xd6, 0xde, 0xe9, 0xed, 0xf0, 0xf9, 0x10c, 0x115, 0x119, 0x11b, 
       0x121, 0x12a, 0x138, 0x13c, 0x13e, 0x14c, 0x156, 0x15d, 0x17e, 0x185, 
       0x18d, 0x198, 0x1a3, 0x1ae, 0x1b9, 0x1bf, 0x1d2, 0x1d8, 0x1ef, 0x1f5, 
       0x203, 0x20a, 0x212, 0x215, 0x224, 0x232, 0x236, 0x23c, 0x24f, 0x256, 
       0x25f, 0x263, 0x26a, 0x26d, 0x292, 0x296, 0x2a5, 0x2b1, 0x2ba, 0x2bc, 
       0x2c0, 0x2da, 0x2e4, 0x2f2, 0x2ff, 0x30a, 0x313, 0x31d, 0x322, 0x32c, 
       0x334, 0x33f, 0x345, 0x34c, 0x355, 0x359, 0x367, 0x38e, 0x394, 0x39d, 
       0x3a4, 0x3b9, 0x3c3, 0x3d6, 0x3de, 0x3e6, 0x3f2, 0x408, 0x411, 0x419, 
       0x421, 0x429, 0x434, 0x439, 0x442, 0x44a, 0x452, 0x457, 0x468, 0x471, 
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
