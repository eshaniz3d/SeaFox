// |jit-test| exitstatus: 3

oomAfterAllocations(50, 2);
eval("(function() {'use asm'; function f() { return +pow(.0, .0) })")
