#pragma once

#include <map>
#include <string>
#include <vector>

#include "llvm/Support/JSON.h"

namespace devilang {

struct SvfHints {
  llvm::json::Object root;
  std::map<std::string, std::vector<std::string>> typeHints;
  std::map<std::string, std::vector<std::string>> fieldHints;
  std::map<std::string, std::vector<std::string>> callHints;
  std::map<std::string, std::vector<std::string>> useSiteHints;
};

std::string buildPointsToHintKey(const std::string &callsite,
                                 const std::string &callee,
                                 int64_t argIndex);

SvfHints parsePointsToHintJson(const std::string &path);

bool writeSvfHintsJson(const std::string &path, const llvm::json::Object &root);

bool collectSvfHints(const std::vector<std::string> &modulePaths,
                     const std::string &extapiPath,
                     SvfHints &outHints,
                     std::string &errorMessage);

}  // namespace devilang
