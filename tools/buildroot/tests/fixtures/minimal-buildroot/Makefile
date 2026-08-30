O ?= .output
TARGET_NAME ?= smoke-rootfs

.PHONY: all qemu_x86_64_defconfig qemu_aarch64_virt_defconfig olddefconfig linux-dirclean qemu-dirclean clean showvars

all: $(O)/images/$(TARGET_NAME).tar

qemu_x86_64_defconfig:
	@mkdir -p $(O)
	@printf '%s\n' 'BR2_x86_64=y' 'BR2_PACKAGE_BUSYBOX=y' > $(O)/.config
	@printf '%s\n' 'configured qemu_x86_64_defconfig' > $(O)/defconfig.log
	@if [ -n "$(BR2_EXTERNAL)" ]; then printf '%s\n' 'BR2_EXTERNAL=$(BR2_EXTERNAL)' >> $(O)/defconfig.log; fi

qemu_aarch64_virt_defconfig:
	@mkdir -p $(O)
	@printf '%s\n' 'BR2_aarch64=y' 'BR2_PACKAGE_BUSYBOX=y' > $(O)/.config
	@printf '%s\n' 'configured qemu_aarch64_virt_defconfig' > $(O)/defconfig.log
	@if [ -n "$(BR2_EXTERNAL)" ]; then printf '%s\n' 'BR2_EXTERNAL=$(BR2_EXTERNAL)' >> $(O)/defconfig.log; fi

olddefconfig:
	@printf '%s\n' 'applied olddefconfig' >> $(O)/defconfig.log
	@if [ -n "$(BR2_EXTERNAL)" ]; then printf '%s\n' 'BR2_EXTERNAL=$(BR2_EXTERNAL)' >> $(O)/defconfig.log; fi

linux-dirclean:
	@rm -rf $(O)/build/linux-*

qemu-dirclean:
	@rm -rf $(O)/build/qemu-*

qemu-cca-dirclean:
	@rm -rf $(O)/build/qemu-cca-*

$(O)/images/$(TARGET_NAME).tar: $(O)/.config
	@mkdir -p \
		$(O)/images \
		$(O)/target/usr/bin \
		$(O)/target/usr/share/qemu \
		$(O)/build/linux-6.18.16
	@printf '%s\n' 'hello from minimal buildroot smoke target' > $(O)/target/hello.txt
	@tar -cf $@ -C $(O)/target hello.txt
	@printf '%s\n' 'fake arm64 kernel image' > $(O)/images/Image
	@cp $(O)/target/hello.txt $(O)/images/rootfs.cpio
	@gzip -nc $(O)/images/rootfs.cpio > $(O)/images/rootfs.cpio.gz
	@printf '%s\n' 'fake buildroot ext2 rootfs' > $(O)/images/rootfs.ext2
	@printf '%s\n' '#!/bin/sh' 'exit 0' > $(O)/target/usr/bin/qemu-system-aarch64
	@chmod +x $(O)/target/usr/bin/qemu-system-aarch64
	@printf '%s\n' 'fake qemu rom data' > $(O)/target/usr/share/qemu/edk2.bin
	@printf '%s\n' 'fake vmlinux elf' > $(O)/build/linux-6.18.16/vmlinux
	@printf '%s\n' 'built $(TARGET_NAME).tar' > $(O)/build.log

clean:
	@rm -rf $(O)

showvars:
	@printf 'O=%s\n' '$(O)'
