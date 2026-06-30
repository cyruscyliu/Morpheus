#include "LLVMCallGraph.h"

#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/SourceMgr.h"

#include <algorithm>
#include <functional>
#include <queue>
#include <regex>
#include <utility>
#include <vector>

using namespace llvm;

static cl::opt<std::string> DevilangDotOutput(
	"llvm-cg-dot-output",
	cl::desc("Path to write Devilang call graph DOT file"),
	cl::value_desc("filename"),
	cl::init("devilang_cg.dot"));

static cl::opt<std::string> DevilangKallgraphInput(
	"llvm-cg-kallgraph",
	cl::desc("Path to KallGraph output file (caller/count/callee blocks)"),
	cl::value_desc("filename"),
	cl::init(""));

static cl::list<PrunePolicy> DevilangPrune(
	"llvm-cg-prune",
	cl::desc("Graph pruning policies (can be specified multiple times, applied in order)"),
	cl::values(
		clEnumValN(PrunePolicy::None, "none", "No pruning"),
		clEnumValN(PrunePolicy::Blocklist, "blocklist",
				   "Remove nodes matching regex patterns from a blocklist file")),
	cl::CommaSeparated);

static cl::opt<std::string> DevilangBlocklistFile(
	"llvm-cg-blocklist",
	cl::desc("Path to blocklist file (one regex pattern per line)"),
	cl::value_desc("filename"),
	cl::init(""));

static cl::opt<std::string> DevilangBCList(
	"llvm-cg-bc-list",
	cl::desc("Path to a file listing extra .bc paths (one per line) to augment "
			 "the debug location map. Useful when the main module was linked "
			 "with --only-needed and is missing caller functions."),
	cl::value_desc("filename"),
	cl::init(""));

static cl::opt<std::string> DevilangGroupsFile(
	"llvm-cg-groups",
	cl::desc("Path to a groups file. Each block (separated by blank lines) "
			 "has a label on the first line followed by member function names. "
			 "Groups are rendered as labelled cluster rectangles in the DOT output. "
			 "Supports imports via lines like 'import groups_6.6.0.txt'."),
	cl::value_desc("filename"),
	cl::init(""));

static cl::opt<std::string> DevilangExtraEdgesFile(
	"llvm-cg-extra-edges",
	cl::desc("Path to a manual indirect call list file. Each line specifies one "
	         "edge: 'caller callee'. Blank lines and '#' comments are ignored. "
	         "Use this to add edges for function pointer stores that neither the "
	         "direct CG nor KallGraph can resolve automatically."),
	cl::value_desc("filename"),
	cl::init(""));

static cl::opt<bool> DevilangReachabilityPrune(
	"llvm-cg-reachability-prune",
	cl::desc("Enable reachability pruning from [entry_point] groups"),
	cl::init(false));


char DevilangCGResult::ID = 0;
static RegisterPass<DevilangCGResult>
	RegResult("llvm-cg-result",
			  "Devilang Call Graph Result", false, true);

char DevilangCG::ID = 0;
static RegisterPass<DevilangCG>
	RegCG("llvm-cg",
			  "Devilang KallGraph Loader + Pruner", false, true);

void DevilangCG::getAnalysisUsage(AnalysisUsage &AU) const {
	AU.setPreservesAll();
	AU.addRequired<DevilangCGResult>();
}

std::unordered_map<std::string, std::set<std::string>>
DevilangCG::buildDebugLocMap(Module &M) {
	std::unordered_map<std::string, std::set<std::string>> locMap;

	for (auto &F : M) {
		if (F.isDeclaration())
			continue;
		const std::string funcName = F.getName().str();
		for (auto &BB : F) {
			for (auto &I : BB) {
				if (!isa<CallBase>(&I))
					continue;

				const DebugLoc &DL = I.getDebugLoc();
				if (!DL)
					continue;

				std::string file = DL->getFilename().str();
				std::string dir = DL->getDirectory().str();
				unsigned line = DL.getLine();
				if (file.empty() || line == 0)
					continue;

				std::string fullPath = file;
				if (!dir.empty() && file.front() != '/')
					fullPath = dir + "/" + file;

				std::string keyFull = fullPath + ":" + std::to_string(line);
				std::string keyBase = sys::path::filename(file).str() + ":" + std::to_string(line);

				locMap[keyFull].insert(funcName);
				locMap[keyBase].insert(funcName);
			}
		}
	}

	return locMap;
}

DevilangCGResult::AdjList DevilangCG::buildDirectCallGraph(Module &M) {
	DevilangCGResult::AdjList adj;

	for (auto &F : M) {
		if (F.isDeclaration())
			continue;
		const std::string callerName = F.getName().str();
		adj[callerName]; // ensure caller appears even if it has no direct callees
		for (auto &BB : F) {
			for (auto &I : BB) {
				auto *CB = dyn_cast<CallBase>(&I);
				if (!CB)
					continue;
				Function *callee = CB->getCalledFunction();
				if (callee && !callee->isIntrinsic())
					adj[callerName].insert(callee->getName().str());

				// Also capture callback-style indirection where a concrete
				// function symbol is passed as a call argument.
				for (const auto &arg : CB->args()) {
					Value *v = arg.get();
					if (!v)
						continue;
					v = v->stripPointerCasts();
					Function *argFunc = dyn_cast<Function>(v);
					if (!argFunc || argFunc->isIntrinsic())
						continue;
					adj[callerName].insert(argFunc->getName().str());
				}
			}
		}
	}

	return adj;
}

std::string DevilangCG::resolveCallerName(
	StringRef callerToken,
	const std::unordered_map<std::string, std::set<std::string>> &debugLocMap) {
	if (callerToken.empty())
		return callerToken.str();

	auto pickOne = [](const std::set<std::string> &names) -> std::string {
		return names.empty() ? std::string() : *names.begin();
	};

	{
		auto it = debugLocMap.find(callerToken.str());
		if (it != debugLocMap.end() && it->second.size() == 1)
			return pickOne(it->second);
	}

	// Full-token suffix match: callerToken is a relative path (e.g.
	// "third_party/linux/net/ethtool/ioctl.c:1800") and the debug map holds
	// absolute paths.  Since everything runs in the same container, the
	// absolute key reliably ends with the relative token.
	if (callerToken.contains('/')) {
		std::set<std::string> candidates;
		for (const auto &kv : debugLocMap) {
			if (kv.first.find('/') == std::string::npos)
				continue; // skip bare-filename keys
			if (StringRef(kv.first).endswith(callerToken))
				candidates.insert(kv.second.begin(), kv.second.end());
		}
		if (candidates.size() == 1)
			return pickOne(candidates);
		// Multiple candidates means the same file:line is inlined into
		// several callers — unresolvable; fall through to return the token.
		if (!candidates.empty())
			return callerToken.str();
	}

	std::string token = callerToken.str();
	size_t lastColon = token.rfind(':');
	if (lastColon == std::string::npos)
		return token;

	StringRef filePart = StringRef(token).slice(0, lastColon);
	StringRef linePart = StringRef(token).substr(lastColon + 1);

	unsigned line = 0;
	if (linePart.getAsInteger(10, line))
		return token;

	std::string keyBase = sys::path::filename(filePart).str() + ":" + std::to_string(line);
	{
		auto it = debugLocMap.find(keyBase);
		if (it != debugLocMap.end() && it->second.size() == 1)
			return pickOne(it->second);
	}

	// Fallback: suffix match for path normalization mismatches.
	// Only consider full-path keys (containing '/') to avoid the base-filename
	// keys (e.g. "ioctl.c:1800") from contaminating the candidate set — those
	// were already tried in the base key match above and can span multiple
	// directories, causing false ambiguity.
	std::string suffix = ":" + std::to_string(line);
	std::set<std::string> candidates;
	for (const auto &kv : debugLocMap) {
		if (!StringRef(kv.first).endswith(suffix))
			continue;
		StringRef mapFile = StringRef(kv.first).drop_back(suffix.size());
		if (mapFile.find('/') == StringRef::npos)
			continue; // skip bare-filename keys
		if (filePart.endswith(mapFile) || mapFile.endswith(filePart))
			candidates.insert(kv.second.begin(), kv.second.end());
	}
	if (!candidates.empty())
		return candidates.size() == 1 ? pickOne(candidates) : token;

	return token;
}

DevilangCGResult::AdjList DevilangCG::buildAdjListFromKallgraph(
	const std::string &path,
	const std::unordered_map<std::string, std::set<std::string>> &debugLocMap) {
	DevilangCGResult::AdjList adj;
	if (path.empty())
		return adj;

	auto bufOrErr = MemoryBuffer::getFile(path);
	if (!bufOrErr) {
		errs() << "DevilangCG: cannot open KallGraph file " << path
			   << ": " << bufOrErr.getError().message() << "\n";
		return adj;
	}

	StringRef content = bufOrErr.get()->getBuffer();
	SmallVector<StringRef, 0> lines;
	content.split(lines, '\n');

	auto isFileLineToken = [](StringRef token) -> bool {
		size_t lastColon = token.rfind(':');
		if (lastColon == StringRef::npos)
			return false;
		StringRef linePart = token.substr(lastColon + 1);
		unsigned line = 0;
		return !linePart.getAsInteger(10, line);
	};

	size_t totalCallers = 0;
	size_t locationCallers = 0;
	size_t resolvedLocationCallers = 0;
	size_t unresolvedLocationCallers = 0;

	unsigned i = 0;
	while (i < lines.size()) {
		StringRef callerLine = lines[i].trim();
		if (callerLine.empty() || callerLine.startswith("#")) {
			++i;
			continue;
		}

		std::string caller = resolveCallerName(callerLine, debugLocMap);
		++totalCallers;
		if (isFileLineToken(callerLine)) {
			++locationCallers;
			if (caller != callerLine.str())
				++resolvedLocationCallers;
			else
				++unresolvedLocationCallers;
		}
		++i;

		if (i >= lines.size()) {
			errs() << "DevilangCG: malformed KallGraph file " << path
				   << " (missing callee count for caller " << caller << ")\n";
			break;
		}

		StringRef countLine = lines[i].trim();
		unsigned count = 0;
		if (countLine.getAsInteger(10, count)) {
			errs() << "DevilangCG: malformed KallGraph file " << path
				   << " (invalid count for caller " << caller << ")\n";
			++i;
			continue;
		}
		++i;

		adj[caller];
		for (unsigned c = 0; c < count && i < lines.size(); ++c, ++i) {
			StringRef calleeLine = lines[i].trim();
			if (calleeLine.empty() || calleeLine.startswith("#"))
				continue;
			adj[caller].insert(calleeLine.str());
		}
	}

	errs() << "DevilangCG: parsed callers=" << totalCallers
		   << ", location-callers=" << locationCallers
		   << ", resolved-location-callers=" << resolvedLocationCallers
		   << ", unresolved-location-callers=" << unresolvedLocationCallers << "\n";

	return adj;
}

void DevilangCG::exportDOT(const DevilangCGResult::AdjList &adj,
						   const std::string &path,
						   const std::vector<Group> &groups) {
	std::error_code EC;
	raw_fd_ostream out(path, EC, sys::fs::OF_Text);
	if (EC) {
		errs() << "DevilangCG: cannot open DOT file " << path
			   << ": " << EC.message() << "\n";
		return;
	}

	// Build set of all nodes that still exist in the graph (as callers or
	// callees) so groups can be filtered after pruning.
	std::unordered_set<std::string> nodesInGraph;
	for (const auto &kv : adj) {
		nodesInGraph.insert(kv.first);
		for (const auto &callee : kv.second)
			nodesInGraph.insert(callee);
	}

	// Build set of rendered group nodes so we can skip them in the main loop.
	std::unordered_set<std::string> groupedNodes;
	for (const auto &g : groups)
		for (const auto &m : g.members)
			if (nodesInGraph.count(m))
				groupedNodes.insert(m);

	out << "digraph DevilangCG {\n";
	out << "    rankdir=LR;\n";
	out << "    node [shape=box, style=filled, fillcolor=lightyellow];\n\n";

	// Emit cluster subgraphs for each group.
	int clusterIdx = 0;
	for (const auto &g : groups) {
		std::vector<std::string> visibleMembers;
		for (const auto &m : g.members)
			if (nodesInGraph.count(m))
				visibleMembers.push_back(m);
		if (visibleMembers.empty())
			continue;

		out << "    subgraph cluster_" << clusterIdx++ << " {\n";
		out << "        label=\"" << g.label << "\";\n";
		out << "        style=\"rounded,filled\";\n";
		if (g.entryPoint) {
			out << "        fillcolor=\"#eeffee\";\n";
			out << "        color=darkgreen;\n";
			out << "        penwidth=2;\n";
			out << "        fontcolor=darkgreen;\n";
		} else {
			out << "        fillcolor=\"#ddeeff\";\n";
			out << "        color=steelblue;\n";
			out << "        penwidth=2;\n";
			out << "        fontcolor=steelblue;\n";
		}
		if (g.rankHint == Group::Rank::Top)
			out << "        rank=min;\n";
		else if (g.rankHint == Group::Rank::Bottom)
			out << "        rank=max;\n";
		for (const auto &m : visibleMembers)
			out << "        \"" << m << "\";\n";
		out << "    }\n\n";
	}

	// Emit all edges (including those involving grouped nodes).
	for (const auto &kv : adj) {
		const std::string &caller = kv.first;
		const std::set<std::string> &callees = kv.second;

		if (callees.empty()) {
			if (groupedNodes.find(caller) == groupedNodes.end())
				out << "    \"" << caller << "\";\n";
			continue;
		}

		for (const std::string &callee : callees) {
			out << "    \"" << caller << "\" -> \"" << callee << "\";\n";
		}
	}

	out << "}\n";
}

std::vector<DevilangCG::Group> DevilangCG::loadGroups(const std::string &path) {
	std::vector<Group> groups;
	if (path.empty())
		return groups;

	auto normalizePath = [](StringRef in) -> std::string {
		SmallString<256> resolved;
		if (!sys::fs::real_path(in, resolved))
			return std::string(resolved.str());
		SmallString<256> fallback(in);
		sys::path::remove_dots(fallback, /*remove_dot_dot=*/true);
		return std::string(fallback.str());
	};

	auto parseImportDirective = [](StringRef line, std::string &target) -> bool {
		StringRef t = line.trim();
		bool matched = false;
		if (t.consume_front("import"))
			matched = true;
		else if (t.consume_front("@import"))
			matched = true;
		else if (t.consume_front("[import]"))
			matched = true;
		if (!matched)
			return false;
		t = t.trim();
		if (t.empty())
			return false;
		if ((t.front() == '"' && t.back() == '"') ||
			(t.front() == '\'' && t.back() == '\'')) {
			t = t.drop_front().drop_back();
		}
		target = t.str();
		return !target.empty();
	};

	auto resolveImportPath = [](StringRef baseFile, StringRef importPath) -> std::string {
		if (sys::path::is_absolute(importPath))
			return importPath.str();
		SmallString<256> dir(baseFile);
		sys::path::remove_filename(dir);
		sys::path::append(dir, importPath);
		sys::path::remove_dots(dir, /*remove_dot_dot=*/true);
		return std::string(dir.str());
	};

	// Index for O(1) lookup of existing groups by label.
	std::unordered_map<std::string, size_t> labelIndex;

	// Flush a parsed group block: if members carry +/- prefixes, modify an
	// existing group in-place; otherwise add/replace the group wholesale.
	auto flushGroup = [&](Group &cur,
						  const std::vector<std::string> &rawMembers) {
		if (cur.label.empty())
			return;

		// Determine whether this is a modify block (any member has +/- prefix).
		bool hasModify = false;
		for (const auto &m : rawMembers) {
			if (!m.empty() && (m[0] == '+' || m[0] == '-')) {
				hasModify = true;
				break;
			}
		}

		if (hasModify) {
			// Modify an existing group's members.
			auto it = labelIndex.find(cur.label);
			if (it == labelIndex.end()) {
				errs() << "DevilangCG: cannot modify group '" << cur.label
					   << "': no existing group with that label\n";
				return;
			}
			Group &target = groups[it->second];
			for (const auto &m : rawMembers) {
				if (m.empty())
					continue;
				if (m[0] == '+') {
					std::string name = StringRef(m).drop_front(1).trim().str();
					if (!name.empty())
						target.members.push_back(name);
				} else if (m[0] == '-') {
					std::string name = StringRef(m).drop_front(1).trim().str();
					if (!name.empty()) {
						auto &v = target.members;
						v.erase(std::remove(v.begin(), v.end(), name), v.end());
					}
				} else {
					// Plain member inside a modify block — treat as add.
					target.members.push_back(m);
				}
			}
			// Merge markers: a modify block may set or clear entry_point.
			if (cur.entryPointOverride == Group::EntryPointOverride::Set)
				target.entryPoint = true;
			else if (cur.entryPointOverride == Group::EntryPointOverride::Clear)
				target.entryPoint = false;
			if (cur.rankHint != Group::Rank::None)
				target.rankHint = cur.rankHint;
		} else {
			// Plain group: replace existing or add new.
			cur.members = rawMembers;
			auto it = labelIndex.find(cur.label);
			if (it != labelIndex.end()) {
				groups[it->second] = std::move(cur);
			} else {
				labelIndex[cur.label] = groups.size();
				groups.push_back(std::move(cur));
			}
		}
	};

	std::function<bool(const std::string &, std::unordered_set<std::string> &,
					   std::unordered_set<std::string> &)>
		parseFileRec;

	parseFileRec = [&](const std::string &filePath,
					   std::unordered_set<std::string> &activeStack,
					   std::unordered_set<std::string> &loadedFiles) -> bool {
		const std::string normPath = normalizePath(filePath);
		if (activeStack.count(normPath)) {
			errs() << "DevilangCG: cyclic groups import detected at " << normPath << "\n";
			return false;
		}
		if (loadedFiles.count(normPath))
			return true;

		auto bufOrErr = MemoryBuffer::getFile(normPath);
		if (!bufOrErr) {
			errs() << "DevilangCG: cannot open groups file " << normPath
				   << ": " << bufOrErr.getError().message() << "\n";
			return false;
		}

		activeStack.insert(normPath);
		loadedFiles.insert(normPath);

		Group current;
		std::vector<std::string> currentMembers;
		StringRef content = bufOrErr.get()->getBuffer();
		SmallVector<StringRef, 0> rawLines;
		content.split(rawLines, '\n');

		for (StringRef rawLine : rawLines) {
			StringRef trimmed = rawLine.trim();
			if (trimmed.startswith("#"))
				continue;

			std::string importTarget;
			if (parseImportDirective(trimmed, importTarget)) {
				flushGroup(current, currentMembers);
				current = Group{};
				currentMembers.clear();
				const std::string resolvedImport = resolveImportPath(normPath, importTarget);
				(void)parseFileRec(resolvedImport, activeStack, loadedFiles);
				continue;
			}

			if (trimmed.empty()) {
				// Blank line: flush current group.
				flushGroup(current, currentMembers);
				current = Group{};
				currentMembers.clear();
				continue;
			}
			if (current.label.empty()) {
				// Optional markers on group label line (can be combined, e.g.
				// "[entry_point][rank_max] group_name"):
			//   [entry_point]             entry-point visual style + reachability anchor
			//   [no_entry_point]          clear inherited entry-point behavior
			//   [rank_min]               force cluster to top of layout (rank=min)
			//   [rank_max]               force cluster to bottom of layout (rank=max)
			bool parsedMarker = true;
			while (parsedMarker) {
				parsedMarker = false;
				if (trimmed.consume_front("[entry_point]")) {
					current.entryPoint = true;
					current.entryPointOverride = Group::EntryPointOverride::Set;
					trimmed = trimmed.trim();
					parsedMarker = true;
					} else if (trimmed.consume_front("[no_entry_point]")) {
						current.entryPoint = false;
						current.entryPointOverride = Group::EntryPointOverride::Clear;
					trimmed = trimmed.trim();
					parsedMarker = true;
					} else if (trimmed.consume_front("[rank_min]")) {
						current.rankHint = Group::Rank::Top;
						trimmed = trimmed.trim();
						parsedMarker = true;
					} else if (trimmed.consume_front("[rank_max]")) {
						current.rankHint = Group::Rank::Bottom;
						trimmed = trimmed.trim();
						parsedMarker = true;
					}
				}
				current.label = trimmed.str();
			} else {
				currentMembers.push_back(trimmed.str());
			}
		}

		// Flush last group in this file.
		flushGroup(current, currentMembers);

		activeStack.erase(normPath);
		return true;
	};

	std::unordered_set<std::string> activeStack;
	std::unordered_set<std::string> loadedFiles;
	(void)parseFileRec(path, activeStack, loadedFiles);
	return groups;
}

std::vector<std::string> DevilangCG::loadFileLines(const std::string &path) {
	std::vector<std::string> entries;

	auto bufOrErr = MemoryBuffer::getFile(path);
	if (!bufOrErr) {
		errs() << "DevilangCG: cannot open file " << path
			   << ": " << bufOrErr.getError().message() << "\n";
		return entries;
	}

	StringRef content = bufOrErr.get()->getBuffer();
	SmallVector<StringRef, 0> lines;
	content.split(lines, '\n');

	for (const StringRef &line : lines) {
		StringRef trimmed = line.trim();
		if (trimmed.empty() || trimmed.startswith("#"))
			continue;
		entries.push_back(trimmed.str());
	}

	return entries;
}

void DevilangCG::pruneBlocklist(DevilangCGResult::AdjList &adj) {
	if (DevilangBlocklistFile.empty()) {
		errs() << "DevilangCG: blocklist pruning requested but "
				  "-llvm-cg-blocklist not specified\n";
		return;
	}

	auto patterns = loadFileLines(DevilangBlocklistFile);
	if (patterns.empty())
		return;

	std::vector<std::regex> regexes;
	regexes.reserve(patterns.size());
	for (const auto &pat : patterns) {
		try {
			regexes.emplace_back(pat);
		} catch (const std::regex_error &e) {
			errs() << "DevilangCG: invalid regex '" << pat
				   << "': " << e.what() << "\n";
		}
	}

	if (regexes.empty())
		return;

	auto isBlocked = [&](StringRef name) -> bool {
		const std::string s = name.str();
		for (const auto &re : regexes) {
			if (std::regex_search(s, re))
				return true;
		}
		return false;
	};

	std::set<std::string> removeSet;
	for (const auto &kv : adj) {
		const std::string &func = kv.first;
		const std::set<std::string> &callees = kv.second;
		if (isBlocked(func))
			removeSet.insert(func);
		for (const std::string &callee : callees) {
			if (isBlocked(callee))
				removeSet.insert(callee);
		}
	}

	for (const std::string &func : removeSet)
		adj.erase(func);

	for (auto &kv : adj) {
		std::set<std::string> &callees = kv.second;
		for (const std::string &blocked : removeSet)
			callees.erase(blocked);
	}

	errs() << "DevilangCG: blocklist pruned " << removeSet.size()
		   << " nodes using " << regexes.size() << " patterns\n";
}

void DevilangCG::pruneGraph(DevilangCGResult::AdjList &adj,
							 const std::vector<Group> &groups) {
	(void)groups;
	for (PrunePolicy policy : DevilangPrune) {
		switch (policy) {
		case PrunePolicy::None:
			break;
		case PrunePolicy::Blocklist:
			pruneBlocklist(adj);
			break;
		}
	}
}

void DevilangCG::pruneUnreachable(DevilangCGResult::AdjList &adj,
                                   const std::vector<Group> &groups) {
	if (groups.empty())
		return;

	// Collect target set from [entry_point] groups.
	bool hasPruneMarkers = false;
	for (const auto &g : groups) {
		if (g.entryPoint) {
			hasPruneMarkers = true;
			break;
		}
	}
	if (!hasPruneMarkers) {
		errs() << "DevilangCG: reachability pruning skipped "
		       << "(no [entry_point] groups)\n";
		return;
	}
	std::unordered_set<std::string> targets;
	for (const auto &g : groups) {
		if (!g.entryPoint)
			continue;
		for (const auto &m : g.members)
			targets.insert(m);
	}
	errs() << "DevilangCG: reachability pruning mode=entry_point"
		   << ", target-functions=" << targets.size() << "\n";

	// Build reverse adjacency: callee -> set of callers.
	std::unordered_map<std::string, std::unordered_set<std::string>> reverse;
	for (const auto &kv : adj)
		for (const auto &callee : kv.second)
			reverse[callee].insert(kv.first);

	// Backward BFS (reverse graph): ancestors that can reach a group member.
	std::unordered_set<std::string> reachable;
	{
		std::queue<std::string> worklist;
		for (const auto &t : targets)
			if ((adj.count(t) || reverse.count(t)) && reachable.insert(t).second)
				worklist.push(t);
		while (!worklist.empty()) {
			const std::string node = std::move(worklist.front());
			worklist.pop();
			auto it = reverse.find(node);
			if (it == reverse.end()) continue;
			for (const auto &caller : it->second)
				if (reachable.insert(caller).second)
					worklist.push(caller);
		}
	}

	// Forward BFS (forward graph): descendants reachable from a group member.
	{
		std::queue<std::string> worklist;
		// Seed from all targets unconditionally (they may already be in reachable
		// from the backward pass, so we can't gate on insert success here).
		for (const auto &t : targets)
			if (adj.count(t) || reverse.count(t))
				worklist.push(t);
		while (!worklist.empty()) {
			const std::string node = std::move(worklist.front());
			worklist.pop();
			auto it = adj.find(node);
			if (it == adj.end()) continue;
			for (const auto &callee : it->second)
				if (reachable.insert(callee).second)
					worklist.push(callee);
		}
	}

	// Remove nodes not in the reachable set and strip their outgoing edges.
	std::size_t removed = 0;
	for (auto it = adj.begin(); it != adj.end(); ) {
		if (reachable.find(it->first) == reachable.end()) {
			it = adj.erase(it);
			++removed;
		} else {
			auto &callees = it->second;
			for (auto cit = callees.begin(); cit != callees.end(); )
				cit = (reachable.find(*cit) == reachable.end())
				          ? callees.erase(cit) : std::next(cit);
			++it;
		}
	}
	errs() << "DevilangCG: reachability pruned " << removed
	       << " nodes (kept " << reachable.size() << " reachable)\n";
}

void DevilangCG::loadExtraEdges(const std::string &path,
                                DevilangCGResult::AdjList &adj) {
	if (path.empty())
		return;
	auto bufOrErr = MemoryBuffer::getFile(path);
	if (!bufOrErr) {
		errs() << "DevilangCG: cannot open extra-edges file " << path
		       << ": " << bufOrErr.getError().message() << "\n";
		return;
	}
	StringRef content = (*bufOrErr)->getBuffer();
	SmallVector<StringRef, 0> lines;
	content.split(lines, '\n');

	unsigned added = 0, suppressed = 0;
	for (const StringRef &line : lines) {
		StringRef trimmed = line.trim();
		if (trimmed.empty() || trimmed.startswith("#"))
			continue;
		// Lines starting with '!' suppress an edge: "! caller callee"
		bool suppress = trimmed.startswith("!");
		StringRef payload = suppress ? trimmed.drop_front(1).trim() : trimmed;
		auto [callerRef, rest] = payload.split(' ');
		StringRef calleeRef = rest.trim();
		if (callerRef.empty() || calleeRef.empty()) {
			errs() << "DevilangCG: extra-edges: malformed line (expected '[!] caller callee'): "
			       << trimmed << "\n";
			continue;
		}
		if (suppress) {
			auto it = adj.find(callerRef.str());
			if (it != adj.end())
				it->second.erase(calleeRef.str());
			++suppressed;
		} else {
			adj[callerRef.str()].insert(calleeRef.str());
			++added;
		}
	}
	errs() << "DevilangCG: extra-edges: added=" << added
	       << ", suppressed=" << suppressed << " (from " << path << ")\n";
}

bool DevilangCG::runOnModule(Module &M) {
	DevilangCGResult::AdjList graph;
	bool changed = processModule(M, &graph);
	getAnalysis<DevilangCGResult>().setGraph(std::move(graph));
	return changed;
}

bool DevilangCG::processModule(Module &M, DevilangCGResult::AdjList *outGraph) {
	errs() << "DevilangCG: loading KallGraph call graph...\n";
	if (DevilangKallgraphInput.empty()) {
		errs() << "DevilangCG: specify -llvm-cg-kallgraph\n";
		return false;
	}
	auto debugLocMap = buildDebugLocMap(M);
	errs() << "DevilangCG: debug location map entries (main module)=" << debugLocMap.size() << "\n";

	// Build and merge direct call graph from LLVM IR.
	auto directAdj = buildDirectCallGraph(M);

	if (!DevilangBCList.empty()) {
		auto bcPaths = loadFileLines(DevilangBCList);
		unsigned loaded = 0, failed = 0;
		for (const std::string &bcPath : bcPaths) {
			SMDiagnostic Err;
			auto extraMod = parseIRFile(bcPath, Err, M.getContext());
			if (!extraMod) {
				++failed;
				continue;
			}
			// Augment debug location map for KallGraph caller resolution.
			auto extraMap = buildDebugLocMap(*extraMod);
			for (auto &kv : extraMap)
				debugLocMap[kv.first].insert(kv.second.begin(), kv.second.end());
			// Also extract direct calls from this module so declarations in
			// the main module (stripped by llvm-link -only-needed) get their
			// outgoing edges populated.
			auto extraAdj = buildDirectCallGraph(*extraMod);
			for (auto &kv : extraAdj)
				directAdj[kv.first].insert(kv.second.begin(), kv.second.end());
			++loaded;
		}
		errs() << "DevilangCG: augmented from bc-list: loaded=" << loaded
			   << ", failed=" << failed
			   << ", debug map entries=" << debugLocMap.size()
			   << ", direct cg nodes=" << directAdj.size() << "\n";
	}
	errs() << "DevilangCG: direct call graph nodes=" << directAdj.size() << "\n";

	// Load KallGraph (indirect call graph) and resolve file:line callers.
	auto indirectAdj = buildAdjListFromKallgraph(DevilangKallgraphInput, debugLocMap);

	// Merge: start with the full direct graph, add all indirect edges on top.
	auto merged = directAdj;
	for (auto &kv : indirectAdj)
		merged[kv.first].insert(kv.second.begin(), kv.second.end());

	auto groups = loadGroups(DevilangGroupsFile);

	if (DevilangPrune.empty()) {
		errs() << "DevilangCG: skipped pruning (no policies specified)\n";
	} else {
		errs() << "DevilangCG: pruning merged graph with " << DevilangPrune.size()
			   << " policy(s)\n";
		pruneGraph(merged, groups);
	}

	// Inject/suppress manual edges after blocklist pruning so that additions
	// are not immediately removed by blocklist patterns.
	loadExtraEdges(DevilangExtraEdgesFile, merged);

	if (DevilangReachabilityPrune)
		pruneUnreachable(merged, groups);
	else
		errs() << "DevilangCG: reachability pruning disabled "
		       << "(pass -llvm-cg-reachability-prune to enable)\n";

	// Ensure every group member has an entry in merged so it appears as a node
	// even if it has no edges after pruning.
	for (const auto &g : groups)
		for (const auto &m : g.members)
			merged.emplace(m, std::set<std::string>{});

	// Remove isolated nodes: no outgoing edges and no incoming edges.
	{
		std::unordered_set<std::string> hasInEdge;
		for (const auto &kv : merged)
			for (const auto &callee : kv.second)
				hasInEdge.insert(callee);

		std::size_t isolated = 0;
		for (auto it = merged.begin(); it != merged.end(); ) {
			if (it->second.empty() && !hasInEdge.count(it->first)) {
				it = merged.erase(it);
				++isolated;
			} else {
				++it;
			}
		}
		if (isolated)
			errs() << "DevilangCG: removed " << isolated << " isolated nodes\n";
	}

	std::size_t mergedEdges = 0;
	for (const auto &kv : merged)
		mergedEdges += kv.second.size();

	if (outGraph)
		*outGraph = merged;

	errs() << "DevilangCG: exporting DOT to " << DevilangDotOutput
		   << " (groups=" << groups.size() << ")\n";
	exportDOT(merged, DevilangDotOutput, groups);

	errs() << "DevilangCG: done."
		   << " merged nodes=" << merged.size() << ", merged edges=" << mergedEdges << "\n";

	return false;
}

PreservedAnalyses DevilangCGNewPM::run(Module &M, ModuleAnalysisManager &) {
	DevilangCG legacy;
	legacy.processModule(M, nullptr);
	return PreservedAnalyses::all();
}

llvm::PassPluginLibraryInfo getDevilangPluginInfo() {
	return {LLVM_PLUGIN_API_VERSION, "DevilangCG", LLVM_VERSION_STRING,
		[](PassBuilder &PB) {
			PB.registerPipelineParsingCallback(
					[](StringRef Name, llvm::ModulePassManager &PM,
						ArrayRef<llvm::PassBuilder::PipelineElement>) {
					if (Name == "llvm-cg") {
						PM.addPass(DevilangCGNewPM());
						return true;
					}
					return false;
					});
		}};
}

#ifndef LLVM_BYE_LINK_INTO_TOOLS
extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
	return getDevilangPluginInfo();
}
#endif
