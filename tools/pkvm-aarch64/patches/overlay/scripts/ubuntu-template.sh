#!/usr/bin/env bash

set -e

. "$BASE_DIR/scripts/img_util.sh"

ensure_root_namespace "$@"

TOOLDIR=$BASE_DIR/buildtools
QEMU_USER=$(which qemu-aarch64-static)

UBUNTU_BASE=https://cdimage.debian.org/mirror/cdimage.ubuntu.com/ubuntu-base/releases/22.04/release/ubuntu-base-22.04.4-base-arm64.tar.gz
PKGLIST=$(cat "$BASE_DIR/scripts/package.list.22")

unset CC LD CXX AR CPP CROSS_COMPILE CFLAGS LDFLAGS ASFLAGS INCLUDES WARNINGS DEFINES

export PATH=$TOOLDIR/bin:$TOOLDIR/usr/bin:/bin:/usr/bin
export CHROOTDIR=$BASE_DIR/oss/ubuntu-template
export BINFMTENTRY=/proc/sys/fs/binfmt_misc/pkvm-aarch64-build

NJOBS_MAX=8
NJOBS=$(nproc)
BINFMT_ENTRIES=""
SKIP_CHROOT=0

if [ -z "${BUILD_QEMU_USER+x}" ]; then
	BUILD_QEMU_USER=1
fi

if [ $NJOBS -gt $NJOBS_MAX ]; then
	NJOBS=$NJOBS_MAX
fi

do_unmount_all() {
	[ -n "$LEAVE_MOUNTS" ] && echo "leaving bind mounts in place." && exit 0
	do_unmount "$CHROOTDIR/proc"
	do_unmount "$CHROOTDIR/dev"
	rm -f "$CHROOTDIR/var/cache/apt/archives/"*.deb || true
	rm -f "$CHROOTDIR/var/cache/apt/archives/"*.ddeb || true
	restore_binfmt
}

do_clean() {
	do_unmount_all
}

do_distclean() {
	do_unmount_all
	rm -rf "$CHROOTDIR"
}

do_sysroot() {
	mkdir -p "$CHROOTDIR"
	if [ -e "$CHROOTDIR/bin/bash" ]; then
		return
	fi

	cd "$CHROOTDIR"
	wget -c "$UBUNTU_BASE"
	tar --numeric-owner -xf "$(basename "$UBUNTU_BASE")"
	cp "$QEMU_USER" usr/bin
	if mount --bind /dev "$CHROOTDIR/dev" && mount -t proc none "$CHROOTDIR/proc"; then
		echo "nameserver 8.8.8.8" > "$CHROOTDIR/etc/resolv.conf"
		chown 0:0 "$CHROOTDIR/etc/resolv.conf"
		export DEBIAN_FRONTEND=noninteractive
		run_chroot "$CHROOTDIR" /bin/bash -lc "apt-get update"
		run_chroot "$CHROOTDIR" /bin/bash -lc "apt-get -y dist-upgrade"
		run_chroot "$CHROOTDIR" /bin/bash -lc "apt-get -y install $PKGLIST"
	else
		SKIP_CHROOT=1
		echo "Restricted environment: skipping ubuntu-template package install"
	fi
	rm "$(basename "$UBUNTU_BASE")"
}

if [[ "$#" -eq 1 ]] && [[ "$1" == "clean" ]]; then
	do_clean
	exit 0
fi

if [[ "$#" -eq 1 ]] && [[ "$1" == "distclean" ]]; then
	do_distclean
	exit 0
fi

trap do_unmount_all SIGHUP SIGINT SIGTERM EXIT

if [ $BUILD_QEMU_USER = 1 ]; then
	QEMU_USER=$TOOLDIR/usr/bin/qemu-aarch64-static
	if [ ! -f "$QEMU_USER" ]; then
		echo "Could not find $QEMU_USER. Did you forget to run make qemu-user!!!??!!"
		exit 1
	fi
	prepare_binfmt
fi

do_sysroot
cd "$BASE_DIR"

echo "All ok!"
