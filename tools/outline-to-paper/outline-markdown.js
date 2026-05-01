function outlineToMarkdown(document) {
  const lines = [];
  lines.push(`# ${document && document.title ? document.title : ""}`);

  for (const section of Array.isArray(document && document.sections) ? document.sections : []) {
    lines.push("");
    lines.push(`## ${section && section.title ? section.title : ""}`);
    if (section && typeof section.purpose === "string" && section.purpose.trim()) {
      lines.push("");
      lines.push(`> ${section.purpose.trim()}`);
    }
    for (const paragraph of Array.isArray(section && section.paragraphs) ? section.paragraphs : []) {
      for (const argument of Array.isArray(paragraph && paragraph.arguments) ? paragraph.arguments : []) {
        const text = String(argument && argument.text ? argument.text : "").trim();
        if (!text) {
          continue;
        }
        lines.push("");
        lines.push(`- ${text}`);
        for (const support of Array.isArray(argument && argument.supports) ? argument.supports : []) {
          const content = String(support && support.content ? support.content : "").trim();
          if (content) {
            lines.push(`  - ${content}`);
          }
        }
      }
    }
  }

  const references = Array.isArray(document && document.references) ? document.references : [];
  if (references.length > 0) {
    lines.push("");
    lines.push("## References");
    for (const reference of references) {
      lines.push("");
      lines.push(`- ${reference && reference.citation_key ? reference.citation_key : ""}: ${reference && reference.title ? reference.title : ""}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  outlineToMarkdown,
};
