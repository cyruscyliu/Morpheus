cmake_minimum_required(VERSION 3.16)
project(sdg-extractor)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# SVF is mandatory. Provide it via -DSVF_DIR=<path/to/svf/install/lib/cmake/SVF>
if(NOT DEFINED SVF_DIR)
  set(SVF_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/SVF/install/lib/cmake/SVF"
      CACHE PATH "Directory containing SVFConfig.cmake")
endif()
if(NOT EXISTS ${SVF_DIR}/SVFConfig.cmake)
  message(FATAL_ERROR "SVF not found at ${SVF_DIR}. "
          "Build and install SVF 3.3 with LLVM 15 and pass -DSVF_DIR=...")
endif()

add_subdirectory(src/svf-core)
add_subdirectory(src/llvm-pass)
