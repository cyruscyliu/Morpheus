O ?= .output
TARGET_NAME ?= smoke-rootfs

.PHONY: all qemu_x86_64_defconfig clean showvars

all: $(O)/images/$(TARGET_NAME).tar

qemu_x86_64_defconfig:
	@mkdir -p $(O)
	@printf '%s\n' 'BR2_x86_64=y' 'BR2_PACKAGE_BUSYBOX=y' > $(O)/.config
	@printf '%s\n' 'configured qemu_x86_64_defconfig' > $(O)/defconfig.log

$(O)/images/$(TARGET_NAME).tar: $(O)/.config
	@mkdir -p $(O)/images $(O)/target
	@printf '%s\n' 'hello from minimal buildroot smoke target' > $(O)/target/hello.txt
	@tar -cf $@ -C $(O)/target hello.txt
	@printf '%s\n' 'built $(TARGET_NAME).tar' > $(O)/build.log

clean:
	@rm -rf $(O)

showvars:
	@printf 'O=%s\n' '$(O)'
