import { toolCatalog } from "@morpheus/tool-registry";
import { workflowCatalog } from "@morpheus/workflows";

function printList(kind: "tool" | "workflow") {
  const items = kind === "tool" ? toolCatalog : workflowCatalog;
  for (const item of items) {
    console.log(`${item.name}	${item.summary}`);
  }
}

const [, , category, command] = process.argv;

if (!category || category === "help" || category === "--help") {
  console.log("morpheus tool list");
  console.log("morpheus workflow list");
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
