; ModuleID = 'phase-topology'
source_filename = "phase-topology.c"

declare i32 @readl(ptr noundef)
declare void @writel(i32 noundef, ptr noundef)

define void @boot_driver(ptr noundef %base) {
entry:
  %status = call i32 @readl(ptr noundef %base)
  ret void
}

define void @virtio_dev_probe(ptr noundef %base) {
entry:
  call void @boot_driver(ptr noundef %base)
  ret void
}

define void @register_virtio_device(ptr noundef %base) {
entry:
  call void @virtio_dev_probe(ptr noundef %base)
  ret void
}

define void @boot_transport(ptr noundef %base) {
entry:
  call void @register_virtio_device(ptr noundef %base)
  ret void
}

define void @runtime_open(ptr noundef %base) {
entry:
  %status = call i32 @readl(ptr noundef %base)
  ret void
}

define void @runtime_close(ptr noundef %base) {
entry:
  call void @writel(i32 noundef 1, ptr noundef %base)
  ret void
}
