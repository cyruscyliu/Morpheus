#ifndef SDG_CORE_ROLE_H
#define SDG_CORE_ROLE_H

#include <string>

namespace sdg {
namespace core {

/// Semantic role of a value as it travels from source to sink.
/// The role determines what kind of SDG rule is generated.
enum class Role {
  Unknown,
  Value,       ///< Raw scalar, e.g. the data operand of writel.
  Size,        ///< Length/order/count, e.g. kmalloc size, memcpy len.
  Address,     ///< Buffer pointer, e.g. sg buffer, DMA mapping address.
  Index,       ///< Queue/descriptor/used index.
  Control,     ///< Branch condition, e.g. feature bit controlling a path.
  FeatureBit,  ///< The bit index argument of virtio_has_feature.
};

std::string roleName(Role r);
Role roleFromName(const std::string &name);

} // namespace core
} // namespace sdg

#endif // SDG_CORE_ROLE_H
