cmake_minimum_required(VERSION 3.16)
project(KallGraph LANGUAGES C CXX)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(SVF_DIR
    ""
    CACHE PATH "Path to an upstream SVF build tree containing lib/cmake/SVF/SVFConfig.cmake")

if(SVF_DIR)
    list(PREPEND CMAKE_PREFIX_PATH "${SVF_DIR}")
endif()

find_package(SVF REQUIRED CONFIG)
find_package(LLVM REQUIRED CONFIG)
list(APPEND CMAKE_MODULE_PATH "${LLVM_CMAKE_DIR}")
include(AddLLVM)

add_definitions(${LLVM_DEFINITIONS})
include_directories(SYSTEM ${LLVM_INCLUDE_DIRS})

if(DEFINED Z3_DIR)
    set(_z3_hints "${Z3_DIR}")
elseif(DEFINED ENV{Z3_DIR})
    set(_z3_hints "$ENV{Z3_DIR}")
else()
    set(_z3_hints "/usr" "/usr/local")
endif()

find_package(Z3 QUIET CONFIG)
if(Z3_FOUND)
    include_directories(${Z3_CXX_INCLUDE_DIRS})
else()
    find_library(Z3_LIBRARIES NAMES z3 libz3.a libz3.so HINTS ${_z3_hints} PATH_SUFFIXES bin lib build)
    find_path(Z3_INCLUDES NAMES z3++.h HINTS ${_z3_hints} PATH_SUFFIXES include z3 src/api/c++)
    if(NOT Z3_LIBRARIES OR NOT Z3_INCLUDES)
        message(FATAL_ERROR "Z3 not found. Set Z3_DIR to the installation prefix if needed.")
    endif()
    include_directories(${Z3_INCLUDES})
endif()

message(STATUS "Using LLVM ${LLVM_PACKAGE_VERSION} from ${LLVM_DIR}")
message(STATUS "Using upstream SVF ${SVF_VERSION} from ${SVF_DIR}")

add_subdirectory(src)
