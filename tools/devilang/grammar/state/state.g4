grammar state;

machine
    : importDecl* MACHINE ID LBRACE machineItem* RBRACE EOF
    ;

machineItem
    : initialDecl
    | scratchDecl
    | stateDecl
    | traceDecl
    | transitionDecl
    ;

importDecl
    : IMPORT STRING SEMI?
    ;

initialDecl
    : INITIAL ID
    ;

scratchDecl
    : SCRATCH LBRACE scratchField+ RBRACE
    ;

scratchField
    : qualifiedName SEMI
    ;

stateDecl
    : FINAL? STATE ID
    ;

traceDecl
    : TRACE ID LBRACE traceItem+ RBRACE
    ;

traceItem
    : traceBlock
    | traceLabelBlock
    ;

traceBlock
    : SEQUENCE LBRACE traceInstr* RBRACE
    | REPEAT LBRACE traceInstr* RBRACE
    ;

traceLabelBlock
    : labelRef COLON traceBlock
    ;

traceInstr
    : traceAssign
    | traceWrite
    | traceCall
    | traceNeqj
    | traceBug
    | traceWarn
    | ellipsisInstr
    ;

traceAssign
    : qualifiedName ASSIGN traceExpr SEMI
    ;

traceWrite
    : WRITE8 LPAREN traceExpr COMMA traceExpr RPAREN SEMI
    | WRITE16 LPAREN traceExpr COMMA traceExpr RPAREN SEMI
    | WRITE32 LPAREN traceExpr COMMA traceExpr RPAREN SEMI
    | WRITE64 LPAREN traceExpr COMMA traceExpr RPAREN SEMI
    ;

traceCall
    : CALL qualifiedName LPAREN traceArgs? RPAREN SEMI
    | CALL qualifiedName SEMI
    ;

traceArgs
    : traceExpr (COMMA traceExpr)*
    ;

traceNeqj
    : NEQJ traceExpr COMMA traceExpr COMMA labelRef SEMI
    ;

traceBug
    : BUG LPAREN RPAREN SEMI
    | BUG_ON LPAREN traceExpr RPAREN SEMI
    ;

traceWarn
    : WARN_ON LPAREN traceExpr RPAREN SEMI
    ;

ellipsisInstr
    : ELLIPSIS SEMI?
    ;

traceExpr
    : traceOrExpr
    ;

traceOrExpr
    : traceShiftExpr (PIPE traceShiftExpr)*
    ;

traceShiftExpr
    : traceAddExpr ((SHL | SHR) traceAddExpr)*
    ;

traceAddExpr
    : tracePrimaryExpr ((PLUS | MINUS) tracePrimaryExpr)*
    ;

tracePrimaryExpr
    : INT
    | ID
    | readExpr
    | funcCallExpr
    | qualifiedName
    | LPAREN traceExpr RPAREN
    ;

readExpr
    : READ8 LPAREN traceExpr RPAREN
    | READ16 LPAREN traceExpr RPAREN
    | READ32 LPAREN traceExpr RPAREN
    | READ64 LPAREN traceExpr RPAREN
    ;

funcCallExpr
    : qualifiedName LPAREN traceArgs? RPAREN
    ;

qualifiedName
    : ID (DOT ID)*
    ;

labelRef
    : AT ID
    ;

transitionDecl
    : TRANSITION ID ARROW ID ON ID
    ;

MACHINE
    : 'machine'
    ;

INITIAL
    : 'initial'
    ;

FINAL
    : 'final'
    ;

STATE
    : 'state'
    ;

SCRATCH
    : 'scratch'
    ;

TRACE
    : 'trace'
    ;

IMPORT
    : 'import'
    ;

STEP
    : 'step'
    ;

SEQUENCE
    : 'sequence'
    ;

REPEAT
    : 'repeat'
    ;

TRANSITION
    : 'transition'
    ;

ON
    : 'on'
    ;

CALL
    : 'call'
    ;

BUG
    : 'BUG'
    ;

BUG_ON
    : 'BUG_ON'
    ;

WARN_ON
    : 'WARN_ON'
    ;

READ8
    : 'read8'
    ;

READ16
    : 'read16'
    ;

READ32
    : 'read32'
    ;

READ64
    : 'read64'
    ;

WRITE8
    : 'write8'
    ;

WRITE16
    : 'write16'
    ;

WRITE32
    : 'write32'
    ;

WRITE64
    : 'write64'
    ;

NEQJ
    : 'neqj'
    ;

ELLIPSIS
    : '...'
    ;

ARROW
    : '->'
    ;

LBRACE
    : '{'
    ;

RBRACE
    : '}'
    ;

SEMI
    : ';'
    ;

COLON
    : ':'
    ;

COMMA
    : ','
    ;

ASSIGN
    : '='
    ;

LPAREN
    : '('
    ;

RPAREN
    : ')'
    ;

AT
    : '@'
    ;

DOT
    : '.'
    ;

PLUS
    : '+'
    ;

MINUS
    : '-'
    ;

PIPE
    : '|'
    ;

SHL
    : '<<'
    ;

SHR
    : '>>'
    ;

ID
    : [a-zA-Z_][a-zA-Z0-9_]*
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
