#include <iostream>
#include <fstream>
#include <string>

#include "antlr4-runtime.h"
#include "libs/devilangLexer.h"
#include "libs/devilangParser.h"
#include "libs/devilangBaseListener.h"

using namespace antlr4;

class ASTTraverser : public devilangBaseListener {
private:
    int indent = 0;

    std::string getIndent() const {
        return std::string(indent * 2, ' ');
    }

public:
    void enterProgram(devilangParser::ProgramContext *ctx) override {
        std::cout << getIndent() << "Program (" << ctx->decl().size() << " declarations)" << std::endl;
        indent++;
    }

    void exitProgram(devilangParser::ProgramContext *ctx) override {
        indent--;
    }

    void enterStructDecl(devilangParser::StructDeclContext *ctx) override {
        std::cout << getIndent() << "Struct: " << ctx->ident()->getText()
                  << " (" << ctx->field().size() << " fields)" << std::endl;
        indent++;
    }

    void exitStructDecl(devilangParser::StructDeclContext *ctx) override {
        indent--;
    }

    void enterField(devilangParser::FieldContext *ctx) override {
        std::string fieldName = ctx->ident()->getText();
        std::string typeName = ctx->type_()->getText();

        std::cout << getIndent() << "Field: " << fieldName << " : " << typeName;

        // Print modifiers
        if (!ctx->modifier().empty()) {
            std::cout << " [";
            for (size_t i = 0; i < ctx->modifier().size(); i++) {
                if (i > 0) std::cout << ", ";
                std::cout << ctx->modifier(i)->getText();
            }
            std::cout << "]";
        }

        // Print bit block info
        if (ctx->bitBlock()) {
            std::cout << " (bits: " << ctx->bitBlock()->bitEntry().size() << " entries)";
        }

        // Print imm block info
        if (ctx->immBlock()) {
            std::cout << " (imm: " << ctx->immBlock()->immEntry().size() << " entries)";
        }

        std::cout << std::endl;
    }

    void enterPointerDecl(devilangParser::PointerDeclContext *ctx) override {
        std::cout << getIndent() << "Pointer declaration" << std::endl;
        indent++;
    }

    void exitPointerDecl(devilangParser::PointerDeclContext *ctx) override {
        indent--;
    }

    void enterPointerField(devilangParser::PointerFieldContext *ctx) override {
        std::string text = ctx->getText();
        // Extract key from the field
        if (ctx->ref()) {
            std::cout << getIndent() << "from = " << ctx->ref()->getText() << std::endl;
        } else if (ctx->typeList()) {
            std::cout << getIndent() << "to = " << ctx->typeList()->getText() << std::endl;
        } else if (ctx->INT()) {
            // Could be align or count
            std::cout << getIndent() << "value = " << ctx->INT()->getText() << std::endl;
        } else if (ctx->bitRefList()) {
            std::cout << getIndent() << "sentinel = " << ctx->bitRefList()->getText() << std::endl;
        }
    }

    void enterHeadDecl(devilangParser::HeadDeclContext *ctx) override {
        std::cout << getIndent() << "Head declaration";
        if (ctx->headName()) {
            std::cout << ": " << ctx->headName()->getText();
        }
        std::cout << std::endl;
        indent++;
    }

    void exitHeadDecl(devilangParser::HeadDeclContext *ctx) override {
        indent--;
    }

    void enterHeadField(devilangParser::HeadFieldContext *ctx) override {
        if (ctx->spaceTypeList()) {
            std::cout << getIndent() << "to = ";
            for (auto id : ctx->spaceTypeList()->ident()) {
                std::cout << id->getText() << " ";
            }
            std::cout << std::endl;
        } else if (ctx->headPosition()) {
            std::cout << getIndent() << "position ("
                      << ctx->headPosition()->headLocation().size()
                      << " locations)" << std::endl;
        } else if (ctx->INT()) {
            std::cout << getIndent() << "align = " << ctx->INT()->getText() << std::endl;
        }
    }

    void enterHeadLocation(devilangParser::HeadLocationContext *ctx) override {
        indent++;
        std::cout << getIndent() << "Location:" << std::endl;
        indent++;
    }

    void exitHeadLocation(devilangParser::HeadLocationContext *ctx) override {
        indent -= 2;
    }

    void enterHeadKeyValue(devilangParser::HeadKeyValueContext *ctx) override {
        std::string text = ctx->getText();
        // Parse out key=value
        size_t eqPos = text.find('=');
        if (eqPos != std::string::npos) {
            std::cout << getIndent() << text.substr(0, eqPos) << " = "
                      << text.substr(eqPos + 1) << std::endl;
        }
    }

    void enterActionDecl(devilangParser::ActionDeclContext *ctx) override {
        std::cout << getIndent() << "Action: " << ctx->ident()->getText() << std::endl;
    }
};

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: " << argv[0] << " <source-file>" << std::endl;
        std::cerr << "Example: " << argv[0] << " models/merged/ac97.devilang" << std::endl;
        return 1;
    }

    std::string filename = argv[1];
    std::ifstream stream(filename);

    if (!stream.is_open()) {
        std::cerr << "Error: Could not open file '" << filename << "'" << std::endl;
        return 1;
    }

    std::cout << "Parsing: " << filename << std::endl;
    std::cout << std::string(60, '=') << std::endl;

    ANTLRInputStream input(stream);
    devilangLexer lexer(&input);
    CommonTokenStream tokens(&lexer);
    devilangParser parser(&tokens);

    // Parse the input
    devilangParser::ProgramContext* tree = parser.program();

    // Check for syntax errors
    if (parser.getNumberOfSyntaxErrors() > 0) {
        std::cerr << "Error: " << parser.getNumberOfSyntaxErrors()
                  << " syntax error(s) found" << std::endl;
        return 1;
    }

    std::cout << "Parse successful!" << std::endl;
    std::cout << std::string(60, '-') << std::endl;
    std::cout << "AST Structure:" << std::endl;
    std::cout << std::string(60, '-') << std::endl;

    // Traverse the AST using the listener
    ASTTraverser traverser;
    tree::ParseTreeWalker walker;
    walker.walk(&traverser, tree);

    std::cout << std::string(60, '=') << std::endl;
    std::cout << "Done." << std::endl;

    return 0;
}
