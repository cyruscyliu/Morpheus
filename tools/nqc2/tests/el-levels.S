/* Known instruction ranges for EL3, EL2, EL1h, EL1t and EL0. */
.global _start
.text
_start:
    mov x0, #0x501
    msr scr_el3, x0
    mov x0, #0x3c9
    msr spsr_el3, x0
    adr x0, el2
    msr elr_el3, x0
    eret
.balign 256
el2:
    mov x0, #0x80000000
    msr hcr_el2, x0
    mov x0, #0x3c5
    msr spsr_el2, x0
    adr x0, el1h
    msr elr_el2, x0
    eret
.balign 256
el1h:
    mov x0, #0x3c4
    msr spsr_el1, x0
    adr x0, el1t
    msr elr_el1, x0
    eret
.balign 256
el1t:
    mov x0, #0x3c0
    msr spsr_el1, x0
    adr x0, el0
    msr elr_el1, x0
    eret
.balign 256
el0:
    mov x0, #0x20
    adr x1, exit_block
    hlt #0xf000
    b .
.balign 8
exit_block:
    .quad 0x20026
    .quad 0
