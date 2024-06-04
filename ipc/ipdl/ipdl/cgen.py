# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys

from ipdl.ast import Visitor


class CodePrinter:
    def __init__(self, outf=sys.stdout, indentCols=4):
        self.outf = outf
        self.col = 0
        self.indentCols = indentCols

    def write(self, str):
        self.outf.write(str)

    def printdent(self, str=""):
        self.write((" " * self.col) + str)

    def println(self, str=""):
        self.write(str + "\n")

    def printdentln(self, str):
        self.write((" " * self.col) + str + "\n")

    def indent(self):
        self.col += self.indentCols

    def dedent(self):
        self.col -= self.indentCols


# -----------------------------------------------------------------------------
class IPDLCodeGen(CodePrinter, Visitor):
    """Spits back out equivalent IPDL to the code that generated this.
    Also known as pretty-printing."""

    def __init__(self, outf=sys.stdout, indentCols=4, printed=set()):
        CodePrinter.__init__(self, outf, indentCols)
        self.printed = printed

    def visitTranslationUnit(self, tu):
        self.printed.add(tu.filename)
        self.println("//\n// Automatically generated by ipdlc\n//")
        Visitor.visitTranslationUnit(self, tu)  # NOQA: F821

    def visitCxxInclude(self, inc):
        self.println('include "' + inc.file + '";')

    def visitProtocolInclude(self, inc):
        self.println('include protocol "' + inc.file + '";')
        if inc.tu.filename not in self.printed:
            self.println("/* Included file:")
            IPDLCodeGen(
                outf=self.outf, indentCols=self.indentCols, printed=self.printed
            ).visitTranslationUnit(inc.tu)

            self.println("*/")

    def visitProtocol(self, p):
        self.println()
        for namespace in p.namespaces:
            namespace.accept(self)

        self.println("%s protocol %s\n{" % (p.sendSemantics, p.name))
        self.indent()

        for mgs in p.managesStmts:
            mgs.accept(self)
        if len(p.managesStmts):
            self.println()

        for msgDecl in p.messageDecls:
            msgDecl.accept(self)
        self.println()

        self.dedent()
        self.println("}")
        self.write("}\n" * len(p.namespaces))

    def visitManagerStmt(self, mgr):
        self.printdentln("manager " + mgr.name + ";")

    def visitManagesStmt(self, mgs):
        self.printdentln("manages " + mgs.name + ";")

    def visitMessageDecl(self, msg):
        self.printdent("%s %s %s(" % (msg.sendSemantics, msg.direction, msg.name))
        for i, inp in enumerate(msg.inParams):
            inp.accept(self)
            if i != (len(msg.inParams) - 1):
                self.write(", ")
        self.write(")")
        if 0 == len(msg.outParams):
            self.println(";")
            return

        self.println()
        self.indent()
        self.printdent("returns (")
        for i, outp in enumerate(msg.outParams):
            outp.accept(self)
            if i != (len(msg.outParams) - 1):
                self.write(", ")
        self.println(");")
        self.dedent()
