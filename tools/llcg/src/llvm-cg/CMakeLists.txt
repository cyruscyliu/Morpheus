cmake_minimum_required(VERSION 3.16)

project(Devilang LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(LLVM REQUIRED CONFIG)
list(APPEND CMAKE_MODULE_PATH "${LLVM_CMAKE_DIR}")
include(AddLLVM)

add_definitions(${LLVM_DEFINITIONS})
include_directories(SYSTEM ${LLVM_INCLUDE_DIRS})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

option(DEVILANG_BUILD_PASS "Build the legacy Devilang pass targets" OFF)

if(DEVILANG_BUILD_PASS)
    set(DEVILANG_LIB_SRCS
        src/DevilangCG.cpp
        include/DevilangCG.h
        include/IO.h
    )

    add_library(Devilang MODULE ${DEVILANG_LIB_SRCS})
    add_library(DevilangStatic STATIC ${DEVILANG_LIB_SRCS})

    target_compile_options(Devilang PRIVATE -g -fno-rtti)
    target_compile_options(DevilangStatic PRIVATE -g -fno-rtti)
    set_target_properties(DevilangStatic PROPERTIES POSITION_INDEPENDENT_CODE ON)

    foreach(extra_include
        "${CMAKE_CURRENT_SOURCE_DIR}/../Utils/include"
        "${CMAKE_CURRENT_SOURCE_DIR}/../Customizations/include"
        "${CMAKE_CURRENT_SOURCE_DIR}/../LinuxKernelCustomizations/include"
        "${CMAKE_CURRENT_SOURCE_DIR}/../RangeAnalysis/include"
        "${CMAKE_CURRENT_SOURCE_DIR}/../z3/include"
    )
        if(EXISTS "${extra_include}")
            target_include_directories(Devilang PRIVATE "${extra_include}")
            target_include_directories(DevilangStatic PRIVATE "${extra_include}")
        endif()
    endforeach()

    foreach(optional_pkg spdlog yaml-cpp)
        find_package(${optional_pkg} QUIET)
    endforeach()

    if(TARGET spdlog::spdlog)
        target_link_libraries(Devilang PRIVATE spdlog::spdlog)
        target_link_libraries(DevilangStatic PRIVATE spdlog::spdlog)
    endif()
    if(TARGET yaml-cpp::yaml-cpp)
        target_link_libraries(Devilang PRIVATE yaml-cpp::yaml-cpp)
        target_link_libraries(DevilangStatic PRIVATE yaml-cpp::yaml-cpp)
    endif()

    foreach(optional_target Utils Customizations LinuxKernelCustomizations RangeAnalysis)
        if(TARGET ${optional_target})
            target_link_libraries(Devilang PRIVATE ${optional_target})
            target_link_libraries(DevilangStatic PRIVATE ${optional_target})
        else()
            message(WARNING "Optional target ${optional_target} is not available; pass linking may fail if it is required.")
        endif()
    endforeach()
endif()
