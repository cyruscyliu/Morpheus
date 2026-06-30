# Makefile for devilang parser
#
# Prerequisites:
#   sudo apt-get install antlr4 libantlr4-runtime-dev
#
# Or set ANTLR_INC and ANTLR_LIB to point to your ANTLR4 C++ runtime installation.

CXX = g++
CXXFLAGS = -std=c++17 -Wall -Wextra -O2

# ANTLR4 paths - adjust if needed
ANTLR4 ?= antlr4
ANTLR_INC ?= /usr/include/antlr4-runtime
ANTLR_LIB ?= -lantlr4-runtime

# Grammar file
GRAMMAR = devilang.g4

# Source files
MAIN_SRC = devilang.cpp
LIB_SRCS = $(wildcard libs/*.cpp)

# Object files
MAIN_OBJ = $(MAIN_SRC:.cpp=.o)
LIB_OBJS = $(LIB_SRCS:.cpp=.o)

# Target
TARGET = devilang

.PHONY: all clean test test-all install-deps generate

all: $(TARGET)

# Regenerate parser from grammar
generate:
	$(ANTLR4) -Dlanguage=Cpp -o libs $(GRAMMAR)

$(TARGET): $(MAIN_OBJ) $(LIB_OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(ANTLR_LIB)

devilang.o: devilang.cpp
	$(CXX) $(CXXFLAGS) -I$(ANTLR_INC) -c -o $@ $<

libs/%.o: libs/%.cpp
	$(CXX) $(CXXFLAGS) -I$(ANTLR_INC) -c -o $@ $<

clean:
	rm -f $(TARGET) $(MAIN_OBJ) $(LIB_OBJS)

# Install dependencies (Debian/Ubuntu)
install-deps:
	sudo apt-get update
	sudo apt-get install -y antlr4 libantlr4-runtime-dev

# Test with a sample file
test: $(TARGET)
	./$(TARGET) models/merged/ac97.devilang

# Run on all merged models
test-all: $(TARGET)
	@for f in models/merged/*.devilang; do \
		echo "===== $$f ====="; \
		./$(TARGET) "$$f" || exit 1; \
		echo ""; \
	done
