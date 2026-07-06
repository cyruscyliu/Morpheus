set(DEVILANG_LIB_SRCS
    lib/DevilangModelPass.cpp
    include/DevilangModelPass.h
)

add_library(devilang-model-pass MODULE ${DEVILANG_LIB_SRCS})
add_library(devilang-model-core STATIC ${DEVILANG_LIB_SRCS})
add_executable(devilang cli/devilang.cpp)

target_include_directories(devilang-model-pass PUBLIC include)
target_include_directories(devilang-model-core PUBLIC include)
target_include_directories(devilang PRIVATE include)

target_compile_options(devilang-model-pass PRIVATE -g -fno-rtti)
target_compile_options(devilang-model-core PRIVATE -g -fno-rtti)

set_target_properties(devilang-model-pass PROPERTIES PREFIX "" OUTPUT_NAME "devilang-pass")
set_target_properties(devilang-model-core PROPERTIES POSITION_INDEPENDENT_CODE ON)
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
target_link_libraries(devilang PRIVATE devilang-model-core ${DEVILANG_LLVM_LIBS})
