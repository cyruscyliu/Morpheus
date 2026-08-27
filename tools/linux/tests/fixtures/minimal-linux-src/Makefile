O ?= .

.PHONY: qemu_virt_defconfig olddefconfig oldconfig Image

qemu_virt_defconfig:
	@mkdir -p "$(O)"
	@printf '%s\n' 'configured qemu_virt_defconfig' >> "$(O)/defconfig.log"
	@printf '%s\n' 'CONFIG_BASE=y' 'CONFIG_OVERRIDE=y' > "$(O)/.config"

olddefconfig:
	@mkdir -p "$(O)"
	@printf '%s\n' 'applied olddefconfig' >> "$(O)/defconfig.log"

oldconfig:
	@mkdir -p "$(O)"
	@printf '%s\n' 'applied oldconfig' >> "$(O)/defconfig.log"

Image:
	@mkdir -p "$(O)/arch/arm64/boot"
	@printf '%s\n' 'hello from minimal linux Image target' > "$(O)/arch/arm64/boot/Image"
	@printf '%s\n' 'hello from minimal linux vmlinux target' > "$(O)/vmlinux"
	@printf '%s\n' 'built Image' >> "$(O)/build.log"
