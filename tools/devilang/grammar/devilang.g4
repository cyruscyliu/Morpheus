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
    | stateDecl
    ;

// ----- structs -----

structDecl
    : 'struct' ident '{' field* '}'
    ;

field
    : ident ':' type_ modifier* bitBlock? immBlock? ';'
    ;

// ident allows keywords to be used as identifiers in certain contexts
ident
    : IDENT
    | 'count' | 'size' | 'head' | 'tail' | 'next' | 'prev' | 'base'
    | 'align' | 'from' | 'to' | 'sentinel' | 'position' | 'link'
    | 'status' | 'command' | 'control' | 'flags' | 'data' | 'addr'
    | 'buf' | 'buffer' | 'tag' | 'id' | 'sig' | 'ctrl' | 'token' | 'inst'
    | 'arg' | 'call' | 'op' | 'bb' | 'path' | 'func' | 'mmio' | 'direction' | 'region' | 'address'
    | 'unknown' | 'phi' | 'select' | 'num' | 'var'
    | 'flag' | 'random' | 'immediate'
    | 'state' | 'seq' | 'repeat' | 'value'
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

//   [ bits 0..6; ]
//   [ bits 0..6 = 0; 1..2; ]
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

//   [ imm 0; imm 1; ]
//   [ range 0..6; ]
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

// bitRefList allows multiple bit references: ref[n] | ref[m]
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
    : ident ( '|' ident )*
    ;

spaceTypeList
    : ident+
    ;

listBody
    : 'head' '=' ref ';'
      'tail' '=' ref ';'
      'next' '=' fieldRefOrList ';'
      ( 'sentinel' '=' bitRefList ';' )?
      ( 'align' '=' INT ';' )?
    ;

dlistBody
    : 'head' '=' ref ';'
      'tail' '=' ref ';'
      'next' '=' fieldRefOrList ';'
      'prev' '=' fieldRefOrList ';'
      ( 'sentinel' '=' bitRefList ';' )?
      ( 'align' '=' INT ';' )?
    ;

ringBody
    : 'head' '=' ref ';'
      'next' '=' fieldRefOrList ';'
      ( 'align' '=' INT ';' )?
    ;

// fieldRefOrList allows: .field, field, or field | field (for polymorphic lists)
fieldRefOrList
    : fieldRef ('|' fieldRef)*
    | ident ('|' ident)*
    ;

ringbufBody
    : 'base' '=' expr ';'
      (
          'size'  '=' INT ';'
        | 'count' '=' ref ';'
      )
      'head' '=' ref ';'
      'tail' '=' ref ';'
      ( 'align' '=' INT ';' )?
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
    | 'align'    '=' INT           ';'
    ;

// position = loc ('|' loc)* ;
headPosition
    : headLocation ('|' headLocation)*
    ;

//   [filename = ac97.c; caller = fetch_bd; callee = pci_dma_read; call_depth = 0; argument_index = 1;]
//   [qemu, ac97.c, fetch_bd, pci_dma_read, 0, 1]
headLocation
    : '[' (
            headKeyValue (';' headKeyValue)* ';'?
          | headAtom     (',' headAtom    )*
          ) ']'
    ;

headKeyValue
    : 'backend'        '=' qualifiedName
    | 'file'           '=' fileName
    | 'filename'       '=' fileName
    | 'func'           '=' qualifiedName
    | 'caller'         '=' qualifiedName
    | 'target'         '=' qualifiedName
    | 'callee'         '=' qualifiedName
    | 'depth'          '=' INT
    | 'call_depth'     '=' INT
    | 'arg'            '=' INT
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

// extendedName allows dots followed by numbers/idents (e.g., readl.157_341, netif_running.156)
// After a dot, allow sequences like "157_341" which lexes as INT IDENT
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

// ----- state models -----

stateDecl
    : 'state' extendedName '{' stateStmt+ '}'
    ;

stateStmt
    : stateBlock
    | stateStep
    ;

stateBlock
    : 'seq' '{' stateStmt* '}'
    | 'repeat' '{' stateStmt* '}'
    ;

stateStep
    : ioStateStep stateTerminator?
    | callStateStep stateTerminator?
    | ellipsisStateStep stateTerminator?
    ;

stateTerminator
    : ';'
    ;

ioStateStep
    : ioVerb opExpr ioValue?
    ;

ioVerb
    : 'read8'
    | 'read16'
    | 'read32'
    | 'read64'
    | 'write8'
    | 'write16'
    | 'write32'
    | 'write64'
    ;

ioValue
    : 'value' opExpr
    ;

callStateStep
    : 'call' extendedName ('(' funcArgs? ')')?
    ;

ellipsisStateStep
    : '...'
    ;

// ----- op expressions (support function calls and bitwise ops) -----
// Precedence (lowest to highest): | & + << >> primary

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

// ----- references & expressions -----

qualifiedName
    : ident ('.' ident)*
    ;

// filename allows hyphens: e.g., hcd-dwc2.c, DevIchAc97.cpp
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

WS
    : [ \t\r\n]+ -> skip
    ;

LINE_COMMENT
    : '//' ~[\r\n]* -> skip
    ;

BLOCK_COMMENT
    : '/*' .*? '*/' -> skip
    ;
