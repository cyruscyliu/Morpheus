file(GLOB KALL_SRC
    include/*.hpp
    lib/*.cpp
)

macro(setupEnv target)
target_include_directories(${target} PUBLIC include/)
target_link_libraries(${target} PRIVATE SVF::SvfLLVM SVF::SvfCore ${Z3_LIBRARIES})
target_compile_options(${target} PRIVATE -Wno-error)
set_target_properties(${target} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
endmacro(setupEnv)

add_executable(KallGraph
    KallGraph.cpp
    ${KALL_SRC}
)
setupEnv(KallGraph)
