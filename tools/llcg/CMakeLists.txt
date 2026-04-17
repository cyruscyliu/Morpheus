cmake_minimum_required(VERSION 3.16)

project(llcg-native LANGUAGES NONE)

include(ExternalProject)

set(LLVM_DIR "/usr/lib/llvm-15/lib/cmake/llvm" CACHE PATH "Path to LLVM CMake config")
set(Z3_DIR "/usr" CACHE PATH "Path to Z3 installation prefix")
set(CLANG_VERSION "15" CACHE STRING "Clang toolchain version used to build native components")

set(CLANG_BIN "clang-${CLANG_VERSION}")
set(CLANGXX_BIN "clang++-${CLANG_VERSION}")

set(SVF_SOURCE_DIR "${CMAKE_SOURCE_DIR}/src/KallGraph/SVF-3.3")
set(KALLGRAPH_SOURCE_DIR "${CMAKE_SOURCE_DIR}/src/KallGraph")
set(LLVM_CG_SOURCE_DIR "${CMAKE_SOURCE_DIR}/src/llvm-cg")

set(SVF_BINARY_DIR "${CMAKE_BINARY_DIR}/svf")
set(KALLGRAPH_BINARY_DIR "${CMAKE_BINARY_DIR}/kallgraph")
set(LLVM_CG_BINARY_DIR "${CMAKE_BINARY_DIR}/llvm-cg")

ExternalProject_Add(
  svf
  SOURCE_DIR "${SVF_SOURCE_DIR}"
  BINARY_DIR "${SVF_BINARY_DIR}"
  CMAKE_ARGS
    -DCMAKE_C_COMPILER=${CLANG_BIN}
    -DCMAKE_CXX_COMPILER=${CLANGXX_BIN}
    -DLLVM_DIR=${LLVM_DIR}
    -DZ3_DIR=${Z3_DIR}
    -DSVF_WARN_AS_ERROR=OFF
    -DCMAKE_BUILD_TYPE=Release
  BUILD_COMMAND
    ${CMAKE_COMMAND} --build <BINARY_DIR> --parallel
    --target SvfCore SvfLLVM gen_extapi_ir
  INSTALL_COMMAND ${CMAKE_COMMAND} -E make_directory <BINARY_DIR>/include/SVF
)

ExternalProject_Add(
  kallgraph
  SOURCE_DIR "${KALLGRAPH_SOURCE_DIR}"
  BINARY_DIR "${KALLGRAPH_BINARY_DIR}"
  CMAKE_ARGS
    -DCMAKE_C_COMPILER=${CLANG_BIN}
    -DCMAKE_CXX_COMPILER=${CLANGXX_BIN}
    -DLLVM_DIR=${LLVM_DIR}
    -DSVF_DIR=${SVF_BINARY_DIR}/lib/cmake/SVF
    -DZ3_DIR=${Z3_DIR}
    -DCMAKE_BUILD_TYPE=Release
  BUILD_COMMAND ${CMAKE_COMMAND} --build <BINARY_DIR> --parallel
  INSTALL_COMMAND ""
  DEPENDS svf
)

ExternalProject_Add(
  llvm-cg
  SOURCE_DIR "${LLVM_CG_SOURCE_DIR}"
  BINARY_DIR "${LLVM_CG_BINARY_DIR}"
  CMAKE_ARGS
    -DCMAKE_C_COMPILER=${CLANG_BIN}
    -DCMAKE_CXX_COMPILER=${CLANGXX_BIN}
    -DLLVM_DIR=${LLVM_DIR}
    -DDEVILANG_BUILD_PASS=ON
    -DCMAKE_BUILD_TYPE=Release
  BUILD_COMMAND ${CMAKE_COMMAND} --build <BINARY_DIR> --parallel
  INSTALL_COMMAND ""
)

add_custom_target(build DEPENDS kallgraph llvm-cg)
