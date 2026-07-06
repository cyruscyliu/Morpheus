; ModuleID = 'minimal-devilang'
source_filename = "minimal-devilang.c"

declare i32 @readl(ptr noundef)
declare void @writel(i32 noundef, ptr noundef)
declare void @sg_init_one(ptr noundef, ptr noundef, i64 noundef)

define i32 @helper(ptr noundef %base, ptr noundef %sg, ptr noundef %buf) {
entry:
  %status = call i32 @readl(ptr noundef %base)
  call void @sg_init_one(ptr noundef %sg, ptr noundef %buf, i64 noundef 64)
  %tobool = icmp ne i32 %status, 0
  br i1 %tobool, label %if.then, label %if.end

if.then:
  call void @writel(i32 noundef %status, ptr noundef %base)
  br label %if.end

if.end:
  ret i32 %status
}

define i32 @boot_probe(ptr noundef %base, ptr noundef %sg, ptr noundef %buf) {
entry:
  %call = call i32 @helper(ptr noundef %base, ptr noundef %sg, ptr noundef %buf)
  ret i32 %call
}
