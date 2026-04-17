#ifndef DEVILANG_CG_H
#define DEVILANG_CG_H

#include "llvm/Pass.h"
#include "llvm/IR/Module.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/FileSystem.h"

#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

/// ImmutablePass that holds the call graph adjacency list.
/// Populated by DevilangCG, consumed by downstream passes.
class DevilangCGResult : public llvm::ImmutablePass {
public:
	static char ID;

	using AdjList = std::unordered_map<std::string, std::set<std::string>>;

	DevilangCGResult() : llvm::ImmutablePass(ID) {}

	void setGraph(AdjList graph) { adjList_ = std::move(graph); }
	const AdjList &getGraph() const { return adjList_; }

private:
	AdjList adjList_;
};

/// Pruning policies for the call graph.
enum class PrunePolicy {
	None,
	Blocklist
};

/// ModulePass that loads a KallGraph output file and builds a full call graph.
/// The resulting graph can be pruned and exported as DOT.
class DevilangCG : public llvm::ModulePass {
public:
	static char ID;

	DevilangCG() : llvm::ModulePass(ID) {}

	bool runOnModule(llvm::Module &M) override;
	void getAnalysisUsage(llvm::AnalysisUsage &AU) const override;

private:
	/// Build adjacency list from KallGraph output (caller/count/callee block format).
	DevilangCGResult::AdjList buildAdjListFromKallgraph(
		const std::string &path,
		const std::unordered_map<std::string, std::set<std::string>> &debugLocMap);

	/// Build direct call graph from LLVM IR (non-indirect, non-intrinsic calls only).
	DevilangCGResult::AdjList buildDirectCallGraph(llvm::Module &M);

	/// Build a map: "file:line" -> {function names} from module debug locations.
	std::unordered_map<std::string, std::set<std::string>>
	buildDebugLocMap(llvm::Module &M);

	/// Resolve a KallGraph caller token (function name or file:line) into function name.
	std::string resolveCallerName(
		llvm::StringRef callerToken,
		const std::unordered_map<std::string, std::set<std::string>> &debugLocMap);

	/// A named group of functions to be rendered as a cluster in the DOT output.
	struct Group {
		std::string label;
		std::vector<std::string> members;
		// If true, group members are execution entry points (distinct visual style).
		// Members are included in the reachability target set.
		bool entryPoint = false;
		// Rank hint for DOT layout: force cluster to top (rank=min) or bottom (rank=max).
		enum class Rank { None, Top, Bottom } rankHint = Rank::None;
	};

	/// Load groups from file: first non-blank/non-comment line per block is the
	/// group label, following lines are member function names, blank line separates groups.
	std::vector<Group> loadGroups(const std::string &path);

	/// Export graph as DOT, optionally annotating clusters from groups.
	void exportDOT(const DevilangCGResult::AdjList &adj,
				   const std::string &path,
				   const std::vector<Group> &groups = {});

	/// Export collapsed DOT: each group is merged into a single node.
	void exportCollapsedDOT(const DevilangCGResult::AdjList &adj,
							const std::string &path,
							const std::vector<Group> &groups);

	/// Dispatch pruning based on selected policies.
	void pruneGraph(DevilangCGResult::AdjList &adj,
					const std::vector<Group> &groups);

	/// Remove nodes that cannot reach any member of any group (reverse BFS).
	void pruneUnreachable(DevilangCGResult::AdjList &adj,
						  const std::vector<Group> &groups);

	/// Remove nodes matching regex patterns loaded from blocklist.
	void pruneBlocklist(DevilangCGResult::AdjList &adj);

	/// Keep only grouped nodes and add direct edges when one grouped node can
	/// reach another grouped node (including within the same group).
	void pruneGroupReachabilityCollapse(DevilangCGResult::AdjList &adj,
										const std::vector<Group> &groups);

	/// Load entries from file: one per line, skipping blank and '#' comment lines.
	std::vector<std::string> loadFileLines(const std::string &path);

	/// Load manual edges from file and apply to adj.
	/// Format: one directive per line:
	///   "caller callee"   — add edge
	///   "! caller callee" — suppress (remove) edge
	/// Blank lines and lines starting with '#' are ignored.
	void loadExtraEdges(const std::string &path, DevilangCGResult::AdjList &adj);
};

#endif // DEVILANG_CG_H
