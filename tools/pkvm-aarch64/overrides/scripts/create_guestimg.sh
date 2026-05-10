#!/usr/bin/env bash
set -e -o pipefail

. "$BASE_DIR/scripts/img_util.sh"

export PATH=$PATH:/usr/sbin
cd "$(dirname "$0")"

QEMU_USER=$(which qemu-aarch64-static)
CPUS=$(nproc)

USERNAME=$1
CURDIR=$PWD
PKGLIST=$(cat package.list.22 | grep -v "\-dev")
EXTRA_PKGLIST=$(cat extra_package.list)
OUTFILE=ubuntuguest.qcow2
RAWFILE=ubuntuguest.raw
IMAGESDIR=$BASE_DIR/images
OUTDIR=$IMAGESDIR/guest
UBUNTUTEMPLATE=$BASE_DIR/oss/ubuntu-template
SIZE=10G
START_BYTES=1048576
SKIP_CHROOT=0

do_cleanup() {
	cd "$CURDIR"
	do_unmount tmp/proc || true
	do_unmount tmp/dev || true
	sync || true
	if [ -f "$OUTDIR/$OUTFILE" ]; then
		chown "$USERNAME.$USERNAME" "$OUTDIR/$OUTFILE"
	fi
	rm -rf tmp "$RAWFILE"
}

usage() {
	echo "$0 -o <output directory> -s <image size> | -u"
}

if [ ! -f "$UBUNTUTEMPLATE/bin/bash" ]; then
	echo "Could not find an Ubuntu system at ${UBUNTUTEMPLATE}!"
	echo "Did you remember to run make ubuntu-template?"
	exit 1
fi

trap do_cleanup SIGHUP SIGINT SIGTERM EXIT

while getopts "h?o:s:" opt; do
	case "$opt" in
	h|\?) usage; exit 0 ;;
	o) OUTDIR=$OPTARG ;;
	s) SIZE=$OPTARG ;;
	esac
done

echo "Creating image.."

QEMU_USER=$TOOLDIR/usr/bin/qemu-aarch64-static
if [ ! -f "$QEMU_USER" ]; then
	echo "Could not find $QEMU_USER. Did you forget to run make qemu-user!!!??!!"
	exit 1
fi
prepare_binfmt

qemu-img create -f raw "$RAWFILE" "$SIZE"
parted -s "$RAWFILE" mklabel gpt mkpart primary ext4 1MiB 100%

echo "Copying ubuntu from template.."
mkdir -p tmp
sudo tar -C "$UBUNTUTEMPLATE" --numeric-owner -cf - ./ | tar -C tmp --numeric-owner -xf -
cp "$QEMU_USER" tmp/usr/bin
mkdir -p tmp/etc/network

echo "Installing packages.."
if mount --bind /dev tmp/dev && mount -t proc none tmp/proc; then
	echo "nameserver 8.8.8.8" > tmp/etc/resolv.conf
	export DEBIAN_FRONTEND=noninteractive
	run_chroot tmp /bin/bash -lc "apt-get update"
	run_chroot tmp /bin/bash -lc "apt-get -y install $EXTRA_PKGLIST"
	run_chroot tmp /bin/bash -lc "apt-get -y purge network-manager network-manager-gnome network-manager-pptp"
	run_chroot tmp /bin/bash -lc "update-alternatives --set iptables /usr/sbin/iptables-legacy"
	run_chroot tmp /bin/bash -lc "adduser --disabled-password --gecos '' ubuntu"
	run_chroot tmp /bin/bash -lc "passwd -d ubuntu"
	run_chroot tmp /bin/bash -lc "usermod -aG sudo ubuntu"
	rm -f tmp/etc/ssh/ssh_host_*
	run_chroot tmp /bin/bash -lc "dpkg-reconfigure openssh-server"
	rm -f tmp/var/cache/apt/archives/*.deb || true
	rm -f tmp/var/cache/apt/archives/*.ddeb || true
else
	SKIP_CHROOT=1
	echo "Restricted environment: skipping chroot package install"
fi

cat >> tmp/etc/network/interfaces << EOF
auto lo
iface lo inet loopback

auto enp0s2
iface enp0s2 inet static
address 192.168.10.3
gateway 192.168.10.1
EOF

cat >> tmp/etc/hosts << EOF
127.0.0.1	localhost
127.0.1.1	pkvm-guest

::1     ip6-localhost ip6-loopback
fe00::0 ip6-localnet
ff00::0 ip6-mcastprefix
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters

EOF

echo pkvm-guest > tmp/etc/hostname
if [ -f tmp/etc/systemd/resolved.conf ]; then
	sed 's/#DNS=/DNS=8.8.8.8/' -i tmp/etc/systemd/resolved.conf
fi
if [ -f tmp/etc/ssh/sshd_config ]; then
	sed 's/#PermitEmptyPasswords no/PermitEmptyPasswords yes/' -i tmp/etc/ssh/sshd_config
fi

echo 'DefaultTimeoutStartSec=600s' >> tmp/etc/systemd/system.conf
mkdir -p tmp/etc/systemd/system/ifupdown-pre.service.d
cat >> tmp/etc/systemd/system/ifupdown-pre.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=/bin/sh -c 'if [ "$CONFIGURE_INTERFACES" != "no" ] && [ -n "$(ifquery --read-environment --list --exclude=lo)" ] && [ -x /bin/udevadm ]; then udevadm settle --timeout 300; fi'
TimeoutStartSec=400
EOF

pwd_dir=$(pwd)
INST_MOD_PATH="$(pwd)/tmp"
INST_HDR_PATH="$(pwd)/tmp/usr"
echo "Installing guest kernel modules.."
make -C"$GUEST_KERNEL_DIR" CROSS_COMPILE=aarch64-linux-gnu- ARCH=arm64 INSTALL_MOD_STRIP=1 INSTALL_MOD_PATH="$INST_MOD_PATH" modules_install
make -C"$GUEST_KERNEL_DIR" CROSS_COMPILE=aarch64-linux-gnu- ARCH=arm64 INSTALL_HDR_PATH="$INST_HDR_PATH" headers_install
echo Done

if [ ! -d "$OUTDIR" ]; then
	echo "Creating output dir.."
	mkdir -p "$OUTDIR"
	chown -R "$USERNAME.$USERNAME" "$IMAGESDIR"
fi

cp -f "$GUEST_KERNEL_DIR/arch/arm64/boot/Image" "$OUTDIR"
chown "$USERNAME.$USERNAME" "$OUTDIR/Image"
do_unmount tmp/proc || true
do_unmount tmp/dev || true
finalize_raw_image tmp "$RAWFILE" "$OUTDIR/$OUTFILE" "$START_BYTES"
rm -f "$RAWFILE"
echo "Output saved at $OUTDIR"
sync
