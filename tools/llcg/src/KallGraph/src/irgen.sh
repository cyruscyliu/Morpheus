#!/bin/bash -x
# Configurations

KERNEL_SRC="/home/debian/truman/linux-6.0"
IRDUMPER="$(pwd)/IRDumper/build/lib/libDumper.so"
CLANG="${CLANG:-$(command -v clang-15 || command -v clang)}"
CONFIG="defconfig"
# CONFIG="allyesconfig"

# Use -Wno-error to avoid turning warnings into errors
# O0
NEW_CMD="\n\nKBUILD_USERCFLAGS += -Wno-error -O0 -fno-discard-value-names -finline-functions -g -Xclang -no-opaque-pointers -Xclang -disable-O0-optnone -Xclang -finline-functions -Xclang -flegacy-pass-manager -Xclang -load -Xclang $IRDUMPER\n
KBUILD_CFLAGS += -Wno-error -O0 -fno-discard-value-names -finline-functions -g -Xclang -no-opaque-pointers -Xclang -finline-functions -Xclang -disable-O0-optnone -Xclang -flegacy-pass-manager -Xclang -load -Xclang $IRDUMPER"

# Back up Linux Makefile
if [ ! -f "$KERNEL_SRC/Makefile.bak" ]; then
	cp $KERNEL_SRC/Makefile $KERNEL_SRC/Makefile.bak
fi

# The new flags better follow "# Add user supplied CPPFLAGS, AFLAGS and CFLAGS as the last assignments"
echo -e $NEW_CMD >$KERNEL_SRC/IRDumper.cmd
cat $KERNEL_SRC/Makefile.bak $KERNEL_SRC/IRDumper.cmd >$KERNEL_SRC/Makefile

cd $KERNEL_SRC
make CC=$CLANG $CONFIG
make CC=$CLANG -j20 -k -i V=1 2>&1 | tee make.log
