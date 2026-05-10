#!/usr/bin/env bash

# Common helpers for the workspace-safe image builders.

udev_has_wait() {
	v=$(udevadm --version 2>/dev/null || echo 0)
	[ "$v" -ge 251 ]
}

udev_blockdev_sync() {
	newdev=$1
	if udev_has_wait; then
		udevadm wait --timeout=30 --settle "$newdev" || true
	else
		deadline=$((SECONDS + 30))
		while [ ! -e "$newdev" ] && [ $SECONDS -lt $deadline ]; do
			udevadm settle --timeout=5 || true
			sleep 1
		done
	fi
	if [ ! -e "$newdev" ]; then
		echo "ERROR: timeout waiting for $newdev"
		return 1
	fi
}

do_unmount() {
	if [[ $(findmnt -M "$1") ]]; then
		sudo umount "$1"
		if [ $? -ne 0 ]; then
			echo "ERROR: failed to umount $1"
			exit 1
		fi
	fi
}

restore_binfmt() {
	if [ "${BINFMT_AVAILABLE:-1}" != "1" ]; then
		return 0
	fi

	if [ -e "${BINFMTENTRY}" ]; then
		echo -1 | sudo tee "${BINFMTENTRY}" > /dev/null
	fi

	for ent in ${BINFMT_ENTRIES:-}; do
		echo 1 | sudo tee "$ent" > /dev/null
	done
}

prepare_binfmt() {
	if ! sudo modprobe binfmt_misc >/dev/null 2>&1; then
		BINFMT_AVAILABLE=0
		return 0
	fi

	if [ ! -w /proc/sys/fs/binfmt_misc/register ]; then
		BINFMT_AVAILABLE=0
		return 0
	fi

	procfiles=$(sudo find /proc/sys/fs/binfmt_misc | grep -v "^/proc/sys/fs/binfmt_misc$" | grep -v "^/proc/sys/fs/binfmt_misc/register$" | grep -v "^/proc/sys/fs/binfmt_misc/status$")

	if echo "$procfiles" | grep -q '[^[:space:]]'; then
		entries=$(sudo fgrep -l 7f454c460201010000000000000000000200b700 $procfiles)
	else
		entries=""
	fi

	for ent in $entries; do
		if [ x$(sudo cat "$ent" | awk 'NR = 1 && /enabled/ {print "FOUND"}') = xFOUND ]; then
			BINFMT_ENTRIES="$BINFMT_ENTRIES $ent"
			echo 0 | sudo tee "$ent" > /dev/null
		fi
	done

	echo ":pkvm-aarch64-build:M::\x7f\x45\x4c\x46\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\xb7\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:replace:OCPF" | sed -e "s|replace|$QEMU_USER|" | sudo tee /proc/sys/fs/binfmt_misc/register > /dev/null
	BINFMT_AVAILABLE=1
}

run_chroot() {
	rootfs=$1
	shift
	if [ "${BINFMT_AVAILABLE:-1}" = "1" ]; then
		sudo -E chroot "$rootfs" "$@"
	else
		sudo -E chroot "$rootfs" /usr/bin/qemu-aarch64-static "$@"
	fi
}

finalize_raw_image() {
	rootfs=$1
	rawfile=$2
	outfile=$3
	start_bytes=${4:-1048576}

	mkfs.ext4 -F -q -d "$rootfs" -E offset="${start_bytes}" "$rawfile"
	qemu-img convert -f raw -O qcow2 "$rawfile" "$outfile"
}
