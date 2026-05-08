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
    uint64_t addr;
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
    unsigned int line;
    size_t index;
} LineIndex;

#define NQC2_MEM_LIMIT_KB (8ULL * 1024ULL * 1024ULL)
#define NQC2_MEM_CHECK_INTERVAL 100000000U

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
    (void) phase;
    (void) progress;
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
    if (a->addr < b->addr) {
        return -1;
    }
    if (a->addr > b->addr) {
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
    LineIndex probe = {.line = line, .index = 0};
    void *slot = tfind(&probe, (void * const *) &file->line_root, line_index_cmp);
    if (slot) {
        return (*(LineIndex **) slot)->index;
    }
    return (size_t) -1;
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

static void load_executable_lines(const char *elf_path, FileLineVec *lines)
{
    char *elf_dir = NULL;
    char *elf_abs = NULL;
    char *command = NULL;
    FILE *pipe;
    char row[8192];
    char *slash;
    char *current_unit = NULL;
    size_t decoded_rows = 0;
    size_t pushed_lines = 0;

    elf_abs = realpath(elf_path, NULL);
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

    if (asprintf(&command, "readelf --debug-dump=decodedline %s", elf_path) < 0) {
        perror("asprintf");
        exit(1);
    }
    pipe = popen(command, "r");
    free(command);
    if (!pipe) {
        perror("popen readelf");
        exit(1);
    }

    while (fgets(row, sizeof(row), pipe)) {
        char copy[8192];
        char *saveptr = NULL;
        char *tokens[8] = {0};
        size_t ntokens = 0;
        char *token;
        unsigned int line_no;
        char *candidate = NULL;
        char *normalized = NULL;
        char *unit_dir = NULL;

        row[strcspn(row, "\r\n")] = '\0';
        if (!*row || strstr(row, "File name") || strstr(row, "Contents of")) {
            continue;
        }
        if (row[strlen(row) - 1] == ':') {
            free(current_unit);
            row[strlen(row) - 1] = '\0';
            current_unit = xstrdup(row);
            continue;
        }
        strncpy(copy, row, sizeof(copy) - 1);
        copy[sizeof(copy) - 1] = '\0';
        token = strtok_r(copy, " \t", &saveptr);
        while (token && ntokens < 8) {
            tokens[ntokens++] = token;
            token = strtok_r(NULL, " \t", &saveptr);
        }
        if (ntokens < 3) {
            continue;
        }
        if (strncmp(tokens[2], "0x", 2) != 0) {
            continue;
        }
        line_no = (unsigned int) strtoul(tokens[1], NULL, 10);
        if (line_no == 0) {
            continue;
        }
        decoded_rows += 1;
        if (tokens[0][0] == '/') {
            candidate = xstrdup(tokens[0]);
        } else if (strchr(tokens[0], '/')) {
            if (asprintf(&candidate, "%s/%s", elf_dir, tokens[0]) < 0) {
                perror("asprintf");
                exit(1);
            }
        } else if (current_unit && strchr(current_unit, '/')) {
            unit_dir = xstrdup(current_unit);
            slash = strrchr(unit_dir, '/');
            if (slash) {
                *slash = '\0';
            } else {
                strcpy(unit_dir, ".");
            }
            if (strcmp(basename_ptr(current_unit), tokens[0]) == 0) {
                candidate = xstrdup(current_unit);
            } else {
                if (asprintf(&candidate, "%s/%s", unit_dir, tokens[0]) < 0) {
                    perror("asprintf");
                    exit(1);
                }
            }
            free(unit_dir);
            unit_dir = NULL;
        }
        if (candidate) {
            normalized = normalize_source_path(candidate);
            file_line_vec_push(lines, normalized, line_no, 0);
            pushed_lines += 1;
            free(candidate);
            free(normalized);
        }
        if (decoded_rows % NQC2_MEM_CHECK_INTERVAL == 0) {
            log_progress("load_executable_lines rows=%zu raw_lines=%zu", decoded_rows, pushed_lines);
            enforce_memory_limit("load_executable_lines", decoded_rows);
        }
    }
    pclose(pipe);
    free(current_unit);
    free(elf_dir);
    log_progress("load_executable_lines collected %zu raw executable lines", pushed_lines);
    dedupe_file_lines(lines);
    log_progress("loaded %zu executable source lines from DWARF", lines->len);
}

static void build_exec_map(const char *elf_path, FileCoverageVec *files, AddrMapVec *map)
{
    char *elf_dir = build_elf_dir(elf_path);
    char *command = NULL;
    FILE *pipe;
    char row[8192];
    char *current_unit = NULL;
    char *current_unit_dir = NULL;
    char *last_token_path = NULL;
    size_t last_file_index = (size_t) -1;
    void *path_root = NULL;
    size_t decoded_rows = 0;

    if (asprintf(&command, "readelf --debug-dump=decodedline %s", elf_path) < 0) {
        perror("asprintf");
        exit(1);
    }
    pipe = popen(command, "r");
    free(command);
    if (!pipe) {
        perror("popen readelf");
        exit(1);
    }

    while (fgets(row, sizeof(row), pipe)) {
        char file_buf[4096];
        unsigned int line_no;
        uint64_t addr;
        bool is_stmt;
        char *candidate = NULL;
        char *normalized = NULL;
        PathIndex probe;
        void *slot;
        size_t file_index;
        FileCoverage *file;
        AddrMapEntry entry;

        row[strcspn(row, "\r\n")] = '\0';
        if (!*row || strstr(row, "File name") || strstr(row, "Contents of")) {
            continue;
        }
        if (row[strlen(row) - 1] == ':') {
            free(current_unit);
            free(current_unit_dir);
            row[strlen(row) - 1] = '\0';
            current_unit = xstrdup(row);
            current_unit_dir = NULL;
            if (strchr(current_unit, '/')) {
                current_unit_dir = xstrdup(current_unit);
                char *slash = strrchr(current_unit_dir, '/');
                if (slash) {
                    *slash = '\0';
                } else {
                    strcpy(current_unit_dir, ".");
                }
            }
            continue;
        }
        if (!parse_decodedline_row(row, file_buf, sizeof(file_buf), &line_no, &addr, &is_stmt)) {
            continue;
        }
        if (!is_stmt) {
            continue;
        }
        decoded_rows += 1;
        if (last_token_path && strcmp(last_token_path, file_buf) == 0) {
            file_index = last_file_index;
        } else {
            if (file_buf[0] == '/') {
                candidate = xstrdup(file_buf);
            } else if (strchr(file_buf, '/')) {
                if (asprintf(&candidate, "%s/%s", elf_dir, file_buf) < 0) {
                    perror("asprintf");
                    exit(1);
                }
            } else if (current_unit_dir) {
                if (strcmp(basename_ptr(current_unit), file_buf) == 0) {
                    candidate = xstrdup(current_unit);
                } else if (asprintf(&candidate, "%s/%s", current_unit_dir, file_buf) < 0) {
                    perror("asprintf");
                    exit(1);
                }
            } else {
                continue;
            }
            normalized = normalize_source_path(candidate);
            free(candidate);

            probe.path = normalized;
            slot = tfind(&probe, &path_root, path_index_cmp);
            if (!slot) {
                PathIndex *node = xcalloc(1, sizeof(*node));
                FileCoverage new_file = {0};
                node->path = normalized;
                node->index = files->len;
                new_file.path = normalized;
                file_coverage_push(files, new_file);
                if (!tsearch(node, &path_root, path_index_cmp)) {
                    perror("tsearch");
                    exit(1);
                }
                file_index = node->index;
            } else {
                file_index = (*(PathIndex **) slot)->index;
                free(normalized);
            }
            free(last_token_path);
            last_token_path = xstrdup(file_buf);
            last_file_index = file_index;
        }

        file = &files->items[file_index];
        file_coverage_add_line(file, line_no);
        entry.addr = addr;
        entry.file_idx = (uint32_t) file_index;
        entry.line = line_no;
        entry.count = 0;
        addr_map_push(map, entry);

        if (decoded_rows % NQC2_MEM_CHECK_INTERVAL == 0) {
            log_progress("build_exec_map rows=%zu files=%zu addrs=%zu", decoded_rows, files->len, map->len);
            enforce_memory_limit("build_exec_map", decoded_rows);
        }
    }
    pclose(pipe);
    free(current_unit);
    free(current_unit_dir);
    free(last_token_path);
    free(elf_dir);

    qsort(map->items, map->len, sizeof(*map->items), addr_map_addr_cmp);
    if (map->len > 0) {
        size_t src;
        size_t dst = 0;
        for (src = 0; src < map->len; src++) {
            if (dst > 0 &&
                map->items[dst - 1].addr == map->items[src].addr &&
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

    log_progress("build_exec_map finished files=%zu addresses=%zu", files->len, map->len);
}

static size_t addr_map_lower_bound(const AddrMapVec *map, uint64_t addr)
{
    size_t lo = 0;
    size_t hi = map->len;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (map->items[mid].addr < addr) {
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
    while (idx < map->len && map->items[idx].addr < end) {
        FileCoverage *file = &files->items[map->items[idx].file_idx];
        size_t line_idx = find_line_index(file, map->items[idx].line);
        if (line_idx != (size_t) -1) {
            file->counts[line_idx] += 1;
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

static void emit_lcov_from_files(const char *path, const FileCoverageVec *files)
{
    FILE *fp = fopen(path, "w");
    if (!fp) {
        perror(path);
        exit(1);
    }
    for (size_t i = 0; i < files->len; i++) {
        unsigned int lh = 0;
        fprintf(fp, "TN:\nSF:%s\n", files->items[i].path);
        for (size_t j = 0; j < files->items[i].len; j++) {
            if (files->items[i].counts[j] > 0) {
                lh += 1;
            }
            fprintf(fp, "DA:%u,%" PRIu64 "\n", files->items[i].lines[j], files->items[i].counts[j]);
        }
        fprintf(fp, "LF:%zu\nLH:%u\nend_of_record\n", files->items[i].len, lh);
    }
    fclose(fp);
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

static void load_symbols(const char *elf_path, SymbolVec *syms)
{
    char *command = NULL;
    size_t command_len = 0;
    FILE *pipe;
    char line[8192];

    log_progress("loading symbols from %s", elf_path);
    if (asprintf(&command, "nm -n -S --defined-only %s", elf_path) < 0) {
        perror("asprintf");
        exit(1);
    }
    pipe = popen(command, "r");
    free(command);
    if (!pipe) {
        perror("popen nm");
        exit(1);
    }
    while (fgets(line, sizeof(line), pipe)) {
        char addr_s[64];
        char size_s[64];
        char type;
        char name[512];
        Symbol sym;
        if (sscanf(line, "%63s %63s %c %511s", addr_s, size_s, &type, name) != 4) {
            continue;
        }
        if (!(type == 'T' || type == 't' || type == 'W' || type == 'w')) {
            continue;
        }
        sym.start = strtoull(addr_s, NULL, 16);
        sym.size = strtoull(size_s, NULL, 16);
        sym.name = xstrdup(name);
        if (sym.size == 0) {
            free(sym.name);
            continue;
        }
        symbol_vec_push(syms, sym);
        enforce_memory_limit("load_symbols", syms->len);
    }
    pclose(pipe);
    qsort(syms->items, syms->len, sizeof(*syms->items), symbol_cmp);
    log_progress("loaded %zu symbols", syms->len);
    (void) command_len;
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
    size_t i;
    const size_t batch_size = 4096;
    int pipefd[2];
    pid_t pid;
    FILE *out;

    for (i = base; i < end; i += batch_size) {
        size_t batch_end = i + batch_size;
        size_t argc;
        char **argv;
        if (batch_end > end) {
            batch_end = end;
        }
        argc = (include_func ? 6 : 5) + (batch_end - i);
        argv = xcalloc(argc + 1, sizeof(*argv));
        argv[0] = xstrdup("addr2line");
        if (include_func) {
            argv[1] = xstrdup("-C");
            argv[2] = xstrdup("-f");
            argv[3] = xstrdup("-e");
            argv[4] = xstrdup(elf_path);
        } else {
            argv[1] = xstrdup("-e");
            argv[2] = xstrdup(elf_path);
        }
        for (size_t j = i; j < batch_end; j++) {
            char *addr = NULL;
            if (asprintf(&addr, "0x%" PRIx64, coverage->items[j].addr) < 0) {
                perror("asprintf");
                exit(1);
            }
            argv[(include_func ? 5 : 3) + (j - i)] = addr;
        }
        argv[argc] = NULL;

        if (pipe(pipefd) != 0) {
            perror("pipe");
            exit(1);
        }
        pid = fork();
        if (pid < 0) {
            perror("fork");
            exit(1);
        }
        if (pid == 0) {
            dup2(pipefd[1], STDOUT_FILENO);
            close(pipefd[0]);
            close(pipefd[1]);
            execvp(argv[0], argv);
            perror("execvp addr2line");
            _exit(1);
        }
        close(pipefd[1]);
        out = fdopen(pipefd[0], "r");
        if (!out) {
            perror("fdopen");
            exit(1);
        }
        for (size_t j = i; j < batch_end; j++) {
            char func[4096];
            char loc[4096];
            SourceLoc src = {0};
            char *colon;
            if (include_func) {
                if (!fgets(func, sizeof(func), out)) {
                    break;
                }
                if (!fgets(loc, sizeof(loc), out)) {
                    break;
                }
                func[strcspn(func, "\r\n")] = '\0';
            } else {
                if (!fgets(loc, sizeof(loc), out)) {
                    break;
                }
                strcpy(func, "");
            }
            loc[strcspn(loc, "\r\n")] = '\0';
            colon = strrchr(loc, ':');
            src.addr = coverage->items[j].addr;
            src.func = xstrdup(func);
            if (colon) {
                *colon = '\0';
                src.file = xstrdup(loc);
                src.line = (unsigned int) strtoul(colon + 1, NULL, 10);
            } else {
                src.file = xstrdup("??");
                src.line = 0;
            }
            write_source_record(sink, &src);
            free(src.func);
            free(src.file);
        }
        fclose(out);
        waitpid(pid, NULL, 0);
        for (size_t j = 0; j < argc; j++) {
            free(argv[j]);
        }
        free(argv);
        log_progress("resolved source batch %zu/%zu", batch_end, end);
    }
}

static void resolve_sources(const char *elf_path,
                            const CoverageVec *coverage,
                            SourceVec *sources,
                            size_t jobs,
                            bool include_func)
{
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
    log_progress("resolving %zu covered addresses via addr2line", coverage->len);
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

static void build_coverage(const TraceVec *records, CoverageVec *coverage, size_t jobs)
{
    size_t i;
    TraceRecord *sorted;
    size_t len = records->len;
    if (len == 0) {
        return;
    }
    log_progress("building coverage from %zu merged trace ranges", len);
    sorted = xcalloc(len, sizeof(*sorted));
    memcpy(sorted, records->items, len * sizeof(*sorted));
    qsort(sorted, len, sizeof(*sorted), trace_record_addr_cmp);
    jobs = clamp_jobs(jobs);
    if (jobs > len) {
        jobs = len;
    }

    if (jobs == 1) {
        build_coverage_chunk(sorted, len, coverage);
        free(sorted);
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
                build_coverage_chunk(sorted + start, end - start, &local);
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

    free(sorted);
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

static void write_coverage_lcov(const char *path,
                                const char *elf_path,
                                const CoverageVec *coverage,
                                const SourceVec *sources,
                                size_t jobs)
{
    FILE *fp = fopen(path, "w");
    FileCoverageVec files = {0};
    AddrMapVec map = {0};
    if (!fp) {
        perror(path);
        exit(1);
    }
    log_progress("writing lcov output to %s", path);
    if (!elf_path) {
        fclose(fp);
        return;
    }
    build_exec_map(elf_path, &files, &map);
    for (size_t i = 0; i < coverage->len; i++) {
        size_t lo = 0;
        size_t hi = map.len;
        while (lo < hi) {
            size_t mid = (lo + hi) / 2;
            if (map.items[mid].addr < coverage->items[i].addr) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        while (lo < map.len && map.items[lo].addr == coverage->items[i].addr) {
            FileCoverage *file = &files.items[map.items[lo].file_idx];
            size_t line_idx = find_line_index(file, map.items[lo].line);
            if (line_idx != (size_t) -1 && coverage->items[i].count > file->counts[line_idx]) {
                file->counts[line_idx] = coverage->items[i].count;
            }
            lo += 1;
        }
    }
    for (size_t i = 0; i < files.len; i++) {
        unsigned int lh = 0;
        fprintf(fp, "TN:\nSF:%s\n", files.items[i].path);
        for (size_t j = 0; j < files.items[i].len; j++) {
            if (files.items[i].counts[j] > 0) {
                lh += 1;
            }
            fprintf(fp, "DA:%u,%" PRIu64 "\n", files.items[i].lines[j], files.items[i].counts[j]);
        }
        fprintf(fp, "LF:%zu\nLH:%u\nend_of_record\n", files.items[i].len, lh);
    }
    fclose(fp);
    addr_map_free(&map);
    file_coverage_free(&files);
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

    if (args.elf &&
        args.coverage_output &&
        strcmp(args.coverage_format, "lcov") == 0 &&
        args.trace_output &&
        strcmp(args.trace_output, "none") == 0) {
        log_progress("postprocess started");
        build_exec_map(args.elf, &files, &map);
        parse_etrace_trace_lcov(args.trace, &files, &map);
        emit_lcov_from_files(args.coverage_output, &files);
        addr_map_free(&map);
        file_coverage_free(&files);
        log_progress("postprocess finished");
        return 0;
    }

    log_progress("postprocess started");
    parse_trace(args.trace, &records, args.jobs);
    merge_records_parallel(&records, args.jobs);
    if (args.elf && (strcmp(args.coverage_format, "etrace") == 0 || (args.trace_output && strcmp(args.trace_output, "none") != 0))) {
        load_symbols(args.elf, &syms);
    }
    if (strcmp(args.coverage_format, "none") != 0) {
        build_coverage(&records, &coverage, args.jobs);
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
    if (args.coverage_output && strcmp(args.coverage_format, "etrace") == 0) {
        write_coverage_etrace(args.coverage_output, &coverage, args.elf ? &syms : NULL, sources.len > 0 ? &sources : NULL);
    } else if (args.coverage_output && strcmp(args.coverage_format, "lcov") == 0) {
        write_coverage_lcov(args.coverage_output, args.elf, &coverage, &sources, args.jobs);
    }
    source_vec_free(&sources);
    symbol_vec_free(&syms);
    coverage_vec_free(&coverage);
    trace_vec_free(&records);
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
