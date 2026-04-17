import { toolCatalog } from "@ossr/tool-registry";
import { workflowCatalog } from "@ossr/workflows";

function printList(kind: "tool" | "workflow") {
  const items = kind === "tool" ? toolCatalog : workflowCatalog;
  for (const item of items) {
    console.log(`${item.name}	${item.summary}`);
  }
}

const [, , category, command] = process.argv;

if (!category || category === "help" || category === "--help") {
  console.log("ossr tool list");
  console.log("ossr workflow list");
  process.exit(0);
}

if (category === "tool" && command === "list") {
  printList("tool");
  process.exit(0);
}

if (category === "workflow" && command === "list") {
  printList("workflow");
  process.exit(0);
}

console.error("Unsupported command in draft scaffold.");
process.exit(1);
