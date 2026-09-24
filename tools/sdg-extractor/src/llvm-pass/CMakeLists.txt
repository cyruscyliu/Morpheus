cmake_minimum_required(VERSION 3.16)
project(SDGExtractPass)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

find_package(LLVM REQUIRED CONFIG)

message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "Using LLVMConfig.cmake in: ${LLVM_DIR}")

include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST UNIX_COMMAND "${LLVM_DEFINITIONS}")
add_definitions(${LLVM_DEFINITIONS_LIST})

add_library(SDGExtractPass SHARED SDGExtractPass.cpp)

# LLVM plugin should not have undefined symbols at load time.
set_target_properties(SDGExtractPass PROPERTIES
    PREFIX ""
    COMPILE_FLAGS "-fno-rtti"
)

if(APPLE)
  set_target_properties(SDGExtractPass PROPERTIES
      LINK_FLAGS "-undefined dynamic_lookup"
  )
endif()
