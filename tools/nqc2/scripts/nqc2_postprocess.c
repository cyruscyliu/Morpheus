#define _GNU_SOURCE
#include <errno.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <search.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>
#include <gelf.h>
#include <libelf.h>
#include <elfutils/libdw.h>
#include <elfutils/libdwfl.h>

typedef struct {
    unsigned int vcpu;
    uint64_t start;
    uint64_t end;
} TraceRecord;

typedef struct {
    TraceRecord *items;
    size_t len;
    size_t cap;
} TraceVec;

typedef struct {
    uint64_t start;
    uint64_t size;
    char *name;
} Symbol;

typedef struct {
    Symbol *items;
    size_t len;
    size_t cap;
} SymbolVec;

typedef struct {
    uint64_t addr;
    char *func;
    char *file;
    unsigned int line;
} SourceLoc;

typedef struct {
    uint64_t addr;
    uint32_t line;
    uint32_t func_len;
    uint32_t file_len;
} SourceDiskRecord;

typedef struct {
    uint64_t addr;
    uint64_t count;
    uint32_t path_len;
    uint32_t line;
} FileLineDiskRecord;

typedef struct {
    uint64_t start;
    uint64_t end;
    uint32_t file_idx;
    uint32_t line;
    uint64_t count;
} AddrMapDiskRecord;

typedef struct {
    uint64_t start;
    uint64_t end;
    uint32_t file_idx;
    uint32_t line;
    uint64_t count;
    uint32_t name_len;
} FunctionRangeDiskRecord;

typedef struct {
    uint64_t offset;
    uint32_t unit_id;
    uint32_t len;
} TracePacketInfo;

typedef struct {
    SourceLoc *items;
    size_t len;
    size_t cap;
} SourceVec;

typedef struct {
    uint64_t addr;
    uint64_t count;
} CoverageEntry;

typedef struct {
    CoverageEntry *items;
    size_t len;
    size_t cap;
} CoverageVec;

typedef struct {
    char *path;
    unsigned int line;
    uint64_t count;
} FileLineCount;

typedef struct {
    FileLineCount *items;
    size_t len;
    size_t cap;
} FileLineVec;

typedef struct {
    char *path;
    unsigned int *lines;
    uint64_t *counts;
    size_t len;
    size_t cap;
    void *line_root;
} FileCoverage;

typedef struct {
    FileCoverage *items;
    size_t len;
    size_t cap;
} FileCoverageVec;

typedef struct {
    char *name;
    unsigned int line;
    uint64_t count;
} FunctionCoverage;

typedef struct {
    FunctionCoverage *items;
    size_t len;
    size_t cap;
} FunctionCoverageVec;

typedef struct {
    uint64_t start;
    uint64_t end;
    uint32_t file_idx;
    unsigned int line;
    uint64_t count;
    char *name;
} FunctionRange;

typedef struct {
    FunctionRange *items;
    size_t len;
    size_t cap;
} FunctionRangeVec;

typedef struct {
    const FileCoverageVec *files;
    FunctionRangeVec *ranges;
    const char *elf_dir;
} FunctionBuildContext;

typedef struct {
    uint64_t start;
    uint64_t end;
    uint32_t file_idx;
    uint32_t line;
    uint64_t count;
} AddrMapEntry;

typedef struct {
    AddrMapEntry *items;
    size_t len;
    size_t cap;
} AddrMapVec;

typedef struct {
    bool valid;
    uint64_t start;
    uint64_t end;
} PendingRange;

typedef struct {
    char *path;
    size_t index;
} PathIndex;

typedef struct {
    char *key;
    size_t index;
} TokenIndex;

typedef struct {
    unsigned int line;
    size_t index;
} LineIndex;

#define NQC2_MEM_LIMIT_KB (8ULL * 1024ULL * 1024ULL)
#define NQC2_MEM_CHECK_INTERVAL 100000000U
#define NQC2_COVERAGE_COMPACT_THRESHOLD 1000000U

static void log_progress(const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    fputs("nqc2: ", stderr);
    vfprintf(stderr, fmt, args);
    fputc('\n', stderr);
    fflush(stderr);
    va_end(args);
}

static size_t clamp_jobs(size_t jobs);
static int coverage_cmp(const void *lhs, const void *rhs);
static char *read_file(const char *path, size_t *out_len);
static unsigned int derive_function_end_line(const char *source_text,
                                             unsigned int start_line,
                                             unsigned int end_hint);

static uint64_t current_rss_kb(void)
{
    FILE *fp = fopen("/proc/self/status", "r");
    char line[256];
    uint64_t rss_kb = 0;

    if (!fp) {
        return 0;
    }
    while (fgets(line, sizeof(line), fp)) {
        if (sscanf(line, "VmRSS: %" SCNu64 " kB", &rss_kb) == 1) {
            fclose(fp);
            return rss_kb;
        }
    }
    fclose(fp);
    return 0;
}

static void enforce_memory_limit(const char *phase, size_t progress)
{
    uint64_t rss_kb = current_rss_kb();
    if (rss_kb > NQC2_MEM_LIMIT_KB) {
        fprintf(stderr,
                "nqc2: memory cap exceeded in %s at progress=%zu rss_kb=%" PRIu64 " limit_kb=%" PRIu64 "\n",
                phase,
                progress,
                rss_kb,
                (uint64_t) NQC2_MEM_LIMIT_KB);
        exit(1);
    }
}

struct etrace_hdr {
    uint16_t type;
    uint16_t unit_id;
    uint32_t len;
} __attribute__((packed));

struct etrace_entry64 {
    uint32_t duration;
    uint64_t start;
    uint64_t end;
} __attribute__((packed));

static void *xrealloc(void *ptr, size_t size)
{
    void *next = realloc(ptr, size);
    if (!next) {
        perror("realloc");
        exit(1);
    }
    return next;
}

static void *xcalloc(size_t n, size_t size)
{
    void *ptr = calloc(n, size);
    if (!ptr) {
        perror("calloc");
        exit(1);
    }
    return ptr;
}

static char *xstrdup(const char *value)
{
    char *copy = strdup(value ? value : "");
    if (!copy) {
        perror("strdup");
        exit(1);
    }
    return copy;
}

static void trace_vec_push(TraceVec *vec, TraceRecord item)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len++] = item;
}

static void trace_vec_free(TraceVec *vec)
{
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void write_trace_chunk(FILE *fp, const TraceVec *vec)
{
    uint64_t count = (uint64_t) vec->len;
    if (fwrite(&count, sizeof(count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    if (count > 0 && fwrite(vec->items, sizeof(*vec->items), vec->len, fp) != vec->len) {
        perror("fwrite");
        exit(1);
    }
}

static int read_trace_chunk(FILE *fp, TraceVec *vec)
{
    uint64_t count = 0;
    if (fread(&count, sizeof(count), 1, fp) != 1) {
        if (feof(fp)) {
            return 0;
        }
        perror("fread");
        exit(1);
    }
    if (count > 0) {
        size_t i;
        TraceVec local = {0};
        local.items = xcalloc((size_t) count, sizeof(*local.items));
        local.len = (size_t) count;
        local.cap = (size_t) count;
        if (fread(local.items, sizeof(*local.items), (size_t) count, fp) != (size_t) count) {
            perror("fread");
            exit(1);
        }
        for (i = 0; i < local.len; i++) {
            trace_vec_push(vec, local.items[i]);
        }
        free(local.items);
    }
    return 1;
}

static void coverage_vec_push(CoverageVec *vec, uint64_t addr, uint64_t count)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len].addr = addr;
    vec->items[vec->len].count = count;
    vec->len += 1;
}

static void coverage_vec_reserve(CoverageVec *vec, size_t cap)
{
    if (cap > vec->cap) {
        vec->cap = cap;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
}

static void coverage_vec_free(CoverageVec *vec)
{
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void coverage_vec_sort_compact(CoverageVec *vec)
{
    size_t i;
    size_t dst = 0;

    if (vec->len == 0) {
        return;
    }
    qsort(vec->items, vec->len, sizeof(*vec->items), coverage_cmp);
    for (i = 0; i < vec->len; i++) {
        if (dst > 0 && vec->items[dst - 1].addr == vec->items[i].addr) {
            vec->items[dst - 1].count += vec->items[i].count;
        } else {
            vec->items[dst++] = vec->items[i];
        }
    }
    vec->len = dst;
}

static void file_line_vec_push(FileLineVec *vec, const char *path, unsigned int line, uint64_t count)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len].path = xstrdup(path);
    vec->items[vec->len].line = line;
    vec->items[vec->len].count = count;
    vec->len += 1;
}

static void file_line_vec_free(FileLineVec *vec)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        free(vec->items[i].path);
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void file_coverage_push(FileCoverageVec *vec, FileCoverage item)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 256;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len++] = item;
}

static void file_coverage_free(FileCoverageVec *vec)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        free(vec->items[i].path);
        free(vec->items[i].lines);
        free(vec->items[i].counts);
        if (vec->items[i].line_root) {
            tdestroy(vec->items[i].line_root, free);
        }
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void function_coverage_vec_free(FunctionCoverageVec *vec)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        free(vec->items[i].name);
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void function_range_vec_push(FunctionRangeVec *vec, FunctionRange item)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 256;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len++] = item;
}

static void function_range_vec_free(FunctionRangeVec *vec)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        free(vec->items[i].name);
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void function_coverage_add(FunctionCoverageVec *vec,
                                  const char *name,
                                  unsigned int line,
                                  uint64_t count)
{
    size_t i;

    for (i = 0; i < vec->len; i++) {
        if (vec->items[i].line == line && strcmp(vec->items[i].name, name) == 0) {
            vec->items[i].count += count;
            return;
        }
    }
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 64;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len].name = xstrdup(name);
    vec->items[vec->len].line = line;
    vec->items[vec->len].count = count;
    vec->len += 1;
}

static void addr_map_push(AddrMapVec *vec, AddrMapEntry item)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len++] = item;
}

static void addr_map_free(AddrMapVec *vec)
{
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void pending_range_reset(PendingRange *r)
{
    r->valid = false;
    r->start = 0;
    r->end = 0;
}

static int path_index_cmp(const void *lhs, const void *rhs)
{
    const PathIndex *a = lhs;
    const PathIndex *b = rhs;
    return strcmp(a->path, b->path);
}

static int token_index_cmp(const void *lhs, const void *rhs)
{
    const TokenIndex *a = lhs;
    const TokenIndex *b = rhs;
    return strcmp(a->key, b->key);
}

static int line_index_cmp(const void *lhs, const void *rhs)
{
    const LineIndex *a = lhs;
    const LineIndex *b = rhs;
    if (a->line < b->line) {
        return -1;
    }
    if (a->line > b->line) {
        return 1;
    }
    return 0;
}

static int addr_map_addr_cmp(const void *lhs, const void *rhs)
{
    const AddrMapEntry *a = lhs;
    const AddrMapEntry *b = rhs;
    if (a->start < b->start) {
        return -1;
    }
    if (a->start > b->start) {
        return 1;
    }
    if (a->end < b->end) {
        return -1;
    }
    if (a->end > b->end) {
        return 1;
    }
    if (a->file_idx < b->file_idx) {
        return -1;
    }
    if (a->file_idx > b->file_idx) {
        return 1;
    }
    if (a->line < b->line) {
        return -1;
    }
    if (a->line > b->line) {
        return 1;
    }
    return 0;
}

static int uint_cmp(const void *lhs, const void *rhs)
{
    const unsigned int *a = lhs;
    const unsigned int *b = rhs;
    if (*a < *b) {
        return -1;
    }
    if (*a > *b) {
        return 1;
    }
    return 0;
}

static bool parse_decodedline_row(const char *row,
                                  char *file_buf,
                                  size_t file_buf_size,
                                  unsigned int *line_no,
                                  uint64_t *addr,
                                  bool *is_stmt)
{
    const char *p = row;
    size_t file_len = 0;
    char *endptr = NULL;

    while (*p == ' ' || *p == '\t') {
        p++;
    }
    if (!*p) {
        return false;
    }
    while (*p && *p != ' ' && *p != '\t' && file_len + 1 < file_buf_size) {
        file_buf[file_len++] = *p++;
    }
    file_buf[file_len] = '\0';
    while (*p == ' ' || *p == '\t') {
        p++;
    }
    if (!*p) {
        return false;
    }
    *line_no = (unsigned int) strtoul(p, &endptr, 10);
    if (endptr == p) {
        return false;
    }
    p = endptr;
    while (*p == ' ' || *p == '\t') {
        p++;
    }
    if (!(p[0] == '0' && p[1] == 'x')) {
        return false;
    }
    *addr = strtoull(p, &endptr, 16);
    if (endptr == p) {
        return false;
    }
    *is_stmt = strstr(endptr, " x") != NULL;
    return true;
}

static void file_coverage_add_line(FileCoverage *file, unsigned int line)
{
    LineIndex probe = {.line = line, .index = 0};
    void *slot = tfind(&probe, &file->line_root, line_index_cmp);
    LineIndex *node;

    if (slot) {
        return;
    }
    if (file->len == file->cap) {
        file->cap = file->cap ? file->cap * 2 : 1024;
        file->lines = xrealloc(file->lines, file->cap * sizeof(*file->lines));
        file->counts = xrealloc(file->counts, file->cap * sizeof(*file->counts));
    }
    file->lines[file->len] = line;
    file->counts[file->len] = 0;
    node = xcalloc(1, sizeof(*node));
    node->line = line;
    node->index = file->len;
    if (!tsearch(node, &file->line_root, line_index_cmp)) {
        perror("tsearch");
        exit(1);
    }
    file->len += 1;
}

static int filecov_path_cmp(const void *lhs, const void *rhs)
{
    const FileCoverage *a = lhs;
    const FileCoverage *b = rhs;
    return strcmp(a->path, b->path);
}

static int uint_line_cmp(const void *lhs, const void *rhs)
{
    const unsigned int *a = lhs;
    const unsigned int *b = rhs;
    if (*a < *b) {
        return -1;
    }
    if (*a > *b) {
        return 1;
    }
    return 0;
}

static int function_cov_cmp(const void *lhs, const void *rhs)
{
    const FunctionCoverage *a = lhs;
    const FunctionCoverage *b = rhs;
    if (a->line < b->line) {
        return -1;
    }
    if (a->line > b->line) {
        return 1;
    }
    return strcmp(a->name, b->name);
}

static int function_range_start_cmp(const void *lhs, const void *rhs)
{
    const FunctionRange *a = lhs;
    const FunctionRange *b = rhs;
    if (a->start < b->start) {
        return -1;
    }
    if (a->start > b->start) {
        return 1;
    }
    if (a->end < b->end) {
        return -1;
    }
    if (a->end > b->end) {
        return 1;
    }
    return strcmp(a->name, b->name);
}

static int function_range_line_cmp(const void *lhs, const void *rhs)
{
    const FunctionRange *a = lhs;
    const FunctionRange *b = rhs;
    if (a->file_idx < b->file_idx) {
        return -1;
    }
    if (a->file_idx > b->file_idx) {
        return 1;
    }
    if (a->line < b->line) {
        return -1;
    }
    if (a->line > b->line) {
        return 1;
    }
    return strcmp(a->name, b->name);
}

static void dedupe_function_ranges(FunctionRangeVec *ranges)
{
    size_t src;
    size_t dst = 0;

    if (ranges->len == 0) {
        return;
    }
    qsort(ranges->items, ranges->len, sizeof(*ranges->items), function_range_line_cmp);
    for (src = 0; src < ranges->len; src++) {
        if (dst > 0 &&
            ranges->items[dst - 1].file_idx == ranges->items[src].file_idx &&
            ranges->items[dst - 1].line == ranges->items[src].line &&
            strcmp(ranges->items[dst - 1].name, ranges->items[src].name) == 0) {
            free(ranges->items[src].name);
            continue;
        }
        if (dst != src) {
            ranges->items[dst] = ranges->items[src];
        }
        dst += 1;
    }
    ranges->len = dst;
}

static size_t find_file_index(const FileCoverageVec *files, const char *path)
{
    size_t lo = 0;
    size_t hi = files->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        int cmp = strcmp(files->items[mid].path, path);
        if (cmp < 0) {
            lo = mid + 1;
        } else if (cmp > 0) {
            hi = mid;
        } else {
            return mid;
        }
    }
    return (size_t) -1;
}

static size_t find_line_index(const FileCoverage *file, unsigned int line)
{
    size_t lo = 0;
    size_t hi = file->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (file->lines[mid] < line) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo < file->len && file->lines[lo] == line) {
        return lo;
    }
    return (size_t) -1;
}

static void finalize_file_coverage(FileCoverage *file)
{
    size_t i;
    if (file->len <= 1) {
        if (file->line_root) {
            tdestroy(file->line_root, free);
            file->line_root = NULL;
        }
        return;
    }
    for (i = 1; i < file->len; i++) {
        unsigned int line = file->lines[i];
        uint64_t count = file->counts[i];
        size_t j = i;
        while (j > 0 && file->lines[j - 1] > line) {
            file->lines[j] = file->lines[j - 1];
            file->counts[j] = file->counts[j - 1];
            j -= 1;
        }
        file->lines[j] = line;
        file->counts[j] = count;
    }
    if (file->line_root) {
        tdestroy(file->line_root, free);
        file->line_root = NULL;
    }
}

static char *normalize_source_path(const char *path)
{
    char *copy;
    char **parts;
    size_t part_cap = 0;
    size_t part_len = 0;
    char *saveptr = NULL;
    char *token;
    bool absolute;
    size_t out_len = 0;
    char *out;
    if (!path || !*path) {
        return xstrdup("");
    }
    copy = xstrdup(path);
    absolute = copy[0] == '/';
    parts = NULL;
    token = strtok_r(copy, "/", &saveptr);
    while (token) {
        if (strcmp(token, ".") == 0 || strcmp(token, "") == 0) {
            token = strtok_r(NULL, "/", &saveptr);
            continue;
        }
        if (strcmp(token, "..") == 0) {
            if (part_len > 0 && strcmp(parts[part_len - 1], "..") != 0) {
                free(parts[--part_len]);
            } else if (!absolute) {
                if (part_len == part_cap) {
                    part_cap = part_cap ? part_cap * 2 : 16;
                    parts = xrealloc(parts, part_cap * sizeof(*parts));
                }
                parts[part_len++] = xstrdup(token);
            }
            token = strtok_r(NULL, "/", &saveptr);
            continue;
        }
        if (part_len == part_cap) {
            part_cap = part_cap ? part_cap * 2 : 16;
            parts = xrealloc(parts, part_cap * sizeof(*parts));
        }
        parts[part_len++] = xstrdup(token);
        token = strtok_r(NULL, "/", &saveptr);
    }
    free(copy);

    if (absolute) {
        out_len += 1;
    }
    if (part_len == 0) {
        out = xstrdup(absolute ? "/" : ".");
    } else {
        for (size_t i = 0; i < part_len; i++) {
            out_len += strlen(parts[i]) + 1;
        }
        out = xcalloc(out_len + 1, 1);
        if (absolute) {
            strcat(out, "/");
        }
        for (size_t i = 0; i < part_len; i++) {
            if ((absolute && strlen(out) > 1) || (!absolute && strlen(out) > 0)) {
                strcat(out, "/");
            }
            strcat(out, parts[i]);
        }
    }
    for (size_t i = 0; i < part_len; i++) {
        free(parts[i]);
    }
    free(parts);
    return out;
}

static char *build_elf_dir(const char *elf_path)
{
    char *elf_abs = realpath(elf_path, NULL);
    char *elf_dir;
    char *slash;

    if (elf_abs) {
        elf_dir = xstrdup(elf_abs);
        free(elf_abs);
    } else {
        elf_dir = xstrdup(elf_path);
    }
    slash = strrchr(elf_dir, '/');
    if (slash) {
        *slash = '\0';
    } else {
        strcpy(elf_dir, ".");
    }
    return elf_dir;
}

typedef int (*line_row_callback)(const char *source_path,
                                 unsigned int line_no,
                                 uint64_t addr,
                                 bool is_stmt,
                                 void *arg);

static Dwfl *open_offline_dwfl(const char *elf_path, Dwfl_Module **module_out)
{
    static const Dwfl_Callbacks callbacks = {
        .find_elf = NULL,
        .find_debuginfo = NULL,
        .section_address = dwfl_offline_section_address,
        .debuginfo_path = NULL,
    };
    Dwfl *dwfl = dwfl_begin(&callbacks);
    Dwfl_Module *mod;

    if (!dwfl) {
        fprintf(stderr, "dwfl_begin failed: %s\n", dwfl_errmsg(dwfl_errno()));
        return NULL;
    }
    dwfl_report_begin(dwfl);
    mod = dwfl_report_offline(dwfl, elf_path, elf_path, -1);
    if (!mod) {
        fprintf(stderr, "dwfl_report_offline failed for %s: %s\n",
                elf_path,
                dwfl_errmsg(dwfl_errno()));
        dwfl_end(dwfl);
        return NULL;
    }
    if (dwfl_report_end(dwfl, NULL, NULL) != 0) {
        fprintf(stderr, "dwfl_report_end failed for %s: %s\n",
                elf_path,
                dwfl_errmsg(dwfl_errno()));
        dwfl_end(dwfl);
        return NULL;
    }
    if (module_out) {
        *module_out = mod;
    }
    return dwfl;
}

static int iterate_dwarf_lines(const char *elf_path,
                               line_row_callback callback,
                               void *arg)
{
    /*
     * Runtime reduction strategy:
     * read DWARF line tables directly in-process instead of shelling out to
     * `readelf --debug-dump=decodedline` and reparsing text output.
     */
    int fd;
    Elf *elf;
    Dwarf *dbg;
    Dwarf_Off off = 0;

    if (elf_version(EV_CURRENT) == EV_NONE) {
        fprintf(stderr, "elf_version failed\n");
        return -1;
    }
    fd = open(elf_path, O_RDONLY);
    if (fd < 0) {
        perror(elf_path);
        return -1;
    }
    elf = elf_begin(fd, ELF_C_READ, NULL);
    if (!elf) {
        fprintf(stderr, "elf_begin failed for %s\n", elf_path);
        close(fd);
        return -1;
    }
    dbg = dwarf_begin_elf(elf, DWARF_C_READ, NULL);
    if (!dbg) {
        fprintf(stderr, "dwarf_begin_elf failed for %s\n", elf_path);
        elf_end(elf);
        close(fd);
        return -1;
    }

    while (1) {
        Dwarf_Off next_off = 0;
        size_t hsize = 0;
        Dwarf_Off abbrev_offset = 0;
        uint8_t address_size = 0;
        uint8_t offset_size = 0;
        int rc = dwarf_nextcu(dbg,
                              off,
                              &next_off,
                              &hsize,
                              &abbrev_offset,
                              &address_size,
                              &offset_size);
        Dwarf_Die cudie_mem;
        Dwarf_Die *cudie;
        Dwarf_Lines *lines = NULL;
        size_t nlines = 0;
        size_t i;

        (void) abbrev_offset;
        (void) address_size;
        (void) offset_size;

        if (rc < 0) {
            fprintf(stderr, "dwarf_nextcu failed for %s\n", elf_path);
            dwarf_end(dbg);
            elf_end(elf);
            close(fd);
            return -1;
        }
        if (rc > 0) {
            break;
        }
        cudie = dwarf_offdie(dbg, off + hsize, &cudie_mem);
        if (!cudie) {
            off = next_off;
            continue;
        }
        if (dwarf_getsrclines(cudie, &lines, &nlines) != 0) {
            off = next_off;
            continue;
        }
        for (i = 0; i < nlines; i++) {
            Dwarf_Line *line = dwarf_onesrcline(lines, i);
            const char *src;
            Dwarf_Addr addr = 0;
            int line_no = 0;
            bool is_stmt = false;

            if (!line) {
                continue;
            }
            src = dwarf_linesrc(line, NULL, NULL);
            if (!src || !*src) {
                continue;
            }
            if (dwarf_lineaddr(line, &addr) != 0) {
                continue;
            }
            if (dwarf_lineno(line, &line_no) != 0 || line_no <= 0) {
                continue;
            }
            (void) dwarf_linebeginstatement(line, &is_stmt);
            if (callback(src, (unsigned int) line_no, (uint64_t) addr, is_stmt, arg) != 0) {
                dwarf_end(dbg);
                elf_end(elf);
                close(fd);
                return -1;
            }
        }
        off = next_off;
    }

    dwarf_end(dbg);
    elf_end(elf);
    close(fd);
    return 0;
}

static const char *basename_ptr(const char *path)
{
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

static void write_file_line_chunk(FILE *fp, const FileLineVec *vec)
{
    uint64_t count = (uint64_t) vec->len;
    size_t i;
    if (fwrite(&count, sizeof(count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    for (i = 0; i < vec->len; i++) {
        FileLineDiskRecord disk = {
            .path_len = (uint32_t) strlen(vec->items[i].path),
            .line = vec->items[i].line,
            .count = vec->items[i].count
        };
        if (fwrite(&disk, sizeof(disk), 1, fp) != 1) {
            perror("fwrite");
            exit(1);
        }
        if (disk.path_len > 0 && fwrite(vec->items[i].path, 1, disk.path_len, fp) != disk.path_len) {
            perror("fwrite");
            exit(1);
        }
    }
}

static int read_file_line_chunk(FILE *fp, FileLineVec *vec)
{
    uint64_t count = 0;
    size_t i;
    if (fread(&count, sizeof(count), 1, fp) != 1) {
        if (feof(fp)) {
            return 0;
        }
        perror("fread");
        exit(1);
    }
    for (i = 0; i < (size_t) count; i++) {
        FileLineDiskRecord disk;
        char *path;
        if (fread(&disk, sizeof(disk), 1, fp) != 1) {
            perror("fread");
            exit(1);
        }
        path = xcalloc((size_t) disk.path_len + 1, 1);
        if (disk.path_len > 0 && fread(path, 1, disk.path_len, fp) != disk.path_len) {
            perror("fread");
            exit(1);
        }
        file_line_vec_push(vec, path, disk.line, disk.count);
        free(path);
    }
    return 1;
}

static void symbol_vec_push(SymbolVec *vec, Symbol item)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len++] = item;
}

static void symbol_vec_free(SymbolVec *vec)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        free(vec->items[i].name);
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void source_vec_push(SourceVec *vec, SourceLoc item)
{
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len++] = item;
}

static void source_vec_free(SourceVec *vec)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        free(vec->items[i].func);
        free(vec->items[i].file);
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void write_source_record(FILE *fp, const SourceLoc *src)
{
    SourceDiskRecord disk = {
        .addr = src->addr,
        .line = src->line,
        .func_len = (uint32_t) strlen(src->func ? src->func : ""),
        .file_len = (uint32_t) strlen(src->file ? src->file : "")
    };

    if (fwrite(&disk, sizeof(disk), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    if (disk.func_len > 0 && fwrite(src->func, 1, disk.func_len, fp) != disk.func_len) {
        perror("fwrite");
        exit(1);
    }
    if (disk.file_len > 0 && fwrite(src->file, 1, disk.file_len, fp) != disk.file_len) {
        perror("fwrite");
        exit(1);
    }
}

static int read_source_record(FILE *fp, SourceVec *sources)
{
    SourceDiskRecord disk;
    SourceLoc src = {0};
    char *func = NULL;
    char *file = NULL;

    if (fread(&disk, sizeof(disk), 1, fp) != 1) {
        if (feof(fp)) {
            return 0;
        }
        perror("fread");
        exit(1);
    }
    func = xcalloc((size_t) disk.func_len + 1, 1);
    file = xcalloc((size_t) disk.file_len + 1, 1);
    if (disk.func_len > 0 && fread(func, 1, disk.func_len, fp) != disk.func_len) {
        perror("fread");
        exit(1);
    }
    if (disk.file_len > 0 && fread(file, 1, disk.file_len, fp) != disk.file_len) {
        perror("fread");
        exit(1);
    }
    src.addr = disk.addr;
    src.func = func;
    src.file = file;
    src.line = disk.line;
    source_vec_push(sources, src);
    return 1;
}

static char *build_exec_map_cache_path(const char *elf_path)
{
    char *cache_path = NULL;
    if (asprintf(&cache_path, "%s.nqc2-execmap-v2.bin", elf_path) < 0) {
        perror("asprintf");
        exit(1);
    }
    return cache_path;
}

static char *build_function_ranges_cache_path(const char *elf_path)
{
    char *cache_path = NULL;
    if (asprintf(&cache_path, "%s.nqc2-functions-v3.bin", elf_path) < 0) {
        perror("asprintf");
        exit(1);
    }
    return cache_path;
}

static void coverage_vec_inc(CoverageVec *vec, uint64_t addr)
{
    size_t i;
    for (i = 0; i < vec->len; i++) {
        if (vec->items[i].addr == addr) {
            vec->items[i].count += 1;
            return;
        }
    }
    if (vec->len == vec->cap) {
        vec->cap = vec->cap ? vec->cap * 2 : 1024;
        vec->items = xrealloc(vec->items, vec->cap * sizeof(*vec->items));
    }
    vec->items[vec->len].addr = addr;
    vec->items[vec->len].count = 1;
    vec->len += 1;
}

static int trace_record_cmp(const void *lhs, const void *rhs)
{
    const TraceRecord *a = lhs;
    const TraceRecord *b = rhs;
    if (a->vcpu != b->vcpu) {
        return (a->vcpu < b->vcpu) ? -1 : 1;
    }
    if (a->start != b->start) {
        return (a->start < b->start) ? -1 : 1;
    }
    if (a->end != b->end) {
        return (a->end < b->end) ? -1 : 1;
    }
    return 0;
}

static int symbol_cmp(const void *lhs, const void *rhs)
{
    const Symbol *a = lhs;
    const Symbol *b = rhs;
    if (a->start < b->start) {
        return -1;
    }
    if (a->start > b->start) {
        return 1;
    }
    return 0;
}

static int source_cmp(const void *lhs, const void *rhs)
{
    const SourceLoc *a = lhs;
    const SourceLoc *b = rhs;
    if (a->addr < b->addr) {
        return -1;
    }
    if (a->addr > b->addr) {
        return 1;
    }
    return 0;
}

static int coverage_cmp(const void *lhs, const void *rhs)
{
    const CoverageEntry *a = lhs;
    const CoverageEntry *b = rhs;
    if (a->addr < b->addr) {
        return -1;
    }
    if (a->addr > b->addr) {
        return 1;
    }
    return 0;
}

static int file_line_cmp(const void *lhs, const void *rhs)
{
    const FileLineCount *a = lhs;
    const FileLineCount *b = rhs;
    int path_cmp = strcmp(a->path, b->path);
    if (path_cmp != 0) {
        return path_cmp;
    }
    if (a->line < b->line) {
        return -1;
    }
    if (a->line > b->line) {
        return 1;
    }
    return 0;
}

static void dedupe_file_lines(FileLineVec *lines)
{
    size_t src;
    size_t dst = 0;

    if (lines->len == 0) {
        return;
    }
    qsort(lines->items, lines->len, sizeof(*lines->items), file_line_cmp);
    for (src = 0; src < lines->len; src++) {
        if (dst > 0 &&
            strcmp(lines->items[dst - 1].path, lines->items[src].path) == 0 &&
            lines->items[dst - 1].line == lines->items[src].line) {
            lines->items[dst - 1].count += lines->items[src].count;
            free(lines->items[src].path);
            continue;
        }
        if (dst != src) {
            lines->items[dst] = lines->items[src];
        }
        dst += 1;
    }
    lines->len = dst;
}

typedef struct {
    FileLineVec *lines;
    size_t decoded_rows;
    size_t pushed_lines;
} ExecutableLineLoadContext;

static int load_executable_line_row(const char *source_path,
                                    unsigned int line_no,
                                    uint64_t addr,
                                    bool is_stmt,
                                    void *arg)
{
    ExecutableLineLoadContext *ctx = arg;
    char *normalized;

    (void) addr;
    (void) is_stmt;
    ctx->decoded_rows += 1;
    normalized = normalize_source_path(source_path);
    file_line_vec_push(ctx->lines, normalized, line_no, 0);
    ctx->pushed_lines += 1;
    free(normalized);
    if (ctx->decoded_rows % NQC2_MEM_CHECK_INTERVAL == 0) {
        log_progress("load_executable_lines rows=%zu raw_lines=%zu",
                     ctx->decoded_rows,
                     ctx->pushed_lines);
        enforce_memory_limit("load_executable_lines", ctx->decoded_rows);
    }
    return 0;
}

static void load_executable_lines(const char *elf_path, FileLineVec *lines)
{
    ExecutableLineLoadContext ctx = {
        .lines = lines,
        .decoded_rows = 0,
        .pushed_lines = 0,
    };

    if (iterate_dwarf_lines(elf_path, load_executable_line_row, &ctx) != 0) {
        fprintf(stderr, "failed to load executable lines from %s\n", elf_path);
        exit(1);
    }
    log_progress("load_executable_lines collected %zu raw executable lines", ctx.pushed_lines);
    dedupe_file_lines(lines);
    log_progress("loaded %zu executable source lines from DWARF", lines->len);
}

typedef struct {
    FileCoverageVec *files;
    AddrMapVec *map;
    char *last_token_path;
    char *last_unit_path;
    size_t last_file_index;
    void *path_root;
    void *token_root;
    size_t decoded_rows;
    bool have_pending;
    uint64_t pending_start;
    uint64_t pending_end;
    uint32_t pending_file_idx;
    uint32_t pending_line;
} ExecMapBuildContext;

static int build_exec_map_line_row(const char *source_path,
                                   unsigned int line_no,
                                   uint64_t addr,
                                   bool is_stmt,
                                   void *arg)
{
    ExecMapBuildContext *ctx = arg;
    char *candidate = NULL;
    char *normalized = NULL;
    char key_buf[8192];
    TokenIndex token_probe;
    PathIndex probe;
    void *slot;
    size_t file_index;
    FileCoverage *file;

    if (!is_stmt) {
        return 0;
    }
    ctx->decoded_rows += 1;
    if (ctx->last_token_path &&
        strcmp(ctx->last_token_path, source_path) == 0 &&
        ((ctx->last_unit_path == NULL && source_path == NULL) ||
         (ctx->last_unit_path != NULL && source_path != NULL &&
          strcmp(ctx->last_unit_path, source_path) == 0))) {
        file_index = ctx->last_file_index;
    } else {
        snprintf(key_buf, sizeof(key_buf), "%s", source_path);
        token_probe.key = key_buf;
        slot = tfind(&token_probe, &ctx->token_root, token_index_cmp);
        if (slot) {
            file_index = (*(TokenIndex **) slot)->index;
        } else {
            candidate = xstrdup(source_path);
            normalized = normalize_source_path(candidate);
            free(candidate);

            probe.path = normalized;
            slot = tfind(&probe, &ctx->path_root, path_index_cmp);
            if (!slot) {
                PathIndex *node = xcalloc(1, sizeof(*node));
                FileCoverage new_file = {0};
                node->path = normalized;
                node->index = ctx->files->len;
                new_file.path = normalized;
                file_coverage_push(ctx->files, new_file);
                if (!tsearch(node, &ctx->path_root, path_index_cmp)) {
                    perror("tsearch");
                    exit(1);
                }
                file_index = node->index;
            } else {
                file_index = (*(PathIndex **) slot)->index;
                free(normalized);
            }
            {
                TokenIndex *token_node = xcalloc(1, sizeof(*token_node));
                token_node->key = xstrdup(key_buf);
                token_node->index = file_index;
                if (!tsearch(token_node, &ctx->token_root, token_index_cmp)) {
                    perror("tsearch");
                    exit(1);
                }
            }
        }
        free(ctx->last_token_path);
        free(ctx->last_unit_path);
        ctx->last_token_path = xstrdup(source_path);
        ctx->last_unit_path = xstrdup(source_path);
        ctx->last_file_index = file_index;
    }

    file = &ctx->files->items[file_index];
    file_coverage_add_line(file, line_no);
    if (ctx->have_pending) {
        if (addr > ctx->pending_start) {
            AddrMapEntry entry = {
                .start = ctx->pending_start,
                .end = addr,
                .file_idx = ctx->pending_file_idx,
                .line = ctx->pending_line,
                .count = 0,
            };
            addr_map_push(ctx->map, entry);
        }
    }
    ctx->have_pending = true;
    ctx->pending_start = addr;
    ctx->pending_end = addr + 4;
    ctx->pending_file_idx = (uint32_t) file_index;
    ctx->pending_line = line_no;

    if (ctx->decoded_rows % NQC2_MEM_CHECK_INTERVAL == 0) {
        log_progress("build_exec_map rows=%zu files=%zu intervals=%zu",
                     ctx->decoded_rows,
                     ctx->files->len,
                     ctx->map->len);
        enforce_memory_limit("build_exec_map", ctx->decoded_rows);
    }
    return 0;
}

static void build_exec_map(const char *elf_path, FileCoverageVec *files, AddrMapVec *map)
{
    /*
     * Runtime reduction strategy:
     * keep a small per-run token/path cache while walking DWARF rows so repeated
     * file references do not repeatedly normalize and look up the same source
     * path. Also collapse line metadata into address intervals instead of
     * point rows so later trace overlap is range-vs-range rather than
     * range-vs-many-points.
     */
    ExecMapBuildContext ctx = {
        .files = files,
        .map = map,
        .last_token_path = NULL,
        .last_unit_path = NULL,
        .last_file_index = (size_t) -1,
        .path_root = NULL,
        .token_root = NULL,
        .decoded_rows = 0,
        .have_pending = false,
        .pending_start = 0,
        .pending_end = 0,
        .pending_file_idx = 0,
        .pending_line = 0,
    };

    if (iterate_dwarf_lines(elf_path, build_exec_map_line_row, &ctx) != 0) {
        fprintf(stderr, "failed to build exec map from %s\n", elf_path);
        exit(1);
    }
    free(ctx.last_token_path);
    free(ctx.last_unit_path);
    if (ctx.have_pending) {
        AddrMapEntry entry = {
            .start = ctx.pending_start,
            .end = ctx.pending_end,
            .file_idx = ctx.pending_file_idx,
            .line = ctx.pending_line,
            .count = 0,
        };
        addr_map_push(map, entry);
    }

    qsort(map->items, map->len, sizeof(*map->items), addr_map_addr_cmp);
    if (map->len > 0) {
        size_t src;
        size_t dst = 0;
        for (src = 0; src < map->len; src++) {
            if (dst > 0 &&
                map->items[dst - 1].start == map->items[src].start &&
                map->items[dst - 1].end == map->items[src].end &&
                map->items[dst - 1].file_idx == map->items[src].file_idx &&
                map->items[dst - 1].line == map->items[src].line) {
                continue;
            }
            if (dst != src) {
                map->items[dst] = map->items[src];
            }
            dst += 1;
        }
        map->len = dst;
    }
    for (size_t i = 0; i < files->len; i++) {
        finalize_file_coverage(&files->items[i]);
    }

    log_progress("build_exec_map finished files=%zu intervals=%zu", files->len, map->len);
}

static void write_exec_map_cache(FILE *fp, const FileCoverageVec *files, const AddrMapVec *map)
{
    uint64_t file_count = (uint64_t) files->len;
    uint64_t map_count = (uint64_t) map->len;
    if (fwrite(&file_count, sizeof(file_count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    for (size_t i = 0; i < files->len; i++) {
        FileLineVec lines = {0};
        for (size_t j = 0; j < files->items[i].len; j++) {
            file_line_vec_push(&lines, files->items[i].path, files->items[i].lines[j], 0);
        }
        write_file_line_chunk(fp, &lines);
        file_line_vec_free(&lines);
    }
    if (fwrite(&map_count, sizeof(map_count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    for (size_t i = 0; i < map->len; i++) {
        AddrMapDiskRecord disk = {
            .start = map->items[i].start,
            .end = map->items[i].end,
            .file_idx = map->items[i].file_idx,
            .line = map->items[i].line,
            .count = map->items[i].count,
        };
        if (fwrite(&disk, sizeof(disk), 1, fp) != 1) {
            perror("fwrite");
            exit(1);
        }
    }
}

static int read_exec_map_cache(FILE *fp, FileCoverageVec *files, AddrMapVec *map)
{
    uint64_t file_count = 0;
    uint64_t map_count = 0;
    if (fread(&file_count, sizeof(file_count), 1, fp) != 1) {
        return 0;
    }
    for (size_t i = 0; i < (size_t) file_count; i++) {
        FileLineVec lines = {0};
        FileCoverage file = {0};
        if (!read_file_line_chunk(fp, &lines)) {
            file_line_vec_free(&lines);
            return 0;
        }
        if (lines.len == 0) {
            file_line_vec_free(&lines);
            continue;
        }
        file.path = xstrdup(lines.items[0].path);
        file.len = lines.len;
        file.cap = lines.len;
        file.lines = xcalloc(file.cap, sizeof(*file.lines));
        file.counts = xcalloc(file.cap, sizeof(*file.counts));
        for (size_t j = 0; j < lines.len; j++) {
            file.lines[j] = lines.items[j].line;
            file.counts[j] = 0;
        }
        file_coverage_push(files, file);
        file_line_vec_free(&lines);
    }
    if (fread(&map_count, sizeof(map_count), 1, fp) != 1) {
        return 0;
    }
    for (size_t i = 0; i < (size_t) map_count; i++) {
        AddrMapDiskRecord disk;
        AddrMapEntry entry;
        if (fread(&disk, sizeof(disk), 1, fp) != 1) {
            return 0;
        }
        entry.start = disk.start;
        entry.end = disk.end;
        entry.file_idx = disk.file_idx;
        entry.line = disk.line;
        entry.count = disk.count;
        addr_map_push(map, entry);
    }
    return 1;
}

static size_t addr_map_lower_bound(const AddrMapVec *map, uint64_t addr)
{
    size_t lo = 0;
    size_t hi = map->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (map->items[mid].start < addr) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

static size_t coverage_lower_bound(const CoverageVec *coverage, uint64_t addr)
{
    size_t lo = 0;
    size_t hi = coverage->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (coverage->items[mid].addr < addr) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

static size_t function_range_lower_bound(const FunctionRangeVec *ranges, uint64_t addr)
{
    size_t lo = 0;
    size_t hi = ranges->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (ranges->items[mid].start < addr) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

static void apply_exec_range(FileCoverageVec *files, const AddrMapVec *map, uint64_t start, uint64_t end)
{
    size_t idx;
    if (start >= end || map->len == 0) {
        return;
    }
    idx = addr_map_lower_bound(map, start);
    if (idx > 0) {
        idx -= 1;
    }
    while (idx < map->len && map->items[idx].start < end) {
        uint64_t overlap_start;
        uint64_t overlap_end;
        if (map->items[idx].end <= start) {
            idx += 1;
            continue;
        }
        overlap_start = start > map->items[idx].start ? start : map->items[idx].start;
        overlap_end = end < map->items[idx].end ? end : map->items[idx].end;
        if (overlap_start < overlap_end) {
            FileCoverage *file = &files->items[map->items[idx].file_idx];
            size_t line_idx = find_line_index(file, map->items[idx].line);
            if (line_idx != (size_t) -1) {
                file->counts[line_idx] += (overlap_end - overlap_start) / 4;
            }
        }
        idx += 1;
    }
}

static void flush_pending_ranges(FileCoverageVec *files, const AddrMapVec *map, PendingRange *pending, size_t pending_len)
{
    for (size_t i = 0; i < pending_len; i++) {
        if (pending[i].valid) {
            apply_exec_range(files, map, pending[i].start, pending[i].end);
            pending_range_reset(&pending[i]);
        }
    }
}

static void apply_function_exec_range(FunctionRangeVec *ranges, uint64_t start, uint64_t end)
{
    size_t idx;
    if (start >= end || ranges->len == 0) {
        return;
    }
    idx = function_range_lower_bound(ranges, start);
    if (idx > 0) {
        idx -= 1;
    }
    while (idx < ranges->len && ranges->items[idx].start < end) {
        uint64_t overlap_start = start > ranges->items[idx].start ? start : ranges->items[idx].start;
        uint64_t overlap_end = end < ranges->items[idx].end ? end : ranges->items[idx].end;
        if (overlap_start < overlap_end) {
            ranges->items[idx].count += (overlap_end - overlap_start) / 4;
        }
        idx += 1;
    }
}

static void flush_pending_function_ranges(FunctionRangeVec *ranges, PendingRange *pending, size_t pending_len)
{
    for (size_t i = 0; i < pending_len; i++) {
        if (pending[i].valid) {
            apply_function_exec_range(ranges, pending[i].start, pending[i].end);
        }
    }
}

static void reconcile_function_counts_from_lines(const FileCoverageVec *files,
                                                 const AddrMapVec *map,
                                                 FunctionRangeVec *functions)
{
    for (size_t i = 0; i < functions->len; i++) {
        size_t idx;
        uint64_t best = 0;

        functions->items[i].count = 0;
        idx = addr_map_lower_bound(map, functions->items[i].start);
        if (idx > 0) {
            idx -= 1;
        }
        while (idx < map->len && map->items[idx].start < functions->items[i].end) {
            uint64_t overlap_start;
            uint64_t overlap_end;
            const FileCoverage *file;
            size_t line_idx;

            if (map->items[idx].end <= functions->items[i].start) {
                idx += 1;
                continue;
            }
            overlap_start = functions->items[i].start > map->items[idx].start
                ? functions->items[i].start
                : map->items[idx].start;
            overlap_end = functions->items[i].end < map->items[idx].end
                ? functions->items[i].end
                : map->items[idx].end;
            if (overlap_start < overlap_end &&
                map->items[idx].file_idx == functions->items[i].file_idx) {
                file = &files->items[map->items[idx].file_idx];
                line_idx = find_line_index(file, map->items[idx].line);
                if (line_idx != (size_t) -1 && file->counts[line_idx] > best) {
                    best = file->counts[line_idx];
                }
            }
            idx += 1;
        }
        functions->items[i].count = best;
    }
}

static void collect_etrace_packets(const char *path,
                                   TracePacketInfo **packets_out,
                                   size_t *packet_len_out)
{
    FILE *fp = fopen(path, "rb");
    TracePacketInfo *packets = NULL;
    size_t packet_len = 0;
    size_t packet_cap = 0;

    if (!fp) {
        perror(path);
        exit(1);
    }
    while (1) {
        struct etrace_hdr hdr;
        size_t read_count = fread(&hdr, 1, sizeof(hdr), fp);
        if (read_count == 0) {
            break;
        }
        if (read_count != sizeof(hdr)) {
            break;
        }
        if (packet_len == packet_cap) {
            packet_cap = packet_cap ? packet_cap * 2 : 1024;
            packets = xrealloc(packets, packet_cap * sizeof(*packets));
        }
        packets[packet_len].offset = (uint64_t) ftell(fp) - sizeof(hdr);
        packets[packet_len].unit_id = hdr.unit_id;
        packets[packet_len].len = hdr.len;
        packet_len += 1;
        if (fseek(fp, (long) hdr.len, SEEK_CUR) != 0) {
            break;
        }
    }
    fclose(fp);
    *packets_out = packets;
    *packet_len_out = packet_len;
}

static FileCoverageVec clone_file_coverage_counts(const FileCoverageVec *src)
{
    FileCoverageVec dst = {0};
    dst.len = src->len;
    dst.cap = src->len;
    dst.items = xcalloc(dst.cap, sizeof(*dst.items));
    for (size_t i = 0; i < src->len; i++) {
        dst.items[i].path = src->items[i].path;
        dst.items[i].lines = src->items[i].lines;
        dst.items[i].len = src->items[i].len;
        dst.items[i].cap = src->items[i].len;
        dst.items[i].counts = xcalloc(dst.items[i].cap, sizeof(*dst.items[i].counts));
        dst.items[i].line_root = NULL;
    }
    return dst;
}

static void free_file_coverage_counts_clone(FileCoverageVec *vec)
{
    for (size_t i = 0; i < vec->len; i++) {
        free(vec->items[i].counts);
    }
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static FunctionRangeVec clone_function_range_counts(const FunctionRangeVec *src)
{
    FunctionRangeVec dst = {0};
    dst.len = src->len;
    dst.cap = src->len;
    dst.items = xcalloc(dst.cap, sizeof(*dst.items));
    for (size_t i = 0; i < src->len; i++) {
        dst.items[i] = src->items[i];
        dst.items[i].count = 0;
    }
    return dst;
}

static void free_function_range_counts_clone(FunctionRangeVec *vec)
{
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static void write_worker_deltas(FILE *fp,
                                const FileCoverageVec *files,
                                const FunctionRangeVec *functions)
{
    uint64_t file_count = (uint64_t) files->len;
    uint64_t function_count = (uint64_t) functions->len;
    if (fwrite(&file_count, sizeof(file_count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    for (size_t i = 0; i < files->len; i++) {
        uint64_t len = (uint64_t) files->items[i].len;
        if (fwrite(&len, sizeof(len), 1, fp) != 1) {
            perror("fwrite");
            exit(1);
        }
        if (len > 0 && fwrite(files->items[i].counts, sizeof(*files->items[i].counts), files->items[i].len, fp) != files->items[i].len) {
            perror("fwrite");
            exit(1);
        }
    }
    if (fwrite(&function_count, sizeof(function_count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    if (function_count > 0 && fwrite(functions->items, sizeof(*functions->items), functions->len, fp) != functions->len) {
        perror("fwrite");
        exit(1);
    }
}

static void merge_worker_deltas(FILE *fp,
                                FileCoverageVec *files,
                                FunctionRangeVec *functions)
{
    uint64_t file_count = 0;
    uint64_t function_count = 0;
    if (fread(&file_count, sizeof(file_count), 1, fp) != 1) {
        perror("fread");
        exit(1);
    }
    for (size_t i = 0; i < (size_t) file_count; i++) {
        uint64_t len = 0;
        uint64_t *counts = NULL;
        if (fread(&len, sizeof(len), 1, fp) != 1) {
            perror("fread");
            exit(1);
        }
        counts = xcalloc((size_t) len, sizeof(*counts));
        if (len > 0 && fread(counts, sizeof(*counts), (size_t) len, fp) != (size_t) len) {
            perror("fread");
            free(counts);
            exit(1);
        }
        for (size_t j = 0; j < (size_t) len; j++) {
            files->items[i].counts[j] += counts[j];
        }
        free(counts);
    }
    if (fread(&function_count, sizeof(function_count), 1, fp) != 1) {
        perror("fread");
        exit(1);
    }
    if (function_count > 0) {
        FunctionRange *tmp = xcalloc((size_t) function_count, sizeof(*tmp));
        if (fread(tmp, sizeof(*tmp), (size_t) function_count, fp) != (size_t) function_count) {
            perror("fread");
            free(tmp);
            exit(1);
        }
        for (size_t i = 0; i < (size_t) function_count; i++) {
            functions->items[i].count += tmp[i].count;
        }
        free(tmp);
    }
}

static void parse_etrace_trace_lcov(const char *path, FileCoverageVec *files, const AddrMapVec *map)
{
    FILE *fp = fopen(path, "rb");
    PendingRange pending[65536] = {0};
    size_t count = 0;

    if (!fp) {
        perror(path);
        exit(1);
    }
    log_progress("reading etrace trace %s", path);
    for (;;) {
        struct etrace_hdr hdr;
        size_t read_count = fread(&hdr, 1, sizeof(hdr), fp);
        if (read_count == 0) {
            break;
        }
        if (read_count != sizeof(hdr)) {
            break;
        }
        if (hdr.type != 1 || hdr.len < 8) {
            if (fseek(fp, (long) hdr.len, SEEK_CUR) != 0) {
                break;
            }
            continue;
        }
        if (fseek(fp, 8L, SEEK_CUR) != 0) {
            break;
        }
        size_t remaining = hdr.len - 8;
        while (remaining >= sizeof(struct etrace_entry64)) {
            struct etrace_entry64 entry;
            PendingRange *slot = &pending[hdr.unit_id];
            if (fread(&entry, 1, sizeof(entry), fp) != sizeof(entry)) {
                fclose(fp);
                return;
            }
            if (slot->valid && slot->end == entry.start) {
                slot->end = entry.end;
            } else {
                if (slot->valid) {
                    apply_exec_range(files, map, slot->start, slot->end);
                }
                slot->valid = true;
                slot->start = entry.start;
                slot->end = entry.end;
            }
            count += 1;
            enforce_memory_limit("parse_etrace_trace_lcov", count);
            remaining -= sizeof(entry);
        }
        if (remaining > 0) {
            if (fseek(fp, (long) remaining, SEEK_CUR) != 0) {
                break;
            }
        }
    }
    fclose(fp);
    flush_pending_ranges(files, map, pending, 65536);
    log_progress("parsed %zu raw trace records", count);
}

static void parse_etrace_trace_lcov_functions(const char *path,
                                              FileCoverageVec *files,
                                              const AddrMapVec *map,
                                              FunctionRangeVec *functions)
{
    FILE *fp = fopen(path, "rb");
    PendingRange pending[65536] = {0};
    size_t count = 0;

    if (!fp) {
        perror(path);
        exit(1);
    }
    log_progress("reading etrace trace %s", path);
    for (;;) {
        struct etrace_hdr hdr;
        size_t read_count = fread(&hdr, 1, sizeof(hdr), fp);
        if (read_count == 0) {
            break;
        }
        if (read_count != sizeof(hdr)) {
            break;
        }
        if (hdr.type != 1 || hdr.len < 8) {
            if (fseek(fp, (long) hdr.len, SEEK_CUR) != 0) {
                break;
            }
            continue;
        }
        if (fseek(fp, 8L, SEEK_CUR) != 0) {
            break;
        }
        size_t remaining = hdr.len - 8;
        while (remaining >= sizeof(struct etrace_entry64)) {
            struct etrace_entry64 entry;
            PendingRange *slot = &pending[hdr.unit_id];
            if (fread(&entry, 1, sizeof(entry), fp) != sizeof(entry)) {
                fclose(fp);
                return;
            }
            if (slot->valid && slot->end == entry.start) {
                slot->end = entry.end;
            } else {
                if (slot->valid) {
                    apply_exec_range(files, map, slot->start, slot->end);
                    if (functions) {
                        apply_function_exec_range(functions, slot->start, slot->end);
                    }
                }
                slot->valid = true;
                slot->start = entry.start;
                slot->end = entry.end;
            }
            count += 1;
            enforce_memory_limit("parse_etrace_trace_lcov", count);
            remaining -= sizeof(entry);
        }
        if (remaining > 0) {
            if (fseek(fp, (long) remaining, SEEK_CUR) != 0) {
                break;
            }
        }
    }
    fclose(fp);
    flush_pending_ranges(files, map, pending, 65536);
    if (functions) {
        flush_pending_function_ranges(functions, pending, 65536);
    }
    log_progress("parsed %zu raw trace records", count);
}

static void parse_etrace_trace_lcov_functions_worker(const char *path,
                                                     const TracePacketInfo *packets,
                                                     size_t base,
                                                     size_t end,
                                                     const AddrMapVec *map,
                                                     const FileCoverageVec *template_files,
                                                     const FunctionRangeVec *template_functions,
                                                     FILE *sink)
{
    FILE *fp = fopen(path, "rb");
    FileCoverageVec files = clone_file_coverage_counts(template_files);
    FunctionRangeVec functions = clone_function_range_counts(template_functions);
    PendingRange pending[65536] = {0};

    if (!fp) {
        perror(path);
        exit(1);
    }
    for (size_t i = base; i < end; i++) {
        const TracePacketInfo *pkt = &packets[i];
        size_t remaining;
        if (fseek(fp, (long) (pkt->offset + sizeof(struct etrace_hdr)), SEEK_SET) != 0) {
            perror("fseek");
            exit(1);
        }
        if (fseek(fp, 8L, SEEK_CUR) != 0) {
            perror("fseek");
            exit(1);
        }
        remaining = (size_t) pkt->len - 8;
        while (remaining >= sizeof(struct etrace_entry64)) {
            struct etrace_entry64 entry;
            PendingRange *slot = &pending[pkt->unit_id];
            if (fread(&entry, 1, sizeof(entry), fp) != sizeof(entry)) {
                fclose(fp);
                exit(1);
            }
            if (slot->valid && slot->end == entry.start) {
                slot->end = entry.end;
            } else {
                if (slot->valid) {
                    apply_exec_range(&files, map, slot->start, slot->end);
                    apply_function_exec_range(&functions, slot->start, slot->end);
                }
                slot->valid = true;
                slot->start = entry.start;
                slot->end = entry.end;
            }
            remaining -= sizeof(entry);
        }
        if (((i - base + 1) % 64) == 0) {
            enforce_memory_limit("parse_etrace_trace_lcov_worker", i - base + 1);
        }
    }
    fclose(fp);
    flush_pending_ranges(&files, map, pending, 65536);
    flush_pending_function_ranges(&functions, pending, 65536);
    write_worker_deltas(sink, &files, &functions);
    free_file_coverage_counts_clone(&files);
    free_function_range_counts_clone(&functions);
}

static void parse_etrace_trace_lcov_functions_parallel(const char *path,
                                                       FileCoverageVec *files,
                                                       const AddrMapVec *map,
                                                       FunctionRangeVec *functions,
                                                       size_t jobs)
{
    TracePacketInfo *packets = NULL;
    size_t packet_len = 0;

    collect_etrace_packets(path, &packets, &packet_len);
    jobs = clamp_jobs(jobs);
    if (jobs > packet_len) {
        jobs = packet_len;
    }
    if (jobs <= 1 || packet_len == 0) {
        free(packets);
        parse_etrace_trace_lcov_functions(path, files, map, functions);
        return;
    }

    {
        pid_t *pids = xcalloc(jobs, sizeof(*pids));
        char **tmp_paths = xcalloc(jobs, sizeof(*tmp_paths));
        size_t launched = 0;
        size_t chunk = (packet_len + jobs - 1) / jobs;

        for (size_t i = 0; i < jobs; i++) {
            size_t base = i * chunk;
            size_t end = base + chunk;
            int fd;
            if (base >= packet_len) {
                break;
            }
            if (end > packet_len) {
                end = packet_len;
            }
            tmp_paths[i] = xstrdup("/tmp/nqc2-lcov-delta-XXXXXX");
            fd = mkstemp(tmp_paths[i]);
            if (fd < 0) {
                perror("mkstemp");
                exit(1);
            }
            close(fd);
            pids[i] = fork();
            if (pids[i] < 0) {
                perror("fork");
                exit(1);
            }
            if (pids[i] == 0) {
                FILE *sink = fopen(tmp_paths[i], "wb");
                if (!sink) {
                    perror(tmp_paths[i]);
                    _exit(1);
                }
                log_progress("trace stage worker %zu/%zu handling packets %zu..%zu",
                             i + 1, jobs, base, end);
                parse_etrace_trace_lcov_functions_worker(path,
                                                         packets,
                                                         base,
                                                         end,
                                                         map,
                                                         files,
                                                         functions,
                                                         sink);
                fclose(sink);
                _exit(0);
            }
            launched += 1;
        }

        for (size_t i = 0; i < launched; i++) {
            int status = 0;
            if (waitpid(pids[i], &status, 0) < 0) {
                perror("waitpid");
                exit(1);
            }
            if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
                fprintf(stderr, "nqc2: trace stage worker %zu failed\n", i + 1);
                exit(1);
            }
        }

        for (size_t i = 0; i < launched; i++) {
            FILE *sink = fopen(tmp_paths[i], "rb");
            if (!sink) {
                perror(tmp_paths[i]);
                exit(1);
            }
            merge_worker_deltas(sink, files, functions);
            fclose(sink);
            unlink(tmp_paths[i]);
            free(tmp_paths[i]);
        }
        free(tmp_paths);
        free(pids);
    }
    free(packets);
}

static void emit_lcov_from_files(const char *path,
                                 const char *elf_path,
                                 const FileCoverageVec *files,
                                 const FunctionRangeVec *functions)
{
    FILE *fp = fopen(path, "w");
    char *elf_dir = build_elf_dir(elf_path);
    if (!fp) {
        perror(path);
        exit(1);
    }
    for (size_t i = 0; i < files->len; i++) {
        unsigned int lh = 0;
        char *resolved_path = NULL;
        FILE *source_fp = NULL;
        char *source_text = NULL;
        size_t source_len = 0;
        uint64_t *line_counts = NULL;
        size_t line_cap = 0;
        size_t total_lines = 0;
        int ch;

        if (files->items[i].path[0] == '/') {
            resolved_path = xstrdup(files->items[i].path);
        } else if (asprintf(&resolved_path, "%s/%s", elf_dir, files->items[i].path) < 0) {
            perror("asprintf");
            exit(1);
        }
        source_fp = fopen(resolved_path, "r");
        if (source_fp) {
            while ((ch = fgetc(source_fp)) != EOF) {
                if (ch == '\n') {
                    total_lines += 1;
                }
            }
            if (ferror(source_fp)) {
                perror(resolved_path);
                fclose(source_fp);
                free(resolved_path);
                exit(1);
            }
            if (fseek(source_fp, 0L, SEEK_END) != 0) {
                perror(resolved_path);
                fclose(source_fp);
                free(resolved_path);
                exit(1);
            }
            if (ftell(source_fp) > 0) {
                int last_char;
                if (fseek(source_fp, -1L, SEEK_END) != 0) {
                    perror(resolved_path);
                    fclose(source_fp);
                    free(resolved_path);
                    exit(1);
                }
                last_char = fgetc(source_fp);
                if (last_char != '\n') {
                    total_lines += 1;
                }
            }
            fclose(source_fp);
        }
        source_text = read_file(resolved_path, &source_len);
        for (size_t j = 0; j < files->items[i].len; j++) {
            unsigned int line_no = files->items[i].lines[j];
            if (line_no > total_lines) {
                total_lines = line_no;
            }
        }
        if (total_lines == 0) {
            total_lines = 1;
        }
        line_cap = total_lines + 1;
        line_counts = xcalloc(line_cap, sizeof(*line_counts));
        for (size_t j = 0; j < files->items[i].len; j++) {
            unsigned int line_no = files->items[i].lines[j];
            if (line_no == 0 || line_no > total_lines) {
                continue;
            }
            line_counts[line_no] = files->items[i].counts[j];
        }
        fprintf(fp, "TN:\nSF:%s\n", files->items[i].path);
        if (functions) {
            FunctionRange *file_functions = NULL;
            size_t file_function_count = 0;
            unsigned int fnh = 0;
            size_t fnf = 0;
            for (size_t j = 0; j < functions->len; j++) {
                if (functions->items[j].file_idx != i) {
                    continue;
                }
                file_function_count += 1;
            }
            if (file_function_count > 0) {
                size_t at = 0;
                file_functions = xcalloc(file_function_count, sizeof(*file_functions));
                for (size_t j = 0; j < functions->len; j++) {
                    if (functions->items[j].file_idx == i) {
                        file_functions[at++] = functions->items[j];
                    }
                }
                qsort(file_functions,
                      file_function_count,
                      sizeof(*file_functions),
                      function_range_line_cmp);
                {
                    size_t src;
                    size_t dst = 0;
                    for (src = 0; src < file_function_count; src++) {
                        if (dst > 0 &&
                            file_functions[dst - 1].line == file_functions[src].line &&
                            strcmp(file_functions[dst - 1].name, file_functions[src].name) == 0) {
                            continue;
                        }
                        if (dst != src) {
                            file_functions[dst] = file_functions[src];
                        }
                        dst += 1;
                    }
                    file_function_count = dst;
                }
                /*
                 * Keep FNDA consistent with genhtml by deriving function hits
                 * from the covered source-line span in the file, not from raw
                 * function address-range overlap. Optimized code, wrappers, and
                 * headers can otherwise produce "function hit but no contained
                 * line hit" inconsistencies.
                 */
                for (size_t j = 0; j < file_function_count; j++) {
                    unsigned int start_line = file_functions[j].line;
                    unsigned int end_line = (j + 1 < file_function_count &&
                                             file_functions[j + 1].line > start_line)
                        ? file_functions[j + 1].line - 1
                        : (unsigned int) total_lines;
                    uint64_t fn_count = 0;
                    if (start_line > total_lines) {
                        start_line = (unsigned int) total_lines;
                    }
                    if (end_line > total_lines) {
                        end_line = (unsigned int) total_lines;
                    }
                    end_line = derive_function_end_line(source_text, start_line, end_line);
                    if (start_line > 0 && end_line >= start_line) {
                        for (unsigned int line_no = start_line; line_no <= end_line; line_no++) {
                            fn_count += line_counts[line_no];
                        }
                    }
                    file_functions[j].count = fn_count;
                }
            }
            for (size_t j = 0; j < file_function_count; j++) {
                fprintf(fp, "FN:%u,%s\n",
                        file_functions[j].line,
                        file_functions[j].name);
                fnf += 1;
            }
            for (size_t j = 0; j < file_function_count; j++) {
                if (file_functions[j].count > 0) {
                    fnh += 1;
                }
                fprintf(fp, "FNDA:%" PRIu64 ",%s\n",
                        file_functions[j].count,
                        file_functions[j].name);
            }
            fprintf(fp, "FNF:%zu\nFNH:%u\n", fnf, fnh);
            free(file_functions);
        }
        for (size_t line_no = 1; line_no <= total_lines; line_no++) {
            if (line_counts[line_no] > 0) {
                lh += 1;
            }
            fprintf(fp, "DA:%zu,%" PRIu64 "\n", line_no, line_counts[line_no]);
        }
        fprintf(fp, "LF:%zu\nLH:%u\nend_of_record\n", total_lines, lh);
        free(source_text);
        free(line_counts);
        free(resolved_path);
    }
    fclose(fp);
    free(elf_dir);
}

static size_t clamp_jobs(size_t jobs);

static void build_coverage_chunk(const TraceRecord *records, size_t len, CoverageVec *coverage)
{
    size_t i;

    for (i = 0; i < len; i++) {
        uint64_t addr;
        for (addr = records[i].start; addr < records[i].end; addr += 4) {
            if (coverage->len > 0 && coverage->items[coverage->len - 1].addr == addr) {
                coverage->items[coverage->len - 1].count += 1;
            } else {
                coverage_vec_push(coverage, addr, 1);
                enforce_memory_limit("build_coverage", coverage->len);
            }
        }
    }
}

static void merge_records(TraceVec *vec)
{
    size_t src;
    size_t dst = 0;

    if (vec->len == 0) {
        return;
    }
    log_progress("merging %zu trace ranges", vec->len);
    qsort(vec->items, vec->len, sizeof(*vec->items), trace_record_cmp);
    for (src = 0; src < vec->len; src++) {
        if (dst > 0
            && vec->items[dst - 1].vcpu == vec->items[src].vcpu
            && vec->items[dst - 1].end == vec->items[src].start) {
            vec->items[dst - 1].end = vec->items[src].end;
            continue;
        }
        vec->items[dst++] = vec->items[src];
    }
    vec->len = dst;
    log_progress("merged trace ranges down to %zu", vec->len);
}

static void merge_records_parallel(TraceVec *vec, size_t jobs)
{
    size_t i;
    size_t len = vec->len;
    size_t chunk;
    pid_t *pids;
    char **tmp_paths;
    size_t launched = 0;
    TraceVec *runs;
    TraceVec merged = {0};

    if (len == 0) {
        return;
    }
    jobs = clamp_jobs(jobs);
    if (jobs > len) {
        jobs = len;
    }
    if (jobs == 1) {
        merge_records(vec);
        return;
    }

    pids = xcalloc(jobs, sizeof(*pids));
    tmp_paths = xcalloc(jobs, sizeof(*tmp_paths));
    chunk = (len + jobs - 1) / jobs;
    for (i = 0; i < jobs; i++) {
        size_t base = i * chunk;
        size_t end = base + chunk;
        int fd;
        if (base >= len) {
            break;
        }
        if (end > len) {
            end = len;
        }
        tmp_paths[i] = xstrdup("/tmp/nqc2-merge-XXXXXX");
        fd = mkstemp(tmp_paths[i]);
        if (fd < 0) {
            perror("mkstemp");
            exit(1);
        }
        close(fd);
        pids[i] = fork();
        if (pids[i] < 0) {
            perror("fork");
            exit(1);
        }
        if (pids[i] == 0) {
            FILE *sink = fopen(tmp_paths[i], "wb");
            TraceVec local = {0};
            if (!sink) {
                perror(tmp_paths[i]);
                _exit(1);
            }
            local.items = xcalloc(end - base, sizeof(*local.items));
            memcpy(local.items, vec->items + base, (end - base) * sizeof(*local.items));
            local.len = end - base;
            local.cap = end - base;
            qsort(local.items, local.len, sizeof(*local.items), trace_record_cmp);
            write_trace_chunk(sink, &local);
            fclose(sink);
            trace_vec_free(&local);
            _exit(0);
        }
        launched += 1;
    }

    for (i = 0; i < launched; i++) {
        int status = 0;
        if (waitpid(pids[i], &status, 0) < 0) {
            perror("waitpid");
            exit(1);
        }
        if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
            fprintf(stderr, "nqc2: merge_records worker %zu failed\n", i + 1);
            exit(1);
        }
    }

    runs = xcalloc(launched, sizeof(*runs));
    for (i = 0; i < launched; i++) {
        FILE *fp = fopen(tmp_paths[i], "rb");
        if (!fp) {
            perror(tmp_paths[i]);
            exit(1);
        }
        while (read_trace_chunk(fp, &runs[i])) {
            ;
        }
        fclose(fp);
        unlink(tmp_paths[i]);
        free(tmp_paths[i]);
    }

    for (;;) {
        ssize_t best = -1;
        for (i = 0; i < launched; i++) {
            if (runs[i].len == 0) {
                continue;
            }
            if (best < 0 ||
                trace_record_cmp(&runs[i].items[0], &runs[best].items[0]) < 0) {
                best = (ssize_t) i;
            }
        }
        if (best < 0) {
            break;
        }
        if (merged.len > 0 &&
            merged.items[merged.len - 1].vcpu == runs[best].items[0].vcpu &&
            merged.items[merged.len - 1].end == runs[best].items[0].start) {
            merged.items[merged.len - 1].end = runs[best].items[0].end;
        } else {
            trace_vec_push(&merged, runs[best].items[0]);
        }
        memmove(runs[best].items, runs[best].items + 1, (runs[best].len - 1) * sizeof(*runs[best].items));
        runs[best].len -= 1;
    }

    trace_vec_free(vec);
    *vec = merged;
    for (i = 0; i < launched; i++) {
        trace_vec_free(&runs[i]);
    }
    free(runs);
    free(tmp_paths);
    free(pids);
    log_progress("merged trace ranges down to %zu", vec->len);
}

static void parse_text_trace(const char *path, TraceVec *vec)
{
    FILE *fp = fopen(path, "r");
    char line[4096];
    size_t count = 0;
    if (!fp) {
        perror(path);
        exit(1);
    }
    log_progress("reading text trace %s", path);
    while (fgets(line, sizeof(line), fp)) {
        TraceRecord rec;
        if (line[0] != 'T') {
            continue;
        }
        if (sscanf(line, "T %u 0x%" SCNx64 " 0x%" SCNx64, &rec.vcpu, &rec.start, &rec.end) == 3) {
            trace_vec_push(vec, rec);
            count += 1;
            enforce_memory_limit("parse_text_trace", count);
        }
    }
    fclose(fp);
}

static void parse_etrace_worker(const char *path, const TracePacketInfo *packets, size_t base, size_t end, FILE *sink)
{
    FILE *fp = fopen(path, "rb");
    size_t i;

    if (!fp) {
        perror(path);
        exit(1);
    }
    for (i = base; i < end; i++) {
        const TracePacketInfo *pkt = &packets[i];
        size_t remaining;
        TraceVec local = {0};
        if (fseek(fp, (long) (pkt->offset + sizeof(struct etrace_hdr)), SEEK_SET) != 0) {
            perror("fseek");
            exit(1);
        }
        if (fseek(fp, 8L, SEEK_CUR) != 0) {
            perror("fseek");
            exit(1);
        }
        remaining = (size_t) pkt->len - 8;
        while (remaining >= sizeof(struct etrace_entry64)) {
            struct etrace_entry64 entry;
            TraceRecord rec;
            if (fread(&entry, 1, sizeof(entry), fp) != sizeof(entry)) {
                perror("fread");
                exit(1);
            }
            rec.vcpu = pkt->unit_id;
            rec.start = entry.start;
            rec.end = entry.end;
            trace_vec_push(&local, rec);
            remaining -= sizeof(entry);
        }
        write_trace_chunk(sink, &local);
        trace_vec_free(&local);
    }
    fclose(fp);
}

static void parse_etrace_trace(const char *path, TraceVec *vec, size_t jobs)
{
    FILE *fp = fopen(path, "rb");
    TracePacketInfo *packets = NULL;
    size_t packet_len = 0;
    size_t packet_cap = 0;
    if (!fp) {
        perror(path);
        exit(1);
    }
    log_progress("reading etrace trace %s", path);
    for (;;) {
        struct etrace_hdr hdr;
        size_t read_count = fread(&hdr, 1, sizeof(hdr), fp);
        if (read_count == 0) {
            break;
        }
        if (read_count != sizeof(hdr)) {
            break;
        }
        if (packet_len == packet_cap) {
            packet_cap = packet_cap ? packet_cap * 2 : 1024;
            packets = xrealloc(packets, packet_cap * sizeof(*packets));
        }
        packets[packet_len].offset = (uint64_t) ftell(fp) - sizeof(hdr);
        packets[packet_len].unit_id = hdr.unit_id;
        packets[packet_len].len = hdr.len;
        packet_len += 1;
        if (hdr.type != 1) {
            if (fseek(fp, (long) hdr.len, SEEK_CUR) != 0) {
                break;
            }
            continue;
        }
        if (hdr.len < 8) {
            if (fseek(fp, (long) hdr.len, SEEK_CUR) != 0) {
                break;
            }
            continue;
        }
        if (fseek(fp, (long) hdr.len, SEEK_CUR) != 0) {
            break;
        }
    }
    fclose(fp);
    jobs = clamp_jobs(jobs);
    if (jobs > packet_len) {
        jobs = packet_len;
    }
    if (jobs == 0 || packet_len == 0) {
        free(packets);
        return;
    }
    if (jobs == 1) {
        size_t i;
        FILE *mem = tmpfile();
        if (!mem) {
            perror("tmpfile");
            exit(1);
        }
        parse_etrace_worker(path, packets, 0, packet_len, mem);
        rewind(mem);
        while (read_trace_chunk(mem, vec)) {
            ;
        }
        fclose(mem);
        free(packets);
        log_progress("parsed %zu raw trace records", vec->len);
        return;
    }

    {
        pid_t *pids = xcalloc(jobs, sizeof(*pids));
        char **tmp_paths = xcalloc(jobs, sizeof(*tmp_paths));
        size_t launched = 0;
        size_t chunk = (packet_len + jobs - 1) / jobs;
        for (size_t i = 0; i < jobs; i++) {
            size_t base = i * chunk;
            size_t end = base + chunk;
            int fd;
            if (base >= packet_len) {
                break;
            }
            if (end > packet_len) {
                end = packet_len;
            }
            tmp_paths[i] = xstrdup("/tmp/nqc2-trace-XXXXXX");
            fd = mkstemp(tmp_paths[i]);
            if (fd < 0) {
                perror("mkstemp");
                exit(1);
            }
            close(fd);
            pids[i] = fork();
            if (pids[i] < 0) {
                perror("fork");
                exit(1);
            }
            if (pids[i] == 0) {
                FILE *sink = fopen(tmp_paths[i], "wb");
                if (!sink) {
                    perror(tmp_paths[i]);
                    _exit(1);
                }
                log_progress("parse_etrace worker %zu/%zu handling packets %zu..%zu", i + 1, jobs, base, end);
                parse_etrace_worker(path, packets, base, end, sink);
                fclose(sink);
                _exit(0);
            }
            launched += 1;
        }
        for (size_t i = 0; i < launched; i++) {
            int status = 0;
            if (waitpid(pids[i], &status, 0) < 0) {
                perror("waitpid");
                exit(1);
            }
            if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
                fprintf(stderr, "nqc2: parse_etrace worker %zu failed\n", i + 1);
                exit(1);
            }
        }
        for (size_t i = 0; i < launched; i++) {
            FILE *sink = fopen(tmp_paths[i], "rb");
            if (!sink) {
                perror(tmp_paths[i]);
                exit(1);
            }
            while (read_trace_chunk(sink, vec)) {
                ;
            }
            fclose(sink);
            unlink(tmp_paths[i]);
            free(tmp_paths[i]);
        }
        free(tmp_paths);
        free(pids);
        free(packets);
        log_progress("parsed %zu raw trace records", vec->len);
        return;
    }
}

static void parse_trace(const char *path, TraceVec *vec, size_t jobs)
{
    FILE *fp = fopen(path, "rb");
    unsigned char magic[5] = {0};
    if (!fp) {
        perror(path);
        exit(1);
    }
    fread(magic, 1, sizeof(magic), fp);
    fclose(fp);
    if (memcmp(magic, "NQC2 ", 5) == 0) {
        parse_text_trace(path, vec);
    } else {
        parse_etrace_trace(path, vec, jobs);
    }
    log_progress("parsed %zu raw trace records", vec->len);
}

static bool trace_is_text(const char *path)
{
    FILE *fp = fopen(path, "rb");
    unsigned char magic[5] = {0};
    if (!fp) {
        perror(path);
        exit(1);
    }
    fread(magic, 1, sizeof(magic), fp);
    fclose(fp);
    return memcmp(magic, "NQC2 ", 5) == 0;
}

static void load_symbols(const char *elf_path, SymbolVec *syms)
{
    /*
     * Runtime reduction strategy:
     * use direct libdwfl symbol-table access instead of spawning `nm`.
     */
    Dwfl *dwfl;
    Dwfl_Module *mod = NULL;
    int count;

    log_progress("loading symbols from %s", elf_path);
    dwfl = open_offline_dwfl(elf_path, &mod);
    if (!dwfl) {
        exit(1);
    }
    if (!mod) {
        fprintf(stderr, "no dwfl module found for %s\n", elf_path);
        dwfl_end(dwfl);
        exit(1);
    }
    count = dwfl_module_getsymtab(mod);
    for (int ndx = 1; ndx < count; ndx++) {
        GElf_Sym symbuf;
        GElf_Addr addr = 0;
        GElf_Word shndx = 0;
        Dwarf_Addr bias = 0;
        const char *name = dwfl_module_getsym_info(mod,
                                                   ndx,
                                                   &symbuf,
                                                   &addr,
                                                   &shndx,
                                                   NULL,
                                                   &bias);
        Symbol sym;
        (void) bias;
        (void) shndx;
        if (!name || !*name) {
            continue;
        }
        if (GELF_ST_TYPE(symbuf.st_info) != STT_FUNC) {
            continue;
        }
        if (symbuf.st_size == 0) {
            continue;
        }
        sym.start = (uint64_t) addr;
        sym.size = (uint64_t) symbuf.st_size;
        sym.name = xstrdup(name);
        symbol_vec_push(syms, sym);
        enforce_memory_limit("load_symbols", syms->len);
    }
    qsort(syms->items, syms->len, sizeof(*syms->items), symbol_cmp);
    log_progress("loaded %zu symbols", syms->len);
    dwfl_end(dwfl);
}

static const Symbol *find_symbol(const SymbolVec *syms, uint64_t addr)
{
    size_t lo = 0;
    size_t hi = syms->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        const Symbol *sym = &syms->items[mid];
        if (addr < sym->start) {
            hi = mid;
        } else if (addr >= sym->start + sym->size) {
            lo = mid + 1;
        } else {
            return sym;
        }
    }
    return NULL;
}

static void resolve_sources_chunk(const char *elf_path,
                                  const CoverageVec *coverage,
                                  size_t base,
                                  size_t end,
                                  FILE *sink,
                                  bool include_func)
{
    Dwfl *dwfl;
    Dwfl_Module *mod = NULL;
    size_t i;
    dwfl = open_offline_dwfl(elf_path, &mod);
    if (!dwfl || !mod) {
        fprintf(stderr, "failed to open dwfl for %s\n", elf_path);
        exit(1);
    }
    for (i = base; i < end; i++) {
        SourceLoc src = {0};
        Dwfl_Module *addr_mod;
        Dwfl_Line *line;
        const char *file = NULL;
        const char *func = "";
        GElf_Off sym_off = 0;
        GElf_Sym sym;
        GElf_Word shndx = 0;
        int lineno = 0;

        src.addr = coverage->items[i].addr;
        addr_mod = dwfl_addrmodule(dwfl, (Dwarf_Addr) coverage->items[i].addr);
        if (include_func && addr_mod) {
            const char *name = dwfl_module_addrinfo(addr_mod,
                                                    (GElf_Addr) coverage->items[i].addr,
                                                    &sym_off,
                                                    &sym,
                                                    &shndx,
                                                    NULL,
                                                    NULL);
            (void) sym_off;
            (void) sym;
            (void) shndx;
            if (name) {
                func = name;
            }
        }
        line = dwfl_getsrc(dwfl, (Dwarf_Addr) coverage->items[i].addr);
        if (line) {
            file = dwfl_lineinfo(line, NULL, &lineno, NULL, NULL, NULL);
        }
        src.func = xstrdup(func ? func : "");
        if (file && *file && lineno > 0) {
            src.file = xstrdup(file);
            src.line = (unsigned int) lineno;
        } else {
            src.file = xstrdup("??");
            src.line = 0;
        }
        write_source_record(sink, &src);
        free(src.func);
        free(src.file);
        if ((i - base + 1) % 4096 == 0 || i + 1 == end) {
            log_progress("resolved source batch %zu/%zu", i + 1, end);
        }
    }
    dwfl_end(dwfl);
}

static void resolve_sources(const char *elf_path,
                            const CoverageVec *coverage,
                            SourceVec *sources,
                            size_t jobs,
                            bool include_func)
{
    /*
     * Runtime reduction strategy:
     * resolve source locations in parallel worker processes so the remaining
     * per-run trace-dependent lookup stage can scale across cores.
     */
    size_t i;
    pid_t *pids;
    char **tmp_paths;
    size_t chunk;
    size_t launched = 0;
    if (coverage->len == 0) {
        return;
    }
    jobs = clamp_jobs(jobs);
    if (jobs > coverage->len) {
        jobs = coverage->len;
    }
    log_progress("resolving %zu covered addresses via direct DWARF lookup", coverage->len);
    pids = xcalloc(jobs, sizeof(*pids));
    tmp_paths = xcalloc(jobs, sizeof(*tmp_paths));
    chunk = (coverage->len + jobs - 1) / jobs;
    for (i = 0; i < jobs; i++) {
        size_t base = i * chunk;
        size_t end = base + chunk;
        int fd;
        if (base >= coverage->len) {
            break;
        }
        if (end > coverage->len) {
            end = coverage->len;
        }
        tmp_paths[i] = xstrdup("/tmp/nqc2-sources-XXXXXX");
        fd = mkstemp(tmp_paths[i]);
        if (fd < 0) {
            perror("mkstemp");
            exit(1);
        }
        close(fd);
        pids[i] = fork();
        if (pids[i] < 0) {
            perror("fork");
            exit(1);
        }
        if (pids[i] == 0) {
            FILE *fp = fopen(tmp_paths[i], "wb");
            if (!fp) {
                perror(tmp_paths[i]);
                _exit(1);
            }
            log_progress("resolve_sources worker %zu/%zu handling records %zu..%zu",
                         i + 1, jobs, base, end);
            resolve_sources_chunk(elf_path, coverage, base, end, fp, include_func);
            fclose(fp);
            _exit(0);
        }
        launched += 1;
    }

    for (i = 0; i < launched; i++) {
        int status = 0;
        if (waitpid(pids[i], &status, 0) < 0) {
            perror("waitpid");
            exit(1);
        }
        if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
            fprintf(stderr, "nqc2: resolve_sources worker %zu failed\n", i + 1);
            exit(1);
        }
    }

    for (i = 0; i < launched; i++) {
        FILE *fp = fopen(tmp_paths[i], "rb");
        if (!fp) {
            perror(tmp_paths[i]);
            exit(1);
        }
        while (read_source_record(fp, sources)) {
            enforce_memory_limit("resolve_sources", sources->len);
        }
        fclose(fp);
        unlink(tmp_paths[i]);
        free(tmp_paths[i]);
    }
    free(tmp_paths);
    free(pids);
    qsort(sources->items, sources->len, sizeof(*sources->items), source_cmp);
    log_progress("resolved %zu source locations", sources->len);
}

static const SourceLoc *find_source(const SourceVec *sources, uint64_t addr)
{
    size_t lo = 0;
    size_t hi = sources->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        const SourceLoc *src = &sources->items[mid];
        if (addr < src->addr) {
            hi = mid;
        } else if (addr > src->addr) {
            lo = mid + 1;
        } else {
            return src;
        }
    }
    return NULL;
}

static int trace_record_addr_cmp(const void *lhs, const void *rhs)
{
    const TraceRecord *a = lhs;
    const TraceRecord *b = rhs;
    if (a->start < b->start) {
        return -1;
    }
    if (a->start > b->start) {
        return 1;
    }
    if (a->end < b->end) {
        return -1;
    }
    if (a->end > b->end) {
        return 1;
    }
    return 0;
}

static size_t clamp_jobs(size_t jobs)
{
    if (jobs == 0) {
        return 1;
    }
    if (jobs > 8) {
        log_progress("capping requested jobs=%zu to 8", jobs);
        return 8;
    }
    return jobs;
}

static void build_coverage(TraceVec *records, CoverageVec *coverage, size_t jobs)
{
    size_t i;
    size_t len = records->len;
    if (len == 0) {
        return;
    }
    log_progress("building coverage from %zu merged trace ranges", len);
    /*
     * Runtime and memory reduction strategy:
     * sort merged trace ranges in place. The older design allocated a second
     * full-size copy before sorting, which raised peak RSS significantly on
     * large traces.
     */
    qsort(records->items, len, sizeof(*records->items), trace_record_addr_cmp);
    jobs = clamp_jobs(jobs);
    if (jobs > len) {
        jobs = len;
    }

    if (jobs == 1) {
        build_coverage_chunk(records->items, len, coverage);
        qsort(coverage->items, coverage->len, sizeof(*coverage->items), coverage_cmp);
        goto compact;
    }

    {
        pid_t *pids = xcalloc(jobs, sizeof(*pids));
        char **tmp_paths = xcalloc(jobs, sizeof(*tmp_paths));
        size_t chunk = (len + jobs - 1) / jobs;
        size_t launched = 0;

        for (i = 0; i < jobs; i++) {
            size_t start = i * chunk;
            size_t end = start + chunk;
            int fd;
            if (start >= len) {
                break;
            }
            if (end > len) {
                end = len;
            }
            tmp_paths[i] = xstrdup("/tmp/nqc2-coverage-XXXXXX");
            fd = mkstemp(tmp_paths[i]);
            if (fd < 0) {
                perror("mkstemp");
                exit(1);
            }
            close(fd);

            pids[i] = fork();
            if (pids[i] < 0) {
                perror("fork");
                exit(1);
            }
            if (pids[i] == 0) {
                FILE *fp;
                CoverageVec local = {0};
                fp = fopen(tmp_paths[i], "wb");
                if (!fp) {
                    perror(tmp_paths[i]);
                    _exit(1);
                }
                log_progress("build_coverage worker %zu/%zu handling records %zu..%zu",
                             i + 1, jobs, start, end);
                build_coverage_chunk(records->items + start, end - start, &local);
                uint64_t local_len = (uint64_t) local.len;
                if (fwrite(&local_len, sizeof(local_len), 1, fp) != 1 ||
                    fwrite(local.items, sizeof(*local.items), local.len, fp) != local.len) {
                    perror("fwrite");
                    fclose(fp);
                    _exit(1);
                }
                fclose(fp);
                coverage_vec_free(&local);
                _exit(0);
            }
            launched += 1;
        }

        for (i = 0; i < launched; i++) {
            int status = 0;
            if (waitpid(pids[i], &status, 0) < 0) {
                perror("waitpid");
                exit(1);
            }
            if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
                fprintf(stderr, "nqc2: coverage worker %zu failed\n", i + 1);
                exit(1);
            }
        }

        for (i = 0; i < launched; i++) {
            FILE *fp = fopen(tmp_paths[i], "rb");
            uint64_t local_len = 0;
            CoverageEntry *local_items;
            size_t old_len;
            size_t j;
            if (!fp) {
                perror(tmp_paths[i]);
                exit(1);
            }
            if (fread(&local_len, sizeof(local_len), 1, fp) != 1) {
                perror("fread");
                fclose(fp);
                exit(1);
            }
            old_len = coverage->len;
            coverage_vec_reserve(coverage, old_len + (size_t) local_len);
            local_items = xcalloc((size_t) local_len, sizeof(*local_items));
            if (fread(local_items, sizeof(*local_items), (size_t) local_len, fp) != (size_t) local_len) {
                perror("fread");
                free(local_items);
                fclose(fp);
                exit(1);
            }
            fclose(fp);
            for (j = 0; j < (size_t) local_len; j++) {
                coverage->items[coverage->len++] = local_items[j];
            }
            free(local_items);
            unlink(tmp_paths[i]);
            free(tmp_paths[i]);
        }
        free(tmp_paths);
        free(pids);
    }

    qsort(coverage->items, coverage->len, sizeof(*coverage->items), coverage_cmp);
compact:
    if (coverage->len > 0) {
        size_t dst = 0;
        for (i = 0; i < coverage->len; i++) {
            if (dst > 0 && coverage->items[dst - 1].addr == coverage->items[i].addr) {
                coverage->items[dst - 1].count += coverage->items[i].count;
            } else {
                coverage->items[dst++] = coverage->items[i];
            }
        }
        coverage->len = dst;
    }
    log_progress("coverage reduced to %zu unique instruction addresses", coverage->len);
}

static void write_trace_output(const char *path, const TraceVec *records, const SymbolVec *syms, const SourceVec *sources)
{
    FILE *fp;
    size_t i;
    if (path && strcmp(path, "none") == 0) {
        return;
    }
    fp = (!path || strcmp(path, "-") == 0) ? stdout : fopen(path, "w");
    if (!fp) {
        perror(path);
        exit(1);
    }
    for (i = 0; i < records->len; i++) {
        const Symbol *sym = syms ? find_symbol(syms, records->items[i].start) : NULL;
        const SourceLoc *src = sources ? find_source(sources, records->items[i].start) : NULL;
        fprintf(fp, "T vcpu=%u start=0x%" PRIx64 " end=0x%" PRIx64,
                records->items[i].vcpu, records->items[i].start, records->items[i].end);
        if (sym) {
            fprintf(fp, " symbol=%s", sym->name);
        }
        if (src && src->file && strcmp(src->file, "??") != 0 && src->line > 0) {
            fprintf(fp, " source=%s:%u", src->file, src->line);
        }
        fputc('\n', fp);
    }
    if (fp != stdout) {
        fclose(fp);
    }
}

static void write_coverage_etrace(const char *path, const CoverageVec *coverage, const SymbolVec *syms, const SourceVec *sources)
{
    FILE *fp = fopen(path, "w");
    size_t i;
    if (!fp) {
        perror(path);
        exit(1);
    }
    for (i = 0; i < coverage->len; i++) {
        const Symbol *sym = syms ? find_symbol(syms, coverage->items[i].addr) : NULL;
        const SourceLoc *src = sources ? find_source(sources, coverage->items[i].addr) : NULL;
        fprintf(fp, "%" PRIu64 " %" PRIx64 " %s %s:%u\n",
                coverage->items[i].count,
                coverage->items[i].addr,
                sym ? sym->name : "unknown",
                src && src->file ? src->file : "unknown",
                src ? src->line : 0);
    }
    fclose(fp);
}

static size_t match_file_index(const FileCoverageVec *files,
                               const char *elf_dir,
                               const char *source_path)
{
    char *normalized = NULL;
    char *relative = NULL;
    size_t idx = (size_t) -1;
    size_t elf_dir_len;
    size_t i;

    if (!source_path || !*source_path) {
        return (size_t) -1;
    }
    normalized = normalize_source_path(source_path);
    for (i = 0; i < files->len; i++) {
        if (strcmp(files->items[i].path, normalized) == 0) {
            free(normalized);
            return i;
        }
    }
    elf_dir_len = strlen(elf_dir);
    if (normalized[0] == '/' &&
        strncmp(normalized, elf_dir, elf_dir_len) == 0 &&
        normalized[elf_dir_len] == '/') {
        relative = xstrdup(normalized + elf_dir_len + 1);
        for (i = 0; i < files->len; i++) {
            if (strcmp(files->items[i].path, relative) == 0) {
                idx = i;
                break;
            }
        }
        free(relative);
    }
    free(normalized);
    return idx;
}

static int function_die_callback(Dwarf_Die *funcdie, void *arg)
{
    FunctionBuildContext *ctx = arg;
    const char *name;
    const char *file;
    int line = 0;
    Dwarf_Addr lowpc = 0;
    Dwarf_Addr highpc = 0;
    size_t file_idx;
    FunctionRange range;

    name = dwarf_diename(funcdie);
    if (!name || !*name) {
        return DWARF_CB_OK;
    }
    file = dwarf_decl_file(funcdie);
    if (!file || !*file) {
        return DWARF_CB_OK;
    }
    if (dwarf_decl_line(funcdie, &line) != 0 || line <= 0) {
        return DWARF_CB_OK;
    }
    if (dwarf_lowpc(funcdie, &lowpc) != 0 || dwarf_highpc(funcdie, &highpc) != 0) {
        return DWARF_CB_OK;
    }
    if (highpc <= lowpc) {
        return DWARF_CB_OK;
    }

    file_idx = match_file_index(ctx->files, ctx->elf_dir, file);
    if (file_idx == (size_t) -1) {
        return DWARF_CB_OK;
    }
    range.start = (uint64_t) lowpc;
    range.end = (uint64_t) highpc;
    range.file_idx = (uint32_t) file_idx;
    range.line = (unsigned int) line;
    range.count = 0;
    range.name = xstrdup(name);
    function_range_vec_push(ctx->ranges, range);
    return DWARF_CB_OK;
}

static void build_function_coverage(const char *elf_path,
                                    const FileCoverageVec *files,
                                    FunctionRangeVec *ranges)
{
    /*
     * Runtime reduction strategy:
     * build function metadata directly from DWARF subprogram DIEs. That avoids
     * a second full address-to-source pass over every function entry and
     * produces the stable function-range metadata reused by warm runs. The
     * function side is already interval/range-based, so per-run trace handling
     * only has to intersect execution ranges with cached function ranges.
     */
    int fd;
    Elf *elf;
    Dwarf *dbg;
    Dwarf_Off off = 0;
    char *elf_dir = build_elf_dir(elf_path);
    FunctionBuildContext ctx = {
        .files = files,
        .ranges = ranges,
        .elf_dir = elf_dir,
    };
    size_t i;

    if (elf_version(EV_CURRENT) == EV_NONE) {
        fprintf(stderr, "elf_version failed\n");
        free(elf_dir);
        exit(1);
    }
    fd = open(elf_path, O_RDONLY);
    if (fd < 0) {
        perror(elf_path);
        free(elf_dir);
        exit(1);
    }
    elf = elf_begin(fd, ELF_C_READ, NULL);
    if (!elf) {
        fprintf(stderr, "elf_begin failed for %s\n", elf_path);
        close(fd);
        free(elf_dir);
        exit(1);
    }
    dbg = dwarf_begin_elf(elf, DWARF_C_READ, NULL);
    if (!dbg) {
        fprintf(stderr, "dwarf_begin_elf failed for %s\n", elf_path);
        elf_end(elf);
        close(fd);
        free(elf_dir);
        exit(1);
    }
    while (1) {
        Dwarf_Off next_off = 0;
        size_t hsize = 0;
        Dwarf_Off abbrev_offset = 0;
        uint8_t address_size = 0;
        uint8_t offset_size = 0;
        Dwarf_Die cudie_mem;
        Dwarf_Die *cudie;
        int rc = dwarf_nextcu(dbg,
                              off,
                              &next_off,
                              &hsize,
                              &abbrev_offset,
                              &address_size,
                              &offset_size);
        (void) abbrev_offset;
        (void) address_size;
        (void) offset_size;
        if (rc < 0) {
            fprintf(stderr, "dwarf_nextcu failed for %s\n", elf_path);
            dwarf_end(dbg);
            elf_end(elf);
            close(fd);
            free(elf_dir);
            exit(1);
        }
        if (rc > 0) {
            break;
        }
        cudie = dwarf_offdie(dbg, off + hsize, &cudie_mem);
        if (cudie) {
            (void) dwarf_getfuncs(cudie, function_die_callback, &ctx, 0);
        }
        off = next_off;
    }
    dwarf_end(dbg);
    elf_end(elf);
    close(fd);
    dedupe_function_ranges(ranges);
    if (ranges->len > 1) {
        qsort(ranges->items, ranges->len, sizeof(*ranges->items), function_range_start_cmp);
    }
    free(elf_dir);
}

static void write_function_ranges_cache(FILE *fp, const FunctionRangeVec *ranges)
{
    uint64_t count = (uint64_t) ranges->len;
    if (fwrite(&count, sizeof(count), 1, fp) != 1) {
        perror("fwrite");
        exit(1);
    }
    for (size_t i = 0; i < ranges->len; i++) {
        FunctionRangeDiskRecord disk = {
            .start = ranges->items[i].start,
            .end = ranges->items[i].end,
            .file_idx = ranges->items[i].file_idx,
            .line = ranges->items[i].line,
            .count = ranges->items[i].count,
            .name_len = (uint32_t) strlen(ranges->items[i].name),
        };
        if (fwrite(&disk, sizeof(disk), 1, fp) != 1) {
            perror("fwrite");
            exit(1);
        }
        if (disk.name_len > 0 &&
            fwrite(ranges->items[i].name, 1, disk.name_len, fp) != disk.name_len) {
            perror("fwrite");
            exit(1);
        }
    }
}

static int read_function_ranges_cache(FILE *fp, FunctionRangeVec *ranges)
{
    uint64_t count = 0;
    if (fread(&count, sizeof(count), 1, fp) != 1) {
        return 0;
    }
    for (size_t i = 0; i < (size_t) count; i++) {
        FunctionRangeDiskRecord disk;
        FunctionRange range;
        if (fread(&disk, sizeof(disk), 1, fp) != 1) {
            return 0;
        }
        range.start = disk.start;
        range.end = disk.end;
        range.file_idx = disk.file_idx;
        range.line = disk.line;
        range.count = disk.count;
        range.name = xcalloc((size_t) disk.name_len + 1, 1);
        if (disk.name_len > 0 &&
            fread(range.name, 1, disk.name_len, fp) != disk.name_len) {
            free(range.name);
            return 0;
        }
        function_range_vec_push(ranges, range);
    }
    return 1;
}

static void write_coverage_lcov(const char *path,
                                const char *elf_path,
                                const CoverageVec *coverage,
                                const SourceVec *sources,
                                size_t jobs)
{
    FileCoverageVec files = {0};
    FunctionRangeVec functions = {0};
    AddrMapVec map = {0};
    log_progress("writing lcov output to %s", path);
    if (!elf_path) {
        return;
    }
    (void) sources;
    build_exec_map(elf_path, &files, &map);
    for (size_t i = 0; i < coverage->len; i++) {
        apply_exec_range(&files, &map, coverage->items[i].addr, coverage->items[i].addr + 4);
    }
    build_function_coverage(elf_path, &files, &functions);
    reconcile_function_counts_from_lines(&files, &map, &functions);
    emit_lcov_from_files(path, elf_path, &files, &functions);
    addr_map_free(&map);
    function_range_vec_free(&functions);
    file_coverage_free(&files);
}

static void write_coverage_lcov_streamed(const char *path,
                                         const char *trace_path,
                                         const char *elf_path,
                                         size_t jobs)
{
    FileCoverageVec files = {0};
    FunctionRangeVec functions = {0};
    AddrMapVec map = {0};
    char *exec_map_cache = NULL;
    char *function_cache = NULL;

    /*
     * Existing runtime-reduction strategies in this path:
     * 1. persist stable metadata per vmlinux:
     *    - exec-map cache
     *    - function-range cache
     * 2. keep the binary-trace LCOV path streamed so warm runs mostly do trace
     *    handling plus LCOV emission, not full DWARF reconstruction
     * 3. update final line/function counters directly from the streamed trace
     *    instead of retaining a full TraceVec or a giant long-lived CoverageVec
     * 4. use cached interval metadata for lines and functions so the hot path
     *    is mostly trace overlap plus report emission
     *
     * If memory grows again, avoid reintroducing a full raw-trace in-memory
     * representation here. Prefer keeping worker outputs compact and
     * range-based, or streaming directly into the final counters. If runtime
     * grows again, focus first on trace-stage overlap cost and dense LCOV emit
     * cost before adding more metadata rebuild work.
     */
    log_progress("writing lcov output to %s", path);
    if (!elf_path) {
        return;
    }
    exec_map_cache = build_exec_map_cache_path(elf_path);
    function_cache = build_function_ranges_cache_path(elf_path);
    {
        FILE *fp = fopen(exec_map_cache, "rb");
        int loaded = 0;
        if (fp) {
            loaded = read_exec_map_cache(fp, &files, &map);
            fclose(fp);
        }
        if (!loaded) {
            build_exec_map(elf_path, &files, &map);
            fp = fopen(exec_map_cache, "wb");
            if (fp) {
                write_exec_map_cache(fp, &files, &map);
                fclose(fp);
            }
        } else {
            log_progress("loaded exec map cache %s", exec_map_cache);
        }
    }
    {
        FILE *fp = fopen(function_cache, "rb");
        int loaded = 0;
        if (fp) {
            loaded = read_function_ranges_cache(fp, &functions);
            fclose(fp);
        }
        if (!loaded) {
            build_function_coverage(elf_path, &files, &functions);
            fp = fopen(function_cache, "wb");
            if (fp) {
                write_function_ranges_cache(fp, &functions);
                fclose(fp);
            }
        } else {
            log_progress("loaded function range cache %s", function_cache);
        }
    }
    parse_etrace_trace_lcov_functions_parallel(trace_path, &files, &map, &functions, jobs);
    reconcile_function_counts_from_lines(&files, &map, &functions);
    emit_lcov_from_files(path, elf_path, &files, &functions);
    function_range_vec_free(&functions);
    addr_map_free(&map);
    file_coverage_free(&files);
    free(exec_map_cache);
    free(function_cache);
}

static char *read_file(const char *path, size_t *out_len)
{
    FILE *fp = fopen(path, "r");
    char *buf;
    size_t len;
    if (!fp) {
        return NULL;
    }
    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        return NULL;
    }
    len = (size_t) ftell(fp);
    if (fseek(fp, 0, SEEK_SET) != 0) {
        fclose(fp);
        return NULL;
    }
    buf = xcalloc(len + 1, 1);
    if (len > 0 && fread(buf, 1, len, fp) != len) {
        fclose(fp);
        free(buf);
        return NULL;
    }
    fclose(fp);
    if (out_len) {
        *out_len = len;
    }
    return buf;
}

static bool elf_has_debug_lines(const char *elf_path)
{
    char *command = NULL;
    FILE *pipe;
    char line[4096];
    bool found = false;

    if (asprintf(&command, "readelf -S %s", elf_path) < 0) {
        perror("asprintf");
        exit(1);
    }
    pipe = popen(command, "r");
    free(command);
    if (!pipe) {
        perror("popen readelf");
        exit(1);
    }
    while (fgets(line, sizeof(line), pipe)) {
        if (strstr(line, ".debug_line") || strstr(line, ".debug_info")) {
            found = true;
            break;
        }
    }
    pclose(pipe);
    return found;
}

static void ensure_dir(const char *path)
{
    char *copy = xstrdup(path);
    char *slash = strrchr(copy, '/');
    if (slash) {
        *slash = '\0';
        if (*copy) {
            char command[4096];
            snprintf(command, sizeof(command), "mkdir -p '%s'", copy);
            if (system(command) != 0) {
                fprintf(stderr, "failed to create directory for %s\n", path);
                exit(1);
            }
        }
    }
    free(copy);
}

static unsigned int derive_function_end_line(const char *source_text,
                                             unsigned int start_line,
                                             unsigned int end_hint)
{
    const char *cursor = source_text;
    unsigned int line_no = 1;
    bool saw_open = false;
    int depth = 0;

    if (!source_text || !*source_text || start_line == 0 || end_hint < start_line) {
        return end_hint;
    }
    while (cursor && *cursor && line_no < start_line) {
        cursor = strchr(cursor, '\n');
        if (cursor) {
            cursor += 1;
            line_no += 1;
        }
    }
    while (cursor && *cursor && line_no <= end_hint) {
        const char *end = strchr(cursor, '\n');
        size_t width = end ? (size_t) (end - cursor) : strlen(cursor);
        for (size_t i = 0; i < width; i++) {
            char ch = cursor[i];
            if (ch == '{') {
                depth += 1;
                saw_open = true;
            } else if (ch == '}' && saw_open) {
                depth -= 1;
                if (depth <= 0) {
                    return line_no;
                }
            }
        }
        if (!end) {
            break;
        }
        cursor = end + 1;
        line_no += 1;
    }
    return end_hint;
}

static void build_html_report(const char *lcov_path, const char *output_dir, const char *title)
{
    FILE *fp = fopen(lcov_path, "r");
    char line[8192];
    char *current_file = NULL;
    FileLineVec lines = {0};
    char command[4096];
    FILE *index;
    size_t file_index = 0;
    unsigned int current_lf = 0;
    unsigned int current_lh = 0;
    bool have_lf_lh = false;

    if (!fp) {
        perror(lcov_path);
        exit(1);
    }
    log_progress("generating html from %s into %s", lcov_path, output_dir);
    snprintf(command, sizeof(command), "mkdir -p '%s'", output_dir);
    if (system(command) != 0) {
        fprintf(stderr, "failed to create %s\n", output_dir);
        exit(1);
    }
    snprintf(command, sizeof(command), "%s/index.html", output_dir);
    index = fopen(command, "w");
    if (!index) {
        perror(command);
        exit(1);
    }
    fprintf(index, "<html><head><title>%s</title><style>body{font-family:sans-serif} table{border-collapse:collapse} td,th{padding:0.25rem 0.5rem;border:1px solid #ccc}</style></head><body><h1>%s</h1><table><tr><th>File</th><th>Hit</th><th>Total</th><th>Percent</th></tr>\n",
            title, title);
    while (fgets(line, sizeof(line), fp)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strncmp(line, "SF:", 3) == 0) {
            free(current_file);
            current_file = xstrdup(line + 3);
            continue;
        }
        if (strncmp(line, "DA:", 3) == 0 && current_file) {
            unsigned int lineno = 0;
            uint64_t count = 0;
            if (sscanf(line + 3, "%u,%" SCNu64, &lineno, &count) == 2) {
                file_line_vec_push(&lines, current_file, lineno, count);
                enforce_memory_limit("build_html_report", lines.len);
            }
            continue;
        }
        if (strncmp(line, "LF:", 3) == 0 && current_file) {
            current_lf = (unsigned int) strtoul(line + 3, NULL, 10);
            have_lf_lh = true;
            continue;
        }
        if (strncmp(line, "LH:", 3) == 0 && current_file) {
            current_lh = (unsigned int) strtoul(line + 3, NULL, 10);
            have_lf_lh = true;
            continue;
        }
        if (strcmp(line, "end_of_record") == 0 && current_file) {
            size_t i;
            unsigned int total = 0;
            unsigned int hit = 0;
            char page[64];
            char outpath[4096];
            FILE *page_fp;
            size_t source_len = 0;
            char *source_text = read_file(current_file, &source_len);
            char percent_text[32];
            snprintf(page, sizeof(page), "%04zu.html", file_index++);
            snprintf(outpath, sizeof(outpath), "%s/%s", output_dir, page);
            page_fp = fopen(outpath, "w");
            if (!page_fp) {
                perror(outpath);
                exit(1);
            }
            fprintf(page_fp, "<html><head><title>%s - %s</title><style>body{font-family:monospace} .hit{background:#d7ffd7} .miss{background:#ffd7d7} table{border-collapse:collapse} td{padding:0 0.5rem;vertical-align:top}</style></head><body><h1>%s</h1><table>\n",
                    title, current_file, current_file);
            qsort(lines.items, lines.len, sizeof(*lines.items), file_line_cmp);
            for (i = 0; i < lines.len; i++) {
                char *src_line = NULL;
                char *cursor;
                unsigned int line_no;
                if (strcmp(lines.items[i].path, current_file) != 0) {
                    continue;
                }
                total += 1;
                if (lines.items[i].count > 0) {
                    hit += 1;
                }
                cursor = source_text;
                for (line_no = 1; cursor && *cursor && line_no < lines.items[i].line; line_no++) {
                    cursor = strchr(cursor, '\n');
                    if (cursor) {
                        cursor += 1;
                    }
                }
                if (cursor) {
                    char *end = strchr(cursor, '\n');
                    size_t width = end ? (size_t) (end - cursor) : strlen(cursor);
                    src_line = xcalloc(width + 1, 1);
                    memcpy(src_line, cursor, width);
                }
                fprintf(page_fp,
                        "<tr class=\"%s\"><td>%u</td><td>%" PRIu64 "</td><td><pre>%s</pre></td></tr>\n",
                        lines.items[i].count > 0 ? "hit" : "miss",
                        lines.items[i].line,
                        lines.items[i].count,
                        src_line ? src_line : "");
                free(src_line);
            }
            fprintf(page_fp, "</table></body></html>\n");
            fclose(page_fp);
            if (have_lf_lh && current_lf > 0) {
                snprintf(percent_text, sizeof(percent_text), "%.1f%%", 100.0 * current_lh / current_lf);
            } else {
                snprintf(percent_text, sizeof(percent_text), "n/a");
            }
            fprintf(index,
                    "<tr><td><a href=\"%s\">%s</a></td><td>%u</td><td>%u</td><td>%s</td></tr>\n",
                    page,
                    current_file,
                    have_lf_lh ? current_lh : hit,
                    have_lf_lh ? current_lf : total,
                    percent_text);
            free(source_text);
            free(current_file);
            current_file = NULL;
            current_lf = 0;
            current_lh = 0;
            have_lf_lh = false;
        }
    }
    fprintf(index, "</table></body></html>\n");
    fclose(index);
    fclose(fp);
    log_progress("html report written to %s/index.html", output_dir);
    free(current_file);
    file_line_vec_free(&lines);
}

typedef struct {
    const char *trace;
    const char *elf;
    const char *trace_output;
    const char *coverage_output;
    const char *coverage_format;
    size_t jobs;
} PostprocessArgs;

static void usage(void)
{
    fprintf(stderr, "Usage:\n");
    fprintf(stderr, "  nqc2 postprocess --trace PATH [--elf ELF] [--trace-output PATH|none] [--coverage-output PATH] [--coverage-format etrace|lcov|none]\n");
    fprintf(stderr, "  nqc2 genhtml --lcov PATH --output DIR [--title TITLE]\n");
}

static int do_postprocess(int argc, char **argv)
{
    PostprocessArgs args = {0};
    TraceVec records = {0};
    CoverageVec coverage = {0};
    SymbolVec syms = {0};
    SourceVec sources = {0};
    FileCoverageVec files = {0};
    AddrMapVec map = {0};
    int i;

    args.trace_output = "-";
    args.coverage_format = "none";
    args.jobs = 1;
    for (i = 0; i < argc; i++) {
        if (strcmp(argv[i], "--trace") == 0 && i + 1 < argc) {
            args.trace = argv[++i];
        } else if (strcmp(argv[i], "--elf") == 0 && i + 1 < argc) {
            args.elf = argv[++i];
        } else if (strcmp(argv[i], "--trace-output") == 0 && i + 1 < argc) {
            args.trace_output = argv[++i];
        } else if (strcmp(argv[i], "--coverage-output") == 0 && i + 1 < argc) {
            args.coverage_output = argv[++i];
        } else if (strcmp(argv[i], "--coverage-format") == 0 && i + 1 < argc) {
            args.coverage_format = argv[++i];
        } else if (strcmp(argv[i], "--jobs") == 0 && i + 1 < argc) {
            args.jobs = (size_t) strtoull(argv[++i], NULL, 10);
        } else if (strcmp(argv[i], "-j") == 0 && i + 1 < argc) {
            args.jobs = (size_t) strtoull(argv[++i], NULL, 10);
        } else if (strncmp(argv[i], "-j", 2) == 0 && argv[i][2] != '\0') {
            args.jobs = (size_t) strtoull(argv[i] + 2, NULL, 10);
        }
    }
    if (!args.trace) {
        usage();
        return 1;
    }

    if ((!args.trace_output || strcmp(args.trace_output, "none") == 0) &&
        args.coverage_output &&
        strcmp(args.coverage_format, "lcov") == 0 &&
        !trace_is_text(args.trace)) {
        log_progress("postprocess started");
        if (args.elf && !elf_has_debug_lines(args.elf)) {
            log_progress("elf %s has no DWARF line info; lcov output will be empty", args.elf);
            FILE *fp = fopen(args.coverage_output, "w");
            if (!fp) {
                perror(args.coverage_output);
                exit(1);
            }
            fclose(fp);
            log_progress("postprocess finished");
            return 0;
        }
        write_coverage_lcov_streamed(args.coverage_output, args.trace, args.elf, args.jobs);
        log_progress("postprocess finished");
        return 0;
    }

    log_progress("postprocess started");
    parse_trace(args.trace, &records, args.jobs);
    merge_records_parallel(&records, args.jobs);
    if (args.elf && (strcmp(args.coverage_format, "etrace") == 0 ||
                     (args.trace_output && strcmp(args.trace_output, "none") != 0))) {
        load_symbols(args.elf, &syms);
    }
    if (strcmp(args.coverage_format, "none") != 0 && coverage.len == 0) {
        build_coverage(&records, &coverage, args.jobs);
    }
    if (!args.trace_output || strcmp(args.trace_output, "none") == 0) {
        trace_vec_free(&records);
    }
    if (args.elf && strcmp(args.coverage_format, "lcov") == 0 && !elf_has_debug_lines(args.elf)) {
        log_progress("elf %s has no DWARF line info; lcov output will be empty", args.elf);
        if (args.coverage_output) {
            FILE *fp = fopen(args.coverage_output, "w");
            if (!fp) {
                perror(args.coverage_output);
                exit(1);
            }
            fclose(fp);
        }
        trace_vec_free(&records);
        symbol_vec_free(&syms);
        coverage_vec_free(&coverage);
        log_progress("postprocess finished");
        return 0;
    }
    if (args.elf && coverage.len > 0) {
        resolve_sources(args.elf,
                        &coverage,
                        &sources,
                        args.jobs,
                        strcmp(args.coverage_format, "etrace") == 0 || (args.trace_output && strcmp(args.trace_output, "none") != 0));
    }
    write_trace_output(args.trace_output, &records, args.elf ? &syms : NULL, sources.len > 0 ? &sources : NULL);
    if (strcmp(args.coverage_format, "lcov") == 0) {
        symbol_vec_free(&syms);
    }
    if (args.coverage_output && strcmp(args.coverage_format, "etrace") == 0) {
        write_coverage_etrace(args.coverage_output, &coverage, args.elf ? &syms : NULL, sources.len > 0 ? &sources : NULL);
    } else if (args.coverage_output && strcmp(args.coverage_format, "lcov") == 0) {
        write_coverage_lcov(args.coverage_output, args.elf, &coverage, &sources, args.jobs);
    }
    source_vec_free(&sources);
    if (strcmp(args.coverage_format, "etrace") == 0 ||
        (args.trace_output && strcmp(args.trace_output, "none") != 0)) {
        symbol_vec_free(&syms);
    }
    coverage_vec_free(&coverage);
    if (records.items) {
        trace_vec_free(&records);
    }
    log_progress("postprocess finished");
    return 0;
}

static int do_genhtml(int argc, char **argv)
{
    const char *lcov = NULL;
    const char *output = NULL;
    const char *title = "NQC2 Coverage";
    int i;
    for (i = 0; i < argc; i++) {
        if (strcmp(argv[i], "--lcov") == 0 && i + 1 < argc) {
            lcov = argv[++i];
        } else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            output = argv[++i];
        } else if (strcmp(argv[i], "--title") == 0 && i + 1 < argc) {
            title = argv[++i];
        }
    }
    if (!lcov || !output) {
        usage();
        return 1;
    }
    log_progress("genhtml started");
    build_html_report(lcov, output, title);
    log_progress("genhtml finished");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "genhtml") == 0) {
        return do_genhtml(argc - 2, argv + 2);
    }
    if (argc >= 2 && strcmp(argv[1], "postprocess") == 0) {
        return do_postprocess(argc - 2, argv + 2);
    }
    return do_postprocess(argc - 1, argv + 1);
}
