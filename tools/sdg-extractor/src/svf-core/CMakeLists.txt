cmake_minimum_required(VERSION 3.16)

# SdgSvfCore: semantic value-flow / taint infrastructure on top of SVF.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# SVF can be supplied via -DSVF_DIR=<path/to/svf/build/lib/cmake/SVF>
if(NOT DEFINED SVF_DIR)
  set(SVF_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/SVF/install/lib/cmake/SVF"
      CACHE PATH "Directory containing SVFConfig.cmake")
endif()
find_package(SVF REQUIRED PATHS ${SVF_DIR} NO_DEFAULT_PATH)
message(STATUS "Found SVF at ${SVF_DIR}")

find_package(LLVM REQUIRED CONFIG)
message(STATUS "SdgSvfCore using LLVM ${LLVM_PACKAGE_VERSION}")
include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST UNIX_COMMAND "${LLVM_DEFINITIONS}")
add_definitions(${LLVM_DEFINITIONS_LIST})

set(SDGSVCORE_HEADERS
  include/sdg/core/ControlDependencyAnalysis.h
  include/sdg/core/Predicate.h
  include/sdg/core/Role.h
  include/sdg/core/Rule.h
  include/sdg/core/RuleAssembler.h
  include/sdg/core/SemanticSink.h
  include/sdg/core/SemanticSource.h
  include/sdg/core/SemanticValueFlowGraph.h
  include/sdg/core/SinkCatalog.h
  include/sdg/core/SourceCatalog.h
  include/sdg/core/RoleTaintAnalysis.h
)

set(SDGSVCORE_SOURCES
  lib/ControlDependencyAnalysis.cpp
  lib/Role.cpp
  lib/RuleAssembler.cpp
  lib/SemanticValueFlowGraph.cpp
  lib/SinkCatalog.cpp
  lib/SourceCatalog.cpp
  lib/RoleTaintAnalysis.cpp
)

add_library(SdgSvfCore STATIC ${SDGSVCORE_SOURCES} ${SDGSVCORE_HEADERS})

target_include_directories(SdgSvfCore PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(SdgSvfCore PUBLIC
  SVF::SvfCore
  SVF::SvfLLVM
  SVF::SvfFlags
  ${LLVM_LIBRARIES}
)

# Smoke-test tool.
add_executable(svf_smoke_test tools/svf_smoke_test.cpp)
target_link_libraries(svf_smoke_test PRIVATE SdgSvfCore)

# The out-of-tree pass links against this library.
