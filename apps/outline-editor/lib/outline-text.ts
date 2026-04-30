export type OutlineSupport = {
  support_id: string;
  type: string;
  status: string;
  content: string;
  reference_ids: string[];
};

export type OutlineArgument = {
  argument_id: string;
  type: string;
  text: string;
  supports: OutlineSupport[];
};

export type OutlineParagraph = {
  paragraph_id: string;
  role: string;
  topic?: string;
  arguments: OutlineArgument[];
};

export type OutlineSection = {
  section_id: string;
  title: string;
  purpose?: string;
  paragraphs: OutlineParagraph[];
};

export type OutlineReference = {
  ref_id: string;
  citation_key: string;
  title: string;
  authors?: string[];
  year?: number | null;
  status?: string;
  bibtex?: string;
};

export type OutlineDocument = {
  title: string;
  template?: string | null;
  references?: OutlineReference[];
  sections: OutlineSection[];
};

export type TextSection = {
  title: string;
  purpose?: string;
  arguments: Array<{
    text: string;
    supports: string[];
  }>;
};

export type TextDocument = {
  title: string;
  sections: TextSection[];
  references: Array<{
    citationKey: string;
    title: string;
  }>;
};

function slug(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeBlockLines(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

export function outlineToText(document: OutlineDocument) {
  const lines: string[] = [];
  lines.push(`Title: ${document.title || ""}`);
  for (const section of document.sections || []) {
    lines.push("");
    lines.push(`# ${section.title || ""}`);
    if (section.purpose && section.purpose.trim()) {
      lines.push("");
      lines.push(`> ${section.purpose.trim()}`);
    }
    for (const paragraph of section.paragraphs || []) {
      for (const argument of paragraph.arguments || []) {
        lines.push("");
        lines.push(String(argument.text || "").trim());
        for (const support of argument.supports || []) {
          const content = String(support.content || "").trim();
          if (content) {
            lines.push(`- ${content}`);
          }
        }
      }
    }
  }
  const references = Array.isArray(document.references) ? document.references : [];
  if (references.length > 0) {
    lines.push("");
    lines.push("# References");
    for (const reference of references) {
      lines.push("");
      lines.push(`- ${reference.citation_key || ""} | ${reference.title || ""}`);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function parseTextDocument(text: string): TextDocument {
  const rawLines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const sections: TextSection[] = [];
  const references: Array<{ citationKey: string; title: string }> = [];
  let currentSection: TextSection | null = null;
  let inReferences = false;
  let block: string[] = [];

  const flushBlock = () => {
    if (!currentSection || block.length === 0) {
      block = [];
      return;
    }
    const lines = normalizeBlockLines(block);
    block = [];
    if (lines.length === 0) {
      return;
    }
    if (lines.every((line) => line.startsWith("> "))) {
      currentSection.purpose = lines.map((line) => line.slice(2).trim()).join(" ");
      return;
    }
    const textLines = lines.filter((line) => !line.startsWith("- "));
    const supportLines = lines
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
    if (textLines.length === 0) {
      return;
    }
    currentSection.arguments.push({
      text: textLines.join(" "),
      supports: supportLines,
    });
  };

  for (const rawLine of rawLines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!title && trimmed.startsWith("Title:")) {
      title = trimmed.slice("Title:".length).trim();
      continue;
    }
    if (trimmed === "") {
      flushBlock();
      continue;
    }
    if (trimmed === "# References") {
      flushBlock();
      currentSection = null;
      inReferences = true;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushBlock();
      inReferences = false;
      currentSection = {
        title: trimmed.slice(2).trim(),
        arguments: [],
      };
      sections.push(currentSection);
      continue;
    }
    if (inReferences && trimmed.startsWith("- ")) {
      const value = trimmed.slice(2);
      const [citationKeyPart, ...titleParts] = value.split("|");
      references.push({
        citationKey: String(citationKeyPart || "").trim(),
        title: titleParts.join("|").trim(),
      });
      continue;
    }
    block.push(trimmed);
  }
  flushBlock();
  return {
    title,
    sections,
    references,
  };
}

export function textDocumentToOutline(textDocument: TextDocument, previous: OutlineDocument | null = null): OutlineDocument {
  const previousSections = Array.isArray(previous?.sections) ? previous.sections : [];
  const previousReferences = Array.isArray(previous?.references) ? previous.references : [];
  const sections = textDocument.sections.map((section, sectionIndex) => {
    const previousSection = previousSections[sectionIndex] || null;
    return {
      section_id: previousSection?.section_id || `sec-${String(sectionIndex + 1).padStart(2, "0")}-${slug(section.title, "section")}`,
      title: section.title,
      ...(section.purpose ? { purpose: section.purpose } : {}),
      paragraphs: section.arguments.map((argument, argumentIndex) => ({
        paragraph_id: previousSection?.paragraphs?.[argumentIndex]?.paragraph_id || `${previousSection?.section_id || `sec-${String(sectionIndex + 1).padStart(2, "0")}`}-p${String(argumentIndex + 1).padStart(2, "0")}`,
        role: argumentIndex === 0 ? "argument" : "argument",
        arguments: [
          {
            argument_id: previousSection?.paragraphs?.[argumentIndex]?.arguments?.[0]?.argument_id || `${previousSection?.section_id || `sec-${String(sectionIndex + 1).padStart(2, "0")}`}-a${String(argumentIndex + 1).padStart(2, "0")}`,
            type: "claim",
            text: argument.text,
            supports: argument.supports.map((support, supportIndex) => ({
              support_id:
                previousSection?.paragraphs?.[argumentIndex]?.arguments?.[0]?.supports?.[supportIndex]?.support_id
                || `${previousSection?.section_id || `sec-${String(sectionIndex + 1).padStart(2, "0")}`}-s${String(argumentIndex + 1).padStart(2, "0")}${String.fromCharCode(97 + supportIndex)}`,
              type: "example",
              status: "available",
              content: support,
              reference_ids: [],
            })),
          },
        ],
      })),
    };
  });
  const references = textDocument.references.map((reference, index) => ({
    ref_id: previousReferences[index]?.ref_id || `ref-${String(index + 1).padStart(2, "0")}`,
    citation_key: reference.citationKey,
    title: reference.title,
    status: previousReferences[index]?.status || "available",
    ...(previousReferences[index]?.bibtex ? { bibtex: previousReferences[index].bibtex } : {}),
  }));
  return {
    title: textDocument.title,
    template: previous?.template || null,
    ...(references.length > 0 ? { references } : {}),
    sections,
  };
}
