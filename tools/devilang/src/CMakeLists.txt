set(DEVILANG_LIB_SRCS
    lib/DevilangModelPass.cpp
    lib/DevilangPhaseBuilder.cpp
    include/DevilangModelPass.h
    include/DevilangPhaseBuilder.h
)

add_library(devilang-model-pass MODULE ${DEVILANG_LIB_SRCS})
add_library(devilang-model-core STATIC ${DEVILANG_LIB_SRCS})
add_library(devilang-svf-analysis STATIC
    lib/DevilangSvfAnalysis.cpp
    include/DevilangSvfAnalysis.h
)
add_executable(devilang cli/devilang.cpp)

target_include_directories(devilang-model-pass PUBLIC include)
target_include_directories(devilang-model-core PUBLIC include)
target_include_directories(devilang-svf-analysis PUBLIC include)
target_include_directories(devilang PRIVATE include)

target_compile_options(devilang-model-pass PRIVATE -g -fno-rtti)
target_compile_options(devilang-model-core PRIVATE -g -fno-rtti)
target_compile_definitions(devilang-svf-analysis PRIVATE DEVILANG_HAVE_SVF=0)

set_target_properties(devilang-model-pass PROPERTIES PREFIX "" OUTPUT_NAME "devilang-pass")
set_target_properties(devilang-model-core PROPERTIES POSITION_INDEPENDENT_CODE ON)
set_target_properties(devilang-svf-analysis PROPERTIES POSITION_INDEPENDENT_CODE ON)
set_target_properties(devilang PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set_target_properties(devilang-model-pass PROPERTIES LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

llvm_map_components_to_libnames(DEVILANG_LLVM_LIBS
    Core
    IRReader
    Passes
    Support
)

target_link_libraries(devilang-model-pass PRIVATE ${DEVILANG_LLVM_LIBS})
target_link_libraries(devilang-model-core PRIVATE ${DEVILANG_LLVM_LIBS})
target_link_libraries(devilang-svf-analysis PRIVATE ${DEVILANG_LLVM_LIBS})
target_link_libraries(devilang PRIVATE devilang-model-core devilang-svf-analysis ${DEVILANG_LLVM_LIBS})

if(TARGET SVF::SvfLLVM AND TARGET SVF::SvfCore)
  set_property(TARGET devilang-svf-analysis PROPERTY COMPILE_DEFINITIONS DEVILANG_HAVE_SVF=1)
  target_compile_options(devilang-svf-analysis PRIVATE -Wno-error)
  target_link_libraries(devilang-svf-analysis PRIVATE SVF::SvfLLVM)

  target_compile_definitions(devilang PRIVATE DEVILANG_HAVE_SVF=1)

  add_executable(devilang-svf-points cli/devilang-svf-points.cpp)
  target_include_directories(devilang-svf-points PRIVATE include)
  target_compile_definitions(devilang-svf-points PRIVATE DEVILANG_HAVE_SVF=1)
  target_link_libraries(devilang-svf-points PRIVATE devilang-svf-analysis)
  target_compile_options(devilang-svf-points PRIVATE -Wno-error)
  set_target_properties(devilang-svf-points PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
endif()
