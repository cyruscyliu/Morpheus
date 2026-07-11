grammar devilang;

// ---------- parser rules ----------

program
    : decl* EOF
    ;

decl
    : structDecl
    | topologyDecl
    | actionDecl
    | opDecl
    | topBbDecl
    | topPathDecl
    | topFuncDecl
    | machineDecl
    ;

// ----- structs -----

structDecl
    : 'struct' ident '{' field* '}'
    ;

field
    : ident ':' type_ modifier* bitBlock? immBlock? ';'
    ;

// ident allows selected keywords to be used as identifiers in reference
// positions and struct fields.
ident
    : IDENT
    | 'count' | 'size' | 'head' | 'tail' | 'next' | 'prev' | 'base'
    | 'align' | 'from' | 'to' | 'sentinel' | 'position' | 'link'
    | 'status' | 'command' | 'control' | 'flags' | 'data' | 'addr'
    | 'buf' | 'buffer' | 'tag' | 'id' | 'sig' | 'ctrl' | 'token' | 'inst'
    | 'arg' | 'call' | 'op' | 'bb' | 'path' | 'func' | 'mmio'
    | 'direction' | 'region' | 'address'
    | 'r' | 'w'
    | 'unknown' | 'phi' | 'select' | 'num' | 'var'
    | 'flag' | 'random' | 'immediate'
    | 'state' | 'seq' | 'repeat' | 'value'
    | 'machine' | 'initial' | 'final' | 'scratch' | 'trace' | 'entry'
    | 'import' | 'transition' | 'on' | 'sequence'
    | 'read8' | 'read16' | 'read32' | 'read64'
    | 'write8' | 'write16' | 'write32' | 'write64'
    | 'BUG' | 'BUG_ON' | 'WARN_ON' | 'neqj' | 'goto'
    ;

type_
    : baseType
    | ptrType
    | bytesType
    ;

baseType
    : 'u8'
    | 'u16'
    | 'u32'
    | 'u64'
    ;

ptrType
    : 'ptr' '<' type_ '>'
    ;

bytesType
    : 'bytes' '[' INT ']'
    ;

modifier
    : 'flag'
    | 'random'
    | 'immediate'
    | 'align' INT
    ;

bitBlock
    : '[' (bitEntry (bitSep bitEntry)* bitSep?)? ']'
    ;

bitEntry
    : bitRange bitValue?
    ;

bitRange
    : 'bits' INT '..' INT
    | INT '..' INT
    ;

bitValue
    : '=' INT
    ;

bitSep
    : ';'
    | ','
    ;

immBlock
    : '[' (immEntry (immSep immEntry)* immSep?)? ']'
    ;

immEntry
    : 'imm' INT
    | 'range' INT '..' INT
    | INT
    | INT '..' INT
    ;

immSep
    : ';'
    | ','
    ;

// ----- topology -----

topologyDecl
    : pointerDecl
    | listDecl
    | dlistDecl
    | ringDecl
    | ringbufDecl
    | headDecl
    ;

pointerDecl
    : 'pointer' '{' pointerField* '}'
    ;

pointerField
    : 'from'      '=' ref         ';'
    | 'to'        '=' typeList    ';'
    | 'align'     '=' INT         ';'
    | 'immediate' '=' boolLiteral ';'
    | 'count'     '=' INT         ';'
    | 'sentinel'  '=' bitRefList  ';'
    ;

bitRefList
    : bitRef ('|' bitRef)*
    ;

listDecl
    : 'list' '<' typeList '>' ident? '{' listBody '}'
    ;

dlistDecl
    : 'dlist' '<' typeList '>' ident? '{' dlistBody '}'
    ;

ringDecl
    : 'ring' '<' typeList '>' ident? '{' ringBody '}'
    ;

ringbufDecl
    : 'ringbuf' '<' type_ '>' ident? '{' ringbufBody '}'
    ;

typeList
    : ident ('|' ident)*
    ;

spaceTypeList
    : ident+
    ;

listBody
    : 'head' '=' ref ';'
      'tail' '=' ref ';'
      'next' '=' fieldRefOrList ';'
      ('sentinel' '=' bitRefList ';')?
      ('align' '=' INT ';')?
    ;

dlistBody
    : 'head' '=' ref ';'
      'tail' '=' ref ';'
      'next' '=' fieldRefOrList ';'
      'prev' '=' fieldRefOrList ';'
      ('sentinel' '=' bitRefList ';')?
      ('align' '=' INT ';')?
    ;

ringBody
    : 'head' '=' ref ';'
      'next' '=' fieldRefOrList ';'
      ('align' '=' INT ';')?
    ;

fieldRefOrList
    : fieldRef ('|' fieldRef)*
    | ident ('|' ident)*
    ;

ringbufBody
    : 'base' '=' expr ';'
      (
          'size' '=' INT ';'
        | 'count' '=' ref ';'
      )
      'head' '=' ref ';'
      'tail' '=' ref ';'
      ('align' '=' INT ';')?
    ;

// ----- head topology -----

headDecl
    : 'head' headName? '{' headField* '}'
    ;

headName
    : ident
    ;

headField
    : 'position' '=' headPosition
    | 'to'       '=' spaceTypeList ';'
    | 'align'    '=' INT ';'
    ;

headPosition
    : headLocation ('|' headLocation)*
    ;

headLocation
    : '[' (
            headKeyValue (';' headKeyValue)* ';'?
          | headAtom (',' headAtom)*
          ) ']'
    ;

headKeyValue
    : 'backend' '=' qualifiedName
    | 'file' '=' fileName
    | 'filename' '=' fileName
    | 'func' '=' qualifiedName
    | 'caller' '=' qualifiedName
    | 'target' '=' qualifiedName
    | 'callee' '=' qualifiedName
    | 'depth' '=' INT
    | 'call_depth' '=' INT
    | 'arg' '=' INT
    | 'argument_index' '=' INT
    ;

headAtom
    : qualifiedName
    | INT
    ;

// ----- actions (stub) -----

actionDecl
    : 'action' ident '{' '}'
    ;

// ----- op declarations (mmio or call) -----

opDecl
    : 'op' ident '{' opBody '}'
    ;

opBody
    : callOp
    | mmioOpDecl
    ;

callOp
    : 'call' extendedName ';'
    ;

mmioOpDecl
    : 'mmio' extendedName '{' mmioField* '}'
    ;

extendedName
    : ident ('.' (ident | INT)+)*
    ;

mmioField
    : 'direction' '=' mmioDir ';'
    | 'region' '=' INT ';'
    | 'address' '=' opExpr ';'
    | 'size' '=' INT ';'
    | 'data' '=' opExpr ';'
    ;

mmioDir
    : 'r'
    | 'w'
    ;

// ----- top-level bb, path, func -----

topBbDecl
    : 'bb' extendedName '{' topBbItem+ '}'
    ;

topBbItem
    : 'op' extendedName ';'
    ;

topPathDecl
    : 'path' extendedName '{' topPathItem+ '}'
    ;

topPathItem
    : 'bb' extendedName
    ;

topFuncDecl
    : 'func' extendedName '{' topFuncItem+ '}'
    ;

topFuncItem
    : 'path' extendedName ';'
    ;

// ----- machine/state/trace models -----

machineDecl
    : importDecl* 'machine' ident '{' machineItem* '}'
    ;

machineItem
    : initialDecl
    | scratchDecl
    | machineStateDecl
    | traceDecl
    | transitionDecl
    ;

importDecl
    : 'import' STRING ';'?
    ;

initialDecl
    : 'initial' ident
    ;

scratchDecl
    : 'scratch' '{' scratchField+ '}'
    ;

scratchField
    : qualifiedName ';'
    ;

machineStateDecl
    : 'final'? 'state' ident
    ;

traceDecl
    : 'entry'? 'trace' ident '{' traceItem+ '}'
    ;

traceItem
    : traceBlock
    | traceLabelBlock
    ;

traceBlock
    : 'sequence' '{' traceInstr* '}'
    | 'repeat' '{' traceInstr* '}'
    ;

traceLabelBlock
    : labelRef ':' traceBlock
    ;

traceInstr
    : traceBlock
    | traceAssign
    | traceWrite
    | traceCall
    | traceNeqj
    | traceGoto
    | traceBug
    | traceWarn
    | ellipsisInstr
    ;

traceAssign
    : qualifiedName '=' traceExpr ';'
    ;

traceWrite
    : 'write8' '(' traceExpr ',' traceExpr ')' ';'
    | 'write16' '(' traceExpr ',' traceExpr ')' ';'
    | 'write32' '(' traceExpr ',' traceExpr ')' ';'
    | 'write64' '(' traceExpr ',' traceExpr ')' ';'
    ;

traceCall
    : 'call' qualifiedName '(' traceArgs? ')' ';'
    | 'call' qualifiedName ';'
    ;

traceArgs
    : traceExpr (',' traceExpr)*
    ;

traceNeqj
    : 'neqj' traceExpr ',' traceExpr ',' labelRef ';'
    ;

traceGoto
    : 'goto' labelRef ';'
    ;

traceBug
    : 'BUG' '(' ')' ';'
    | 'BUG_ON' '(' traceExpr ')' ';'
    ;

traceWarn
    : 'WARN_ON' '(' traceExpr ')' ';'
    ;

ellipsisInstr
    : '...' ';'?
    ;

labelRef
    : '@' ident
    ;

transitionDecl
    : 'transition' ident '->' ident 'on' ident
    ;

traceExpr
    : traceOrExpr
    ;

traceOrExpr
    : traceShiftExpr ('|' traceShiftExpr)*
    ;

traceShiftExpr
    : traceAddExpr (('<<' | '>>') traceAddExpr)*
    ;

traceAddExpr
    : tracePrimaryExpr (('+' | '-') tracePrimaryExpr)*
    ;

tracePrimaryExpr
    : INT
    | 'unknown'
    | qualifiedName
    | readExpr
    | funcCall
    | '(' traceExpr ')'
    ;

readExpr
    : 'read8' '(' traceExpr ')'
    | 'read16' '(' traceExpr ')'
    | 'read32' '(' traceExpr ')'
    | 'read64' '(' traceExpr ')'
    ;

// ----- expressions and references -----

opExpr
    : opOrExpr
    ;

opOrExpr
    : opAndExpr ('|' opAndExpr)*
    ;

opAndExpr
    : opAddExpr ('&' opAddExpr)*
    ;

opAddExpr
    : opShiftExpr ('+' opShiftExpr)*
    ;

opShiftExpr
    : opPrimaryExpr (('<<' | '>>') opPrimaryExpr)*
    ;

opPrimaryExpr
    : INT
    | 'unknown'
    | ref
    | funcCall
    | '(' opExpr ')'
    ;

funcCall
    : qualifiedName '(' funcArgs? ')'
    ;

funcArgs
    : opExpr (',' opExpr)*
    ;

qualifiedName
    : ident ('.' ident)*
    ;

fileName
    : ident ('-' ident)* ('.' ident)?
    ;

ref
    : qualifiedName
    ;

fieldRef
    : '.' ident
    ;

bitRef
    : ref '[' INT ']'
    ;

expr
    : primary (('+' | '-') primary)*
    ;

primary
    : INT
    | ref
    | '(' expr ')'
    ;

// ----- literals -----

boolLiteral
    : 'true'
    | 'false'
    ;

// ---------- lexer rules ----------

IDENT
    : [A-Za-z_][A-Za-z0-9_]*
    ;

INT
    : '0x' [0-9a-fA-F]+
    | [0-9]+
    ;

STRING
    : '"' (~["\\\r\n] | '\\' .)* '"'
    ;

WS
    : [ \t\r\n]+ -> skip
    ;

LINE_COMMENT
    : '//' ~[\r\n]* -> skip
    ;

BLOCK_COMMENT
    : '/*' .*? '*/' -> skip
    ;
