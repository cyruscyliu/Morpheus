#include "sdg/core/Role.h"

using namespace sdg::core;

std::string sdg::core::roleName(Role r) {
  switch (r) {
  case Role::Value: return "value";
  case Role::Size: return "size";
  case Role::Address: return "address";
  case Role::Index: return "index";
  case Role::Control: return "control";
  case Role::FeatureBit: return "feature_bit";
  default: return "unknown";
  }
}

Role sdg::core::roleFromName(const std::string &name) {
  if (name == "value") return Role::Value;
  if (name == "size") return Role::Size;
  if (name == "address") return Role::Address;
  if (name == "index") return Role::Index;
  if (name == "control") return Role::Control;
  if (name == "feature_bit") return Role::FeatureBit;
  return Role::Unknown;
}
