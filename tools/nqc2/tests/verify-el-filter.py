"""Integration test: public plugin APIs on a guest executing each AArch64 EL."""
import argparse
import pathlib
import struct
import subprocess
import tempfile
import gzip

parser = argparse.ArgumentParser()
parser.add_argument('--qemu', required=True)
parser.add_argument('--header', required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent

def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, timeout=15)
    assert r.returncode == 0, r.stderr.decode()
    return r

def ranges(path):
    data = path.read_bytes()
    if data.startswith(b'\x1f\x8b'):
        data = gzip.decompress(data)
    result = []
    pos = 0
    while pos < len(data):
        typ, _, size = struct.unpack_from('<HHI', data, pos)
        pos += 8
        payload = data[pos:pos + size]
        assert len(payload) == size
        if typ == 1:
            result.extend((a, b) for _, a, b in struct.iter_unpack('<IQQ', payload[8:]))
        pos += size
    return result

with tempfile.TemporaryDirectory(prefix='nqc2-el-test-') as tmp:
    d = pathlib.Path(tmp)
    run('aarch64-linux-gnu-as', str(root / 'el-levels.S'), '-o', str(d / 'guest.o'))
    run('aarch64-linux-gnu-ld', '-Ttext=0x40200000', str(d / 'guest.o'), '-o', str(d / 'guest.elf'))
    flags = run('pkg-config', '--cflags', '--libs', 'glib-2.0').stdout.decode().split()
    run('gcc', '-shared', '-fPIC', '-pthread', '-I' + str(pathlib.Path(args.header).parent),
        str(root.parent / 'scripts/nqc2_plugin.c'), '-o', str(d / 'plugin.so'), *flags)
    base = [args.qemu, '-machine', 'virt,secure=on,virtualization=on', '-cpu', 'max',
            '-accel', 'tcg', '-display', 'none', '-serial', 'none', '-monitor', 'none',
            '-semihosting-config', 'enable=on,target=native,userspace=on',
            '-device', f'loader,file={d / "guest.elf"},cpu-num=0']
    for mode in ('all', 'el0', 'el1', 'el2', 'el3'):
        trace = d / (mode + '.trace')
        run(*base, '-plugin', f'file={d / "plugin.so"},trace={trace},el={mode}')
        records = ranges(trace)
        for offset, level in ((0, 'el3'), (0x100, 'el2'), (0x200, 'el1'),
                              (0x300, 'el1'), (0x400, 'el0')):
            hit = any(a <= 0x40200000 + offset < b for a, b in records)
            assert hit == (mode == 'all' or mode == level), (mode, level, records)
        print(mode, 'PASS', records)
    r = subprocess.run(base + ['-plugin', f'file={d / "plugin.so"},el=invalid'],
                       capture_output=True, timeout=15)
    assert r.returncode != 0 and b'el must be' in r.stderr
    print('invalid selection PASS')
