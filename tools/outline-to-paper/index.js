#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { outlineToMarkdown } = require("./outline-markdown");

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(["json", "help"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positionals, flags };
}

function printJson(value) {
  fs.writeSync(1, `${JSON.stringify(value)}\n`);
}

function usage() {
  return [
    "Usage:",
    "  outline-to-paper is Morpheus-managed.",
    "  Use Morpheus workflow commands instead of invoking this tool directly.",
    "  Example:",
    "    node apps/morpheus/dist/cli.js workflow run --name outline-paper-sample --json",
    "",
    "Run phases (for Morpheus-managed use):",
    "  outline-to-paper run --only-phase outline|revise|draft|edit|review",
    "  outline-to-paper run --from-phase outline|revise|draft|edit|review [--to-phase ...]",
    "  outline-to-paper stop",
  ].join("\n");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseDotEnv(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    values[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function loadDotEnvValues() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(repoToolRoot(), ".env"),
    path.join(path.dirname(repoToolRoot()), ".env"),
  ];
  const loaded = {};
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    Object.assign(loaded, parseDotEnv(readText(candidate)));
  }
  return loaded;
}

function loadYamlWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = process.env.MORPHEUS_CONFIG
      ? path.resolve(process.env.MORPHEUS_CONFIG)
      : path.join(current, "morpheus.yaml");
    if (fs.existsSync(candidate)) {
      const text = fs.readFileSync(candidate, "utf8");
      const match = text.match(/^\s*workspace:\s*(?:\r?\n)+\s*root:\s*(.+)\s*$/m);
      if (match && match[1]) {
        const root = String(match[1]).trim().replace(/^['"]|['"]$/g, "");
        return path.resolve(path.dirname(candidate), root);
      }
      break;
    }
    if (process.env.MORPHEUS_CONFIG) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function resolveWorkspace(flags) {
  if (flags.workspace) {
    return path.resolve(String(flags.workspace));
  }
  const fromConfig = loadYamlWorkspaceRoot(process.cwd());
  if (fromConfig) {
    return fromConfig;
  }
  throw new Error("outline-to-paper requires --workspace DIR or workspace.root in morpheus.yaml");
}

function repoToolRoot() {
  return __dirname;
}

function managedStepDir() {
  const cwd = path.resolve(process.cwd());
  return fs.existsSync(path.join(cwd, "step.json")) ? cwd : null;
}

function requireManagedInvocation(command) {
  const stepDir = managedStepDir();
  if (!stepDir) {
    throw new Error(
      `${command} is Morpheus-managed only; use 'morpheus workflow run/inspect/logs' instead of invoking outline-to-paper directly`
    );
  }
  return stepDir;
}

function runsRoot(workspace) {
  return path.join(path.resolve(workspace), "runs");
}

function outlineStateRoot(workspace, runDir = null) {
  const workflowRunRoot = workflowRunRootFromRunDir(runDir);
  if (!workflowRunRoot) {
    throw new Error("outline-to-paper requires a workflow-managed run directory for outline state");
  }
  return workflowRunRoot;
}

function currentOutlinePath(workspace, runDir = null) {
  return path.join(outlineStateRoot(workspace, runDir), "current-outline.json");
}

function currentOutlineVersionsDir(workspace, runDir = null) {
  return path.join(outlineStateRoot(workspace, runDir), "outline-versions");
}

function readCurrentOutlineSymlink(workspace, runDir = null) {
  const currentPath = currentOutlinePath(workspace, runDir);
  if (!fs.existsSync(currentPath) || !fs.lstatSync(currentPath).isSymbolicLink()) {
    return null;
  }
  const target = fs.readlinkSync(currentPath);
  return path.resolve(path.dirname(currentPath), target);
}

function nextOutlineVersionPath(workspace, runDir = null) {
  const versionsDir = currentOutlineVersionsDir(workspace, runDir);
  fs.mkdirSync(versionsDir, { recursive: true });
  const existing = fs.readdirSync(versionsDir)
    .map((name) => {
      const match = name.match(/^outline-v(\d+)\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isFinite(value));
  const nextVersion = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  return path.join(versionsDir, `outline-v${String(nextVersion).padStart(4, "0")}.json`);
}

function writeVersionedCurrentOutline(workspace, outline, metadata = {}) {
  const versionPath = nextOutlineVersionPath(workspace, metadata.runDir || null);
  const currentPath = currentOutlinePath(workspace, metadata.runDir || null);
  const payload = {
    schema_version: 1,
    version_id: path.basename(versionPath, ".json"),
    updated_at: new Date().toISOString(),
    source: metadata.source || null,
    workflow_run_id: metadata.workflow_run_id || null,
    step_id: metadata.step_id || null,
    outline,
  };
  writeJson(versionPath, payload);
  try {
    fs.unlinkSync(currentPath);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
  fs.symlinkSync(path.relative(path.dirname(currentPath), versionPath), currentPath);
  return {
    currentPath,
    versionPath,
    payload,
  };
}

function readOutlinePayload(filePath) {
  const value = readJson(filePath);
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.schema_version === 1
    && value.outline
    && typeof value.outline === "object"
  ) {
    return {
      outline: value.outline,
      metadata: value,
    };
  }
  return {
    outline: value,
    metadata: null,
  };
}

function workflowRunRootFromRunDir(stepDir) {
  const stepsDir = path.dirname(stepDir);
  return path.basename(stepsDir) === "steps" ? path.dirname(stepsDir) : null;
}

function siblingStepRunDir(stepDir, stepId) {
  const workflowRunRoot = workflowRunRootFromRunDir(stepDir);
  if (!workflowRunRoot) {
    return null;
  }
  return path.join(workflowRunRoot, "steps", stepId);
}

function normalizedOutlineFromWorkflow(runDir) {
  const siblingRunDir = siblingStepRunDir(runDir, "outline_phase");
  if (!siblingRunDir) {
    return null;
  }
  const candidate = path.join(siblingRunDir, "outline", "normalized-outline.json");
  return fs.existsSync(candidate) ? candidate : null;
}

function resolvePhaseOutlineInput(workspace, requestedOutlinePath, phases, runDir) {
  const currentPath = currentOutlinePath(workspace, runDir);
  const currentTargetPath = readCurrentOutlineSymlink(workspace, runDir)
    || (fs.existsSync(currentPath) ? currentPath : null);
  const normalizedFromOutlinePhase = normalizedOutlineFromWorkflow(runDir);
  if (phases.has("revise")) {
    if (normalizedFromOutlinePhase) {
      return {
        path: normalizedFromOutlinePhase,
        source: "outline-phase-normalized",
      };
    }
    if (currentTargetPath) {
      return {
        path: currentTargetPath,
        source: "current-outline",
      };
    }
    return {
      path: requestedOutlinePath,
      source: "requested-outline",
    };
  }
  if (currentTargetPath) {
    return {
      path: currentTargetPath,
      source: "current-outline",
    };
  }
  return {
    path: requestedOutlinePath,
    source: "requested-outline",
  };
}

function generateRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 10);
  return `paper-${stamp}-${random}`;
}

function guessTitle(outlinePath, outline) {
  if (outline && typeof outline.title === "string" && outline.title.trim()) {
    return outline.title.trim();
  }
  return path.basename(outlinePath, path.extname(outlinePath)).replace(/[-_]+/g, " ");
}

function iterateSections(sections, visit) {
  if (!Array.isArray(sections)) {
    return;
  }
  for (const section of sections) {
    visit(section);
    if (Array.isArray(section && section.subsections) && section.subsections.length > 0) {
      iterateSections(section.subsections, visit);
    }
  }
}

function collectArgumentsFromSections(sections) {
  const items = [];
  iterateSections(sections, (section) => {
    const sectionName = section && (section.title || section.name) ? String(section.title || section.name) : "";
    if (!Array.isArray(section && section.paragraphs)) {
      return;
    }
    for (const paragraph of section.paragraphs) {
      if (!Array.isArray(paragraph && paragraph.arguments)) {
        continue;
      }
      for (const argument of paragraph.arguments) {
        if (!argument) {
          continue;
        }
        items.push({
          claim_id: argument.argument_id || argument.claim_id || argument.id || argument.text,
          text: argument.text || argument.claim || argument.topic || "",
          kind: argument.type || "supporting",
          priority: argument.priority || "medium",
          status: argument.status || "ready",
          section_hint: sectionName || null,
        });
      }
    }
  });
  return items.filter((item) => item.claim_id && item.text);
}

function collectSupportsFromSections(sections) {
  const items = [];
  iterateSections(sections, (section) => {
    if (!Array.isArray(section && section.paragraphs)) {
      return;
    }
    for (const paragraph of section.paragraphs) {
      if (!Array.isArray(paragraph && paragraph.arguments)) {
        continue;
      }
      for (const argument of paragraph.arguments) {
        if (!Array.isArray(argument && argument.supports)) {
          continue;
        }
        for (const support of argument.supports) {
          if (!support) {
            continue;
          }
          items.push({
            support_id: support.support_id || support.id || `${argument.argument_id || argument.claim_id || "arg"}-support-${items.length + 1}`,
            claim_id: argument.argument_id || argument.claim_id || argument.id || null,
            type: support.type || "support",
            status: support.status || "available",
            label: support.label || support.content || "",
            reason: support.reason || null,
            todo: support.todo || null,
            reference_ids: Array.isArray(support.reference_ids) ? support.reference_ids : [],
            content: support.content || "",
          });
        }
      }
    }
  });
  return items;
}

function deriveClaims(outline) {
  if (!Array.isArray(outline && outline.sections) || outline.sections.length === 0) {
    return [];
  }
  return collectArgumentsFromSections(outline.sections);
}

function explicitSectionWordBudget(section) {
  const explicit = Number(section && section.target_words);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return null;
}

function deriveClaimIdsFromSection(section) {
  const paragraphBlocks = Array.isArray(section && section.paragraphs)
    ? section.paragraphs
    : Array.isArray(section && section.source_paragraphs)
      ? section.source_paragraphs
      : [];
  const fromParagraphs = paragraphBlocks
    .flatMap((paragraph) => (
      Array.isArray(paragraph && paragraph.arguments)
        ? paragraph.arguments.map((argument) => argument.argument_id || argument.claim_id || argument.text).filter(Boolean)
        : []
    ));
  const fromSubsections = Array.isArray(section && section.subsections)
    ? section.subsections.flatMap((subsection) => (
      Array.isArray(subsection && subsection.paragraphs)
        ? subsection.paragraphs.flatMap((paragraph) => (
          Array.isArray(paragraph && paragraph.arguments)
            ? paragraph.arguments.map((argument) => argument.argument_id || argument.claim_id || argument.text).filter(Boolean)
            : []
        ))
        : []
    ))
    : [];
  return [...new Set([...fromParagraphs, ...fromSubsections])];
}

function sectionClaimIds(section) {
  return deriveClaimIdsFromSection(section);
}

function stripSectionClaimIds(section) {
  const next = { ...section };
  delete next.claim_ids;
  if (Array.isArray(next.subsections)) {
    next.subsections = next.subsections.map((item) => stripSectionClaimIds(item));
  }
  return next;
}

function templateRoot(template) {
  return path.join(repoToolRoot(), "templates", template);
}

function loadTemplate(template) {
  const root = templateRoot(template);
  const metadataPath = path.join(root, "metadata.json");
  const latexTemplatePath = path.join(root, "paper.tex");
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`unknown template: ${template}`);
  }
  return {
    root,
    metadataPath,
    latexTemplatePath: fs.existsSync(latexTemplatePath) ? latexTemplatePath : null,
    metadata: readJson(metadataPath),
  };
}

function resolveTemplateSpec(templateMetadata, language) {
  const requestedLanguage = String(language || templateMetadata.default_language || "en").trim().toLowerCase();
  const profiles = templateMetadata.language_profiles && typeof templateMetadata.language_profiles === "object"
    ? templateMetadata.language_profiles
    : {};
  const profile = profiles[requestedLanguage] || null;
  return {
    ...templateMetadata,
    language: requestedLanguage,
    documentclass: profile && profile.documentclass ? profile.documentclass : templateMetadata.documentclass,
    latex_engine: profile && profile.latex_engine ? profile.latex_engine : templateMetadata.latex_engine,
  };
}

function reviewPromptsRoot() {
  return path.join(repoToolRoot(), "references", "essay-revise");
}

function loadReviewPrompt(name) {
  return readText(path.join(reviewPromptsRoot(), name));
}

function configuredDeepSeek() {
  const envFileValues = loadDotEnvValues();
  const apiKey = process.env.DEEPSEEK_API_KEY || envFileValues.DEEPSEEK_API_KEY || null;
  if (!apiKey) {
    return null;
  }
  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || envFileValues.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || envFileValues.DEEPSEEK_MODEL || "deepseek-v4-pro",
    reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT || envFileValues.DEEPSEEK_REASONING_EFFORT || "high",
    timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || envFileValues.DEEPSEEK_TIMEOUT_MS || 5000),
  };
}

async function deepSeekChat(config, systemPrompt, userPrompt, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs || 5000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        reasoning_effort: options.reasoningEffort || config.reasoningEffort,
        thinking: { type: "enabled" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    const content = payload
      && Array.isArray(payload.choices)
      && payload.choices[0]
      && payload.choices[0].message
      && typeof payload.choices[0].message.content === "string"
        ? payload.choices[0].message.content
        : null;
    if (!content) {
      throw new Error("DeepSeek API returned no message content");
    }
    return {
      content,
      raw: payload,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function stableText(value) {
  return JSON.stringify(value, null, 2);
}

function defaultSectionPlan(title, claims, templateSpec, outline = null) {
  if (!Array.isArray(outline && outline.sections) || outline.sections.length === 0) {
    throw new Error("outline-to-paper requires outline.sections to build a section plan");
  }
  const plannedSections = outline.sections.map((section, index) => {
    const sectionId = section.section_id || `sec-${index + 1}`;
    return {
      section_id: sectionId,
      name: section.title || section.name || `Section ${index + 1}`,
      order: index + 1,
      purpose: section.purpose || section.summary || `Develop the material for ${section.title || section.name || `Section ${index + 1}`}.`,
      target_words: explicitSectionWordBudget(section),
      source_paragraphs: Array.isArray(section.paragraphs) ? cloneJson(section.paragraphs) : [],
    };
  });
  return {
    title,
    template: templateSpec.id,
    venue: templateSpec.name,
    formatting_constraints: {
      page_format: templateSpec.page_format,
      main_pages_max: templateSpec.submission.main_pages_max,
      appendix_pages_max: templateSpec.submission.appendix_pages_max,
        total_pages_max: templateSpec.submission.total_pages_max,
        anonymous: templateSpec.submission.anonymous,
      },
    sections: plannedSections,
      total_target_words: plannedSections.reduce((sum, item) => sum + (item.target_words || 0), 0),
    };
  }

function deriveSupports(outline) {
  if (!Array.isArray(outline && outline.sections) || outline.sections.length === 0) {
    return [];
  }
  return collectSupportsFromSections(outline.sections);
}

function deriveReferences(outline) {
  return Array.isArray(outline && outline.references) ? outline.references : [];
}

const RUN_PHASES = ["outline", "revise", "draft", "edit", "review"];

function selectedPhases(flags) {
  const only = String(flags["only-phase"] || "").trim();
  const from = String(flags["from-phase"] || "").trim();
  const to = String(flags["to-phase"] || "").trim();

  const validate = (value, flagName) => {
    if (!value) {
      return "";
    }
    if (!RUN_PHASES.includes(value)) {
      throw new Error(`${flagName} must be one of: ${RUN_PHASES.join(", ")}`);
    }
    return value;
  };

  const onlyPhase = validate(only, "--only-phase");
  const fromPhase = validate(from, "--from-phase");
  const toPhase = validate(to, "--to-phase");

  if (onlyPhase && (fromPhase || toPhase)) {
    throw new Error("--only-phase cannot be combined with --from-phase or --to-phase");
  }

  if (onlyPhase) {
    return new Set([onlyPhase]);
  }

  const startIndex = fromPhase ? RUN_PHASES.indexOf(fromPhase) : 0;
  const endIndex = toPhase ? RUN_PHASES.indexOf(toPhase) : RUN_PHASES.length - 1;
  if (startIndex > endIndex) {
    throw new Error("--from-phase must not come after --to-phase");
  }
  return new Set(RUN_PHASES.slice(startIndex, endIndex + 1));
}

function deriveGaps(supports, references = []) {
  const gaps = [];
  for (const item of supports) {
    const status = String(item && item.status || "").trim().toLowerCase();
    if (status === "missing" || status === "partial" || status === "unavailable") {
      gaps.push({
        gap_id: `gap-${gaps.length + 1}`,
        claim_id: item.claim_id || null,
        missing_type: item.type || "support",
        reason: item.reason || `support marked ${status}`,
        severity: status === "missing" ? "high" : "medium",
        todo: item.todo || `Resolve ${item.type || "support"} gap for ${item.claim_id || "claim"}`,
      });
    }
  }
  for (const item of references) {
    const status = String(item && item.status || "").trim().toLowerCase();
    if (status === "missing" || status === "partial" || status === "placeholder") {
      gaps.push({
        gap_id: `gap-${gaps.length + 1}`,
        claim_id: Array.isArray(item.linked_claim_ids) ? item.linked_claim_ids[0] || null : null,
        missing_type: "reference",
        reason: item.reason || `reference marked ${status}`,
        severity: status === "missing" ? "high" : "medium",
        todo: item.todo || `Add or complete reference ${item.citation_key || item.ref_id || "citation"}`,
      });
    }
  }
  return { gaps };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function outlineSections(outline, sectionPlan) {
  if (Array.isArray(outline && outline.sections) && outline.sections.length > 0) {
    return cloneJson(outline.sections);
  }
  return [];
}

function syncOutlineSectionsFromDerivedState(revisedOutline) {
  const claimMap = new Map((revisedOutline.claims || []).map((claim) => [claim.claim_id, claim]));
  const supportMap = new Map((revisedOutline.supports || []).map((support) => [support.support_id, support]));
  iterateSections(revisedOutline.sections, (section) => {
    if (!Array.isArray(section && section.paragraphs)) {
      return;
    }
    for (const paragraph of section.paragraphs) {
      if (!Array.isArray(paragraph && paragraph.arguments)) {
        continue;
      }
      paragraph.arguments = paragraph.arguments
        .map((argument) => {
          const claimId = argument.argument_id || argument.claim_id || argument.id;
          const nextClaim = claimMap.get(claimId) || null;
          if (!nextClaim) {
            return null;
          }
          const originalSupports = Array.isArray(argument.supports) ? argument.supports : [];
          const preservedSupportIds = new Set(originalSupports.map((support) => support && (support.support_id || support.id)).filter(Boolean));
          const linkedSupports = (revisedOutline.supports || []).filter((support) => support.claim_id === claimId);
          const mergedSupports = [
            ...originalSupports
              .map((support) => {
                const supportId = support && (support.support_id || support.id);
                return supportId && supportMap.get(supportId)
                  ? normalizeNestedSupport({ ...support, ...supportMap.get(supportId) })
                  : support;
              }),
            ...linkedSupports
              .filter((support) => !preservedSupportIds.has(support.support_id))
              .map((support) => normalizeNestedSupport(support)),
          ];
          return {
            ...argument,
            argument_id: claimId,
            text: nextClaim.text,
            type: nextClaim.kind || argument.type,
            status: nextClaim.status || argument.status,
            priority: nextClaim.priority || argument.priority,
            supports: mergedSupports,
          };
        })
        .filter(Boolean);
    }
  });
}

function normalizeNestedSupport(support) {
  const next = {
    support_id: support.support_id || support.id,
    type: support.type || "support",
    status: support.status || "available",
    content: support.content || support.label || support.todo || "",
    reference_ids: Array.isArray(support.reference_ids) ? support.reference_ids : [],
  };
  if (support.reason) {
    next.reason = support.reason;
  }
  if (support.todo) {
    next.todo = support.todo;
  }
  return next;
}

function materializeOutlineDocument(snapshot) {
  return {
    title: snapshot.title,
    template: snapshot.template,
    references: cloneJson(snapshot.references || []),
    sections: cloneJson(snapshot.sections || []).map((section) => stripSectionClaimIds(section)),
  };
}

function buildOutlineSnapshot(outline, sectionPlan) {
  return {
    title: outline.title || null,
    template: outline.template || null,
    claims: cloneJson(deriveClaims(outline)),
    supports: cloneJson(deriveSupports(outline)),
    references: cloneJson(deriveReferences(outline)),
    sections: outlineSections(outline, sectionPlan),
  };
}

function priorityRank(value) {
  if (value === "high") {
    return 0;
  }
  if (value === "medium") {
    return 1;
  }
  return 2;
}

function createRequestedChange(dimension, requestId, targetKind, targetId, requestType, reason, todo, priority = "medium") {
  return {
    request_id: requestId,
    source_review: dimension,
    target_kind: targetKind,
    target_id: targetId,
    request_type: requestType,
    reason,
    todo,
    priority,
  };
}

function createDirectChange(dimension, changeId, targetKind, targetId, changeType, before, after, reason, priority = "medium") {
  return {
    change_id: changeId,
    source_review: dimension,
    target_kind: targetKind,
    target_id: targetId,
    change_type: changeType,
    before,
    after,
    reason,
    priority,
    preconditions: {
      target_text_equals: before || null,
    },
  };
}

function fallbackUnityReview(snapshot) {
  const changes = [];
  const requestedChanges = [];
  const seen = new Map();
  for (const claim of snapshot.claims) {
    const text = String(claim.text || "").trim().toLowerCase();
    if (!text) {
      continue;
    }
    if (seen.has(text)) {
      const first = seen.get(text);
      changes.push(createDirectChange(
        "unity",
        `unity-change-${changes.length + 1}`,
        "claim",
        claim.claim_id,
        "delete_claim",
        claim.text,
        "",
        `Claim duplicates ${first}.`,
        "medium",
      ));
      continue;
    }
    seen.set(text, claim.claim_id);
  }
  return {
    dimension: "unity",
    summary: changes.length > 0
      ? "Some claims repeat the same controlling idea and should be merged or removed."
      : "The outline-level claims appear focused with no obvious duplicate thesis statements.",
    changes,
    requested_changes: requestedChanges,
  };
}

function fallbackSupportReview(snapshot) {
  const requestedChanges = [];
  for (const support of snapshot.supports) {
    const status = String(support.status || "").trim().toLowerCase();
    if (status === "missing" || status === "partial" || status === "unavailable") {
      requestedChanges.push(createRequestedChange(
        "support",
        `support-request-${requestedChanges.length + 1}`,
        "claim",
        support.claim_id || "unknown-claim",
        support.type || "support",
        support.reason || `Support is marked ${status}.`,
        support.todo || `Add missing ${support.type || "support"} for ${support.claim_id || "claim"}.`,
        status === "missing" ? "high" : "medium",
      ));
    }
  }
  for (const reference of snapshot.references) {
    const status = String(reference.status || "").trim().toLowerCase();
    if (status === "missing" || status === "partial" || status === "placeholder") {
      requestedChanges.push(createRequestedChange(
        "support",
        `support-request-${requestedChanges.length + 1}`,
        "claim",
        Array.isArray(reference.linked_claim_ids) ? reference.linked_claim_ids[0] || "unknown-claim" : "unknown-claim",
        "citation",
        reference.reason || `Reference ${reference.citation_key || reference.ref_id || "citation"} is incomplete.`,
        reference.todo || `Add or complete reference ${reference.citation_key || reference.ref_id || "citation"}.`,
        status === "missing" ? "high" : "medium",
      ));
    }
  }
  return {
    dimension: "support",
    summary: requestedChanges.length > 0
      ? "Several claims still need concrete support or complete citations."
      : "All current support and reference slots are marked available.",
    changes: [],
    requested_changes: requestedChanges,
  };
}

function fallbackCoherenceReview(snapshot) {
  const changes = [];
  for (const claim of snapshot.claims) {
    if (!claim.section_hint) {
      continue;
    }
    const section = snapshot.sections.find((item) => sectionClaimIds(item).includes(claim.claim_id));
    if (!section || section.name === claim.section_hint) {
      continue;
    }
    changes.push(createDirectChange(
      "coherence",
      `coherence-change-${changes.length + 1}`,
      "section",
      claim.claim_id,
      "reassign_section",
      section.name,
      claim.section_hint,
      `Claim ${claim.claim_id} is hinted for ${claim.section_hint} but currently mapped to ${section.name}.`,
      "medium",
    ));
  }
  return {
    dimension: "coherence",
    summary: changes.length > 0
      ? "Some claims appear to be assigned to sections that do not match their intended placement."
      : "The current section-to-claim mapping is coherent enough for drafting.",
    changes,
    requested_changes: [],
  };
}

function tightenSentence(text) {
  let next = String(text || "");
  next = next.replace(/\bvery\b/gi, "").replace(/\s{2,}/g, " ").trim();
  next = next.replace(/\bmany different\b/gi, "several");
  next = next.replace(/\bis novel\b/gi, "has a specific novelty claim");
  return next;
}

function fallbackSentenceSkillsReview(snapshot) {
  const changes = [];
  for (const claim of snapshot.claims) {
    const original = String(claim.text || "").trim();
    if (!original) {
      continue;
    }
    const tightened = tightenSentence(original);
    if (tightened !== original) {
      changes.push(createDirectChange(
        "sentence_skills",
        `sentence-change-${changes.length + 1}`,
        "claim",
        claim.claim_id,
        "rewrite",
        original,
        tightened,
        "Tighten generic or repetitive phrasing in the outline claim.",
        "low",
      ));
    }
  }
  return {
    dimension: "sentence_skills",
    summary: changes.length > 0
      ? "A few outline claims can be tightened before drafting."
      : "The current outline claims are concise enough at the sentence level.",
    changes,
    requested_changes: [],
  };
}

function fallbackReviseReviews(snapshot) {
  return [
    fallbackUnityReview(snapshot),
    fallbackSupportReview(snapshot),
    fallbackCoherenceReview(snapshot),
    fallbackSentenceSkillsReview(snapshot),
  ];
}

function normalizeReviewResult(dimension, payload) {
  return {
    dimension,
    summary: typeof payload.summary === "string" ? payload.summary : "",
    changes: Array.isArray(payload.changes) ? payload.changes : [],
    requested_changes: Array.isArray(payload.requested_changes) ? payload.requested_changes : [],
  };
}

async function generateReviseReviewWithDeepSeek(dimension, rubricFile, snapshot, deepSeekConfig) {
  const rubric = loadReviewPrompt(rubricFile);
  const reply = await deepSeekChat(
    deepSeekConfig,
    "You are a precise outline reviser. Return valid JSON only.",
    [
      rubric,
      "",
      "Review this structured outline snapshot. Return JSON with keys: summary, changes, requested_changes.",
      "changes are direct outline mutations; requested_changes are unmet support/reference requests.",
      "Each direct change must target claim, support, reference, or section.",
      stableText(snapshot),
    ].join("\n"),
  );
  try {
    return normalizeReviewResult(dimension, JSON.parse(reply.content));
  } catch {
    return normalizeReviewResult(dimension, {
      summary: reply.content,
      changes: [],
      requested_changes: [],
    });
  }
}

function reviseReviewSpecs() {
  return [
    ["unity", "unity-reviewer.md"],
    ["support", "support-reviewer.md"],
    ["coherence", "coherence-reviewer.md"],
    ["sentence_skills", "sentence-skills-reviewer.md"],
  ];
}

async function generateReviseReviews(snapshot, deepSeekConfig) {
  if (!deepSeekConfig) {
    return fallbackReviseReviews(snapshot);
  }
  const fallbackByDimension = new Map(
    fallbackReviseReviews(snapshot).map((review) => [review.dimension, review]),
  );
  const replies = [];
  for (const [dimension, file] of reviseReviewSpecs()) {
    try {
      replies.push(await generateReviseReviewWithDeepSeek(dimension, file, snapshot, deepSeekConfig));
    } catch {
      replies.push(fallbackByDimension.get(dimension));
    }
  }
  return replies;
}

function requestedChangeToGap(change, index) {
  return {
    gap_id: `gap-${index + 1}`,
    source_review: change.source_review,
    claim_id: change.target_kind === "claim" ? change.target_id : null,
    missing_type: change.request_type,
    reason: change.reason,
    severity: change.priority || "medium",
    todo: change.todo,
  };
}

function applyDirectChange(revisedOutline, change) {
  if (change.target_kind === "claim") {
    const claim = revisedOutline.claims.find((item) => item.claim_id === change.target_id);
    if (!claim) {
      return { applied: false, reason: "target claim missing" };
    }
    const currentText = String(claim.text || "");
    if (change.preconditions && change.preconditions.target_text_equals && currentText !== change.preconditions.target_text_equals) {
      return { applied: false, reason: "claim text changed since candidate creation" };
    }
    if (change.change_type === "delete_claim") {
      revisedOutline.claims = revisedOutline.claims.filter((item) => item.claim_id !== change.target_id);
      return { applied: true };
    }
    claim.text = change.after;
    claim.status = "needs_revision";
    return { applied: true };
  }

  if (change.target_kind === "section" && change.change_type === "reassign_section") {
    const sourceSection = revisedOutline.sections.find((section) => sectionClaimIds(section).includes(change.target_id));
    const targetSection = revisedOutline.sections.find((section) => section.name === change.after);
    if (!sourceSection || !targetSection) {
      return { applied: false, reason: "source or target section missing" };
    }
    let movedArgument = null;
    for (const paragraph of sourceSection.paragraphs || []) {
      const argumentsList = Array.isArray(paragraph.arguments) ? paragraph.arguments : [];
      const nextArguments = [];
      for (const argument of argumentsList) {
        const argumentId = argument.argument_id || argument.claim_id || argument.id;
        if (!movedArgument && argumentId === change.target_id) {
          movedArgument = argument;
          continue;
        }
        nextArguments.push(argument);
      }
      paragraph.arguments = nextArguments;
    }
    if (!movedArgument) {
      return { applied: false, reason: "target argument missing from source section" };
    }
    if (!Array.isArray(targetSection.paragraphs) || targetSection.paragraphs.length === 0) {
      targetSection.paragraphs = [{
        paragraph_id: `${targetSection.section_id || "section"}-p01`,
        role: "argument",
        topic: movedArgument.text || "Moved argument",
        arguments: [],
      }];
    }
    targetSection.paragraphs[targetSection.paragraphs.length - 1].arguments = [
      ...(Array.isArray(targetSection.paragraphs[targetSection.paragraphs.length - 1].arguments)
        ? targetSection.paragraphs[targetSection.paragraphs.length - 1].arguments
        : []),
      movedArgument,
    ];
    return { applied: true };
  }

  return { applied: false, reason: "unsupported change type" };
}

function applyRequestedChange(revisedOutline, request) {
  const targetClaimId = request.target_kind === "claim" ? request.target_id : null;
  if (request.request_type === "citation") {
    revisedOutline.references.push({
      ref_id: request.request_id,
      citation_key: `${request.request_id}`.replace(/[^A-Za-z0-9_-]+/g, "-"),
      status: "placeholder",
      relevance: "comparison",
      linked_claim_ids: targetClaimId ? [targetClaimId] : [],
      todo: request.todo,
      reason: request.reason,
    });
    return;
  }
  revisedOutline.supports.push({
    support_id: request.request_id,
    claim_id: targetClaimId,
    type: request.request_type,
    status: "missing",
    todo: request.todo,
    reason: request.reason,
  });
}

function mergeReviseOutputs(snapshot, reviews) {
  const candidateChanges = reviews.flatMap((review) => review.changes.map((change, index) => ({
    priority: change.priority || "medium",
    source_review: review.dimension,
    ...change,
    change_id: change.change_id || `${review.dimension}-change-${index + 1}`,
  })));
  const requestedChanges = reviews.flatMap((review) => review.requested_changes.map((change, index) => ({
    priority: change.priority || "medium",
    source_review: review.dimension,
    ...change,
    request_id: change.request_id || `${review.dimension}-request-${index + 1}`,
  })));

  candidateChanges.sort((left, right) => {
    const byPriority = priorityRank(left.priority) - priorityRank(right.priority);
    if (byPriority !== 0) {
      return byPriority;
    }
    return String(left.change_id).localeCompare(String(right.change_id));
  });

  const revisedOutline = cloneJson(snapshot);
  const appliedChanges = [];
  const skippedChanges = [];
  for (const change of candidateChanges) {
    const result = applyDirectChange(revisedOutline, change);
    if (result.applied) {
      appliedChanges.push(change);
      continue;
    }
    skippedChanges.push({
      ...change,
      skip_reason: result.reason || "not applied",
    });
  }
  for (const request of requestedChanges) {
    applyRequestedChange(revisedOutline, request);
  }
  syncOutlineSectionsFromDerivedState(revisedOutline);
  const revisedDocument = materializeOutlineDocument(revisedOutline);

  const mergedGaps = {
    gaps: requestedChanges.map((change, index) => requestedChangeToGap(change, index)),
  };

  return {
    reviews,
    candidateChanges,
    requestedChanges,
    appliedChanges,
    skippedChanges,
    revisedOutline,
    revisedDocument,
    mergedGaps,
  };
}

function defaultMockReview(template, claims, gaps) {
  return {
    template: template.id,
    reviews: [
      {
        reviewer_dimension: "significance",
        score: gaps.gaps.length > 0 ? 5 : 7,
        strengths: claims.length > 0 ? ["Structured outline provides a visible contribution path"] : [],
        weaknesses: gaps.gaps.length > 0 ? ["Support gaps remain before the draft is conference-ready"] : [],
        recommended_actions: gaps.gaps.length > 0 ? ["Resolve the open support TODOs and rerun the workflow"] : [],
      },
      {
        reviewer_dimension: "novelty",
        score: 5,
        strengths: [],
        weaknesses: ["Novelty review requires a stronger paper draft and prior-work comparison."],
        recommended_actions: ["Use this artifact as a placeholder until richer drafting and comparison logic lands."],
      },
    ],
    summary: {
      top_risks: [
        ...(gaps.gaps.length > 0 ? ["Open support gaps may weaken soundness and reproducibility."] : []),
        ...(template.review_warnings || []),
      ],
    },
  };
}

function draftContext(title, templateSpec, claims, gaps, sectionPlan) {
  return [
    `Title: ${title}`,
    `Venue: ${templateSpec.name}`,
    `Template id: ${templateSpec.id}`,
    `Claims:`,
    stableText(claims),
    `Section plan:`,
    stableText(sectionPlan),
    `Support gaps:`,
    stableText(gaps),
  ].join("\n\n");
}

async function generateWritingReviews(title, templateSpec, claims, gaps, sectionPlan, deepSeekConfig) {
  const promptFiles = [
    { key: "unity", file: "unity-reviewer.md" },
    { key: "support", file: "support-reviewer.md" },
    { key: "coherence", file: "coherence-reviewer.md" },
    { key: "sentence_skills", file: "sentence-skills-reviewer.md" },
  ];
  const reviewSource = renderLatex(title, sectionPlan, claims, gaps, templateSpec);
  const context = [
    "You are reviewing a submission-centric LaTeX paper draft generated from a structured outline.",
    "Return JSON with keys: dimension, review_markdown, score_hint.",
    "Keep review_markdown faithful to the requested output format from the rubric prompt.",
  ].join(" ");
  const replies = await Promise.all(promptFiles.map(async (item) => {
    const rubric = loadReviewPrompt(item.file);
    const reply = await deepSeekChat(
      deepSeekConfig,
      "You are a precise academic writing reviewer. Return valid JSON only.",
      [
        rubric,
        "",
        "Paper context:",
        draftContext(title, templateSpec, claims, gaps, sectionPlan),
        "",
        "Paper draft to review:",
        reviewSource,
      ].join("\n")
    );
    return { item, reply };
  }));
  const reviews = replies.map(({ item, reply }) => {
    let parsed = null;
    try {
      parsed = JSON.parse(reply.content);
    } catch {
      parsed = {
        dimension: item.key,
        review_markdown: reply.content,
        score_hint: null,
      };
    }
    return {
      dimension: item.key,
      rubric: item.file,
      review: parsed.review_markdown || reply.content,
      score_hint: parsed.score_hint || null,
      response_id: crypto.createHash("sha256").update(reply.content).digest("hex").slice(0, 12),
    };
  });
  return {
    provider: "deepseek",
    model: deepSeekConfig.model,
    reviews,
  };
}

async function generateMockReview(title, templateSpec, claims, gaps, sectionPlan, deepSeekConfig) {
  const reply = await deepSeekChat(
    deepSeekConfig,
    "You are a skeptical ACSAC-style PC reviewer. Return valid JSON only.",
    [
      "Review this paper plan for significance, novelty, soundness, and reproducibility.",
      "Return JSON with keys: reviews (array), summary.",
      draftContext(title, templateSpec, claims, gaps, sectionPlan),
    ].join("\n\n")
  );
  try {
    const parsed = JSON.parse(reply.content);
    return {
      provider: "deepseek",
      model: deepSeekConfig.model,
      template: templateSpec.id,
      ...parsed,
    };
  } catch {
    return {
      ...defaultMockReview(templateSpec, claims, gaps),
      provider: "deepseek",
      model: deepSeekConfig.model,
      raw_review: reply.content,
    };
  }
}

function fallbackWritingReview() {
  return {
    provider: "local-fallback",
    reviews: [
      { dimension: "unity", rubric: "unity-reviewer.md", review: "No LLM review generated because DeepSeek was unavailable or not configured.", score_hint: null },
      { dimension: "support", rubric: "support-reviewer.md", review: "No LLM review generated because DeepSeek was unavailable or not configured.", score_hint: null },
      { dimension: "coherence", rubric: "coherence-reviewer.md", review: "No LLM review generated because DeepSeek was unavailable or not configured.", score_hint: null },
      { dimension: "sentence_skills", rubric: "sentence-skills-reviewer.md", review: "No LLM review generated because DeepSeek was unavailable or not configured.", score_hint: null },
    ],
  };
}

function renderLatex(title, sectionPlan, claims, gaps, references, template) {
  const numberedSectionCommand = template.section_command || "section";
  const unnumberedSectionCommand = template.unnumbered_section_command || `${numberedSectionCommand}*`;
  const sections = sectionPlan.sections.map((section) => {
    const paragraphs = Array.isArray(section.source_paragraphs) ? section.source_paragraphs : [];
    const renderedParagraphs = paragraphs.length > 0
      ? paragraphs.map((paragraph) => {
          const argumentsText = Array.isArray(paragraph.arguments) && paragraph.arguments.length > 0
            ? paragraph.arguments.map((argument) => {
                const claimText = String(argument.text || "").replace(/[_%]/g, "\\$&");
                const supportText = Array.isArray(argument.supports) && argument.supports.length > 0
                  ? argument.supports
                      .map((support) => String(support.content || support.todo || "").trim())
                      .filter(Boolean)
                      .map((text) => text.replace(/[_%]/g, "\\$&"))
                      .join(" ")
                  : "";
                return `${claimText}${supportText ? ` ${supportText}` : ""}`.trim();
              }).join("\n\n")
            : String(paragraph.topic || "").replace(/[_%]/g, "\\$&");
          return argumentsText || "Draft from normalized outline inputs.";
        }).join("\n\n")
      : (
        sectionClaimIds(section).length > 0
          ? sectionClaimIds(section)
              .map((claimId) => claims.find((claim) => (claim.claim_id || claim.id || claim.text) === claimId))
              .filter(Boolean)
              .map((claim) => String(claim.text || claim.claim || claim.claim_id || "Claim").replace(/[_%]/g, "\\$&"))
              .join("\n\n")
          : "Draft from normalized outline inputs."
      );
    return `\\${numberedSectionCommand}{${section.name}}\n${renderedParagraphs}\n`;
  }).join("\n");

  const gapSection = gaps.gaps.length > 0
    ? `\\${unnumberedSectionCommand}{Open Support Gaps}\n\\begin{itemize}\n${gaps.gaps.map((gap) => `\\item ${String(gap.todo).replace(/[_%]/g, "\\$&")}`).join("\n")}\n\\end{itemize}\n`
    : "";

  const submissionNotes = (template.formatting_rules || []).map((rule) =>
    `% ${rule}`
  ).join("\n");
  const sectionBody = `${sections}\n${gapSection}`.trim();
  const citationKeys = references
    .map((reference) => String(reference && reference.citation_key || "").trim())
    .filter(Boolean);
  const bibliographyBlock = template.__hasReferences
    ? (
      template.bibliography_backend === "biber"
        ? `${citationKeys.length > 0 ? `\\nocite{${citationKeys.join(",")}}\n` : ""}\\printbibliography\n`
        : `${citationKeys.length > 0 ? `\\nocite{${citationKeys.join(",")}}\n` : ""}\\bibliographystyle{IEEEtran}\n\\bibliography{paper}\n`
    )
    : "";

  if (template.__latexTemplate) {
    const templateSections = template.bibliography_backend === "biber"
      ? `${submissionNotes}\n\n${sectionBody}${citationKeys.length > 0 ? `\n\n\\nocite{${citationKeys.join(",")}}` : ""}`
      : `${submissionNotes}\n\n${sectionBody}${bibliographyBlock ? `\n\n${bibliographyBlock}` : ""}`;
    return template.__latexTemplate
      .replace("%%TITLE%%", title.replace(/[_%]/g, "\\$&"))
      .replace("%%SECTIONS%%", templateSections);
  }

  return `${template.documentclass || "\\documentclass{article}"}
${submissionNotes}
\\title{${title.replace(/[_%]/g, "\\$&")}}
\\author{Anonymous Submission}
\\date{}

\\begin{document}
\\maketitle

${sectionBody}
${bibliographyBlock}
\\end{document}
`;
}

function renderBibtexEntry(reference) {
  if (reference && typeof reference.bibtex === "string" && reference.bibtex.trim()) {
    return reference.bibtex
      .trim()
      .replace(/_/g, "\\_")
      .replace(/%/g, "\\%");
  }
  const citationKey = reference && reference.citation_key ? reference.citation_key : `ref-${Math.random().toString(16).slice(2, 8)}`;
  const entryType = reference && reference.entry_type ? reference.entry_type : "misc";
  const fields = [];
  const escapeField = (value) => String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/_/g, "\\_")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&");
  if (reference && reference.title) {
    fields.push(`  title = {${escapeField(reference.title)}}`);
  }
  if (reference && Array.isArray(reference.authors) && reference.authors.length > 0) {
    fields.push(`  author = {${escapeField(reference.authors.join(" and "))}}`);
  }
  if (reference && reference.year) {
    fields.push(`  year = {${escapeField(reference.year)}}`);
  }
  if (reference && reference.venue) {
    fields.push(`  howpublished = {${escapeField(reference.venue)}}`);
  }
  return `@${entryType}{${citationKey},\n${fields.join(",\n")}\n}`;
}

function renderBibtex(references) {
  return `${references.map((reference) => renderBibtexEntry(reference)).join("\n\n")}\n`;
}

function relativeArtifact(runDir, artifactPath) {
  return path.relative(runDir, artifactPath).replace(/\\/g, "/");
}

function artifact(pathName, filePath) {
  return {
    path: pathName,
    location: filePath,
  };
}

function appendLog(logFile, line) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

function logPhase(logFile, message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  appendLog(logFile, `[outline-to-paper] ${message}${suffix}`);
}

function isRunningPid(pid) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runLatexCommand(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
}

function compileLatex(texPath, hasReferences, engine = "pdflatex", bibliographyBackend = "bibtex") {
  const cwd = path.dirname(texPath);
  const base = path.basename(texPath, path.extname(texPath));
  const runs = [];
  runs.push(runLatexCommand(engine, ["-interaction=nonstopmode", path.basename(texPath)], cwd));
  if (hasReferences) {
    runs.push(runLatexCommand(bibliographyBackend === "biber" ? "biber" : "bibtex", [base], cwd));
  }
  runs.push(runLatexCommand(engine, ["-interaction=nonstopmode", path.basename(texPath)], cwd));
  runs.push(runLatexCommand(engine, ["-interaction=nonstopmode", path.basename(texPath)], cwd));
  return runs;
}

async function runCommand(flags) {
  const workspace = resolveWorkspace(flags);
  const configuredRunDir = requireManagedInvocation("outline-to-paper run");
  const requestedOutlinePath = path.resolve(String(flags.outline || ""));
  const template = String(flags.template || "acsac26");
  const phases = selectedPhases(flags);
  const resolvedOutlineInput = resolvePhaseOutlineInput(
    workspace,
    requestedOutlinePath,
    phases,
    configuredRunDir,
  );
  const outlinePath = resolvedOutlineInput.path;
  const language = String(flags.language || "en").trim().toLowerCase();
  if (!fs.existsSync(requestedOutlinePath)) {
    throw new Error(`outline file not found: ${requestedOutlinePath}`);
  }
  if (!fs.existsSync(outlinePath)) {
    throw new Error(`effective outline file not found: ${outlinePath}`);
  }

  const { outline, metadata: outlineMetadata } = readOutlinePayload(outlinePath);
  const supports = deriveSupports(outline);
  const references = deriveReferences(outline);
  const templateBundle = loadTemplate(template);
  const templateSpec = {
    ...resolveTemplateSpec(templateBundle.metadata, language),
    __latexTemplate: templateBundle.latexTemplatePath ? readText(templateBundle.latexTemplatePath) : null,
    __hasReferences: references.length > 0,
  };
  const title = guessTitle(outlinePath, outline);
  const runId = flags.id
    ? String(flags.id)
    : configuredRunDir
      ? path.basename(configuredRunDir)
      : generateRunId();
  const runDir = configuredRunDir || path.join(runsRoot(workspace), runId);
  const logFile = path.join(runDir, "stdout.log");
  fs.mkdirSync(runDir, { recursive: true });
  logPhase(logFile, "run start", {
    runId,
    workspace,
    requestedOutlinePath,
    outlinePath,
    outlineSource: resolvedOutlineInput.source,
    outlineVersion: outlineMetadata && outlineMetadata.version_id ? outlineMetadata.version_id : null,
    template,
    language,
    phases: [...phases],
    managedRunDir: configuredRunDir,
  });

  const claims = deriveClaims(outline);
  const sectionPlan = defaultSectionPlan(title, claims, templateSpec, outline);
  const gaps = deriveGaps(supports, references);
  logPhase(logFile, "outline parsed", {
    title,
    sectionCount: Array.isArray(outline.sections) ? outline.sections.length : 0,
    claimCount: claims.length,
    supportCount: supports.length,
    referenceCount: references.length,
    initialGapCount: gaps.gaps.length,
  });
  logPhase(logFile, "section plan built", {
    sectionPlanSections: Array.isArray(sectionPlan.sections) ? sectionPlan.sections.length : 0,
    totalTargetWords: sectionPlan.total_target_words,
  });
  const deepSeekConfig = flags["use-deepseek"] ? configuredDeepSeek() : null;
  let mockReview = defaultMockReview(templateSpec, claims, gaps);
  const reviseSnapshot = buildOutlineSnapshot(outline, sectionPlan);
  let reviseReviews = fallbackReviseReviews(reviseSnapshot);
  let llmProvider = "local-fallback";
  if (deepSeekConfig) {
    try {
      logPhase(logFile, "deepseek enabled", {
        model: deepSeekConfig.model,
        timeoutMs: deepSeekConfig.timeoutMs,
      });
      if (phases.has("revise")) {
        const fallbackByDimension = new Map(
          fallbackReviseReviews(reviseSnapshot).map((review) => [review.dimension, review]),
        );
        logPhase(logFile, "generating revise reviews", {
          dimensions: reviseReviewSpecs().map(([dimension]) => dimension),
        });
        reviseReviews = [];
        for (const [dimension, rubricFile] of reviseReviewSpecs()) {
          logPhase(logFile, "revise reviewer start", { dimension });
          let review = null;
          let fallback = false;
          try {
            review = await generateReviseReviewWithDeepSeek(
              dimension,
              rubricFile,
              reviseSnapshot,
              deepSeekConfig,
            );
          } catch {
            review = fallbackByDimension.get(dimension);
            fallback = true;
          }
          reviseReviews.push(review);
          logPhase(logFile, "revise reviewer done", {
            dimension,
            fallback,
            changes: Array.isArray(review && review.changes) ? review.changes.length : 0,
            requested_changes: Array.isArray(review && review.requested_changes) ? review.requested_changes.length : 0,
          });
        }
      }
      if (phases.has("review")) {
        logPhase(logFile, "generating mock review");
        mockReview = await generateMockReview(title, templateSpec, claims, gaps, sectionPlan, deepSeekConfig);
        logPhase(logFile, "mock review generated");
      }
      llmProvider = "deepseek";
    } catch (error) {
      logPhase(logFile, "deepseek fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logPhase(logFile, "merge revise outputs");
  const reviseMerge = mergeReviseOutputs(reviseSnapshot, reviseReviews);
  logPhase(logFile, "revise merge done", {
    candidate: reviseMerge.candidateChanges.length,
    requested: reviseMerge.requestedChanges.length,
    applied: reviseMerge.appliedChanges.length,
    skipped: reviseMerge.skippedChanges.length,
  });

  const normalizedOutlinePath = path.join(runDir, "outline", "normalized-outline.json");
  const normalizedOutlineMarkdownPath = path.join(runDir, "outline", "normalized-outline.md");
  const sectionPlanPath = path.join(runDir, "plan", "section-plan.json");
  const templatePlanPath = path.join(runDir, "plan", "template-plan.json");
  const unityReviewPath = path.join(runDir, "revise", "unity-review.json");
  const supportReviewPath = path.join(runDir, "revise", "support-review.json");
  const coherenceReviewPath = path.join(runDir, "revise", "coherence-review.json");
  const sentenceSkillsReviewPath = path.join(runDir, "revise", "sentence-skills-review.json");
  const candidateChangesPath = path.join(runDir, "revise", "candidate-changes.json");
  const requestedChangesPath = path.join(runDir, "revise", "requested-changes.json");
  const appliedChangesPath = path.join(runDir, "revise", "applied-changes.json");
  const skippedChangesPath = path.join(runDir, "revise", "skipped-changes.json");
  const gapPath = path.join(runDir, "revise", "gaps.json");
  const mockReviewPath = path.join(runDir, "review", "mock-review-summary.json");
  const revisionPlanPath = path.join(runDir, "revise", "revision-plan.json");
  const sectionTodosPath = path.join(runDir, "revise", "section-todos.json");
  const revisedOutlinePath = path.join(runDir, "revise", "revised-outline.json");
  const revisedOutlineMarkdownPath = path.join(runDir, "revise", "revised-outline.md");
  const texPath = path.join(runDir, "draft", "paper.tex");
  const bibPath = path.join(runDir, "draft", "paper.bib");
  const pdfPath = path.join(runDir, "draft", "paper.pdf");
  const sentenceEditPlanPath = path.join(runDir, "edit", "sentence-edit-plan.json");
  const polishedTexPath = path.join(runDir, "edit", "polished-paper.tex");
  const manifestPath = path.join(runDir, "manifest.json");
  const workflowRunRoot = workflowRunRootFromRunDir(runDir);
  const currentOutlineLinkPath = currentOutlinePath(workspace, runDir);
  const createdAt = new Date().toISOString();

  writeJson(manifestPath, {
    id: runId,
    status: "running",
    template,
    title,
    workspace,
    runDir,
    createdAt,
    updatedAt: createdAt,
    pid: process.pid,
    outline: outlinePath,
    requested_outline: requestedOutlinePath,
    outline_source: resolvedOutlineInput.source,
    current_outline: fs.existsSync(currentOutlineLinkPath) ? currentOutlineLinkPath : null,
    artifacts: [],
    gapCount: 0,
  });

  if (phases.has("outline")) {
    logPhase(logFile, "phase outline start");
    writeJson(normalizedOutlinePath, outline);
    fs.writeFileSync(normalizedOutlineMarkdownPath, outlineToMarkdown(outline), "utf8");
    logPhase(logFile, "phase outline wrote normalized outline", {
      output: normalizedOutlinePath,
      markdown: normalizedOutlineMarkdownPath,
    });
  }
  if (phases.has("revise")) {
    logPhase(logFile, "phase revise start");
    const byDimension = new Map(reviseReviews.map((review) => [review.dimension, review]));
    writeJson(unityReviewPath, byDimension.get("unity") || fallbackUnityReview(reviseSnapshot));
    writeJson(supportReviewPath, byDimension.get("support") || fallbackSupportReview(reviseSnapshot));
    writeJson(coherenceReviewPath, byDimension.get("coherence") || fallbackCoherenceReview(reviseSnapshot));
    writeJson(sentenceSkillsReviewPath, byDimension.get("sentence_skills") || fallbackSentenceSkillsReview(reviseSnapshot));
    writeJson(candidateChangesPath, { changes: reviseMerge.candidateChanges });
    writeJson(requestedChangesPath, { requested_changes: reviseMerge.requestedChanges });
    writeJson(appliedChangesPath, { changes: reviseMerge.appliedChanges });
    writeJson(skippedChangesPath, { changes: reviseMerge.skippedChanges });
    writeJson(gapPath, reviseMerge.mergedGaps);
    writeJson(revisionPlanPath, {
      source: "outline-to-paper",
      generated_from: {
        gaps: relativeArtifact(runDir, gapPath),
        outline: relativeArtifact(runDir, normalizedOutlinePath),
      },
      applied_changes: relativeArtifact(runDir, appliedChangesPath),
      skipped_changes: relativeArtifact(runDir, skippedChangesPath),
      requested_changes: relativeArtifact(runDir, requestedChangesPath),
      actions: reviseMerge.requestedChanges.map((request) => ({
        type: request.request_type,
        claim_id: request.target_kind === "claim" ? request.target_id : null,
        severity: request.priority || "medium",
        instruction: request.todo,
      })),
    });
    writeJson(sectionTodosPath, {
      sections: sectionPlan.sections.map((section) => ({
        section_id: section.section_id,
        name: section.name,
        todos: reviseMerge.requestedChanges
          .filter((request) => sectionClaimIds(section).includes(request.target_id))
          .map((request) => request.todo),
      })).filter((section) => section.todos.length > 0),
    });
    writeJson(revisedOutlinePath, reviseMerge.revisedDocument);
    fs.writeFileSync(revisedOutlineMarkdownPath, outlineToMarkdown(reviseMerge.revisedDocument), "utf8");
    const currentOutline = writeVersionedCurrentOutline(workspace, reviseMerge.revisedDocument, {
      runDir,
      source: "revise-phase",
      workflow_run_id: workflowRunRoot ? path.basename(workflowRunRoot) : null,
      step_id: "revise_phase",
    });
    logPhase(logFile, "phase revise wrote artifacts", {
      revisedOutline: revisedOutlinePath,
      revisedOutlineMarkdown: revisedOutlineMarkdownPath,
      currentOutline: currentOutline.currentPath,
      currentOutlineVersion: currentOutline.versionPath,
      gaps: gapPath,
      revisionPlan: revisionPlanPath,
      requestedChanges: requestedChangesPath,
      appliedChanges: appliedChangesPath,
      skippedChanges: skippedChangesPath,
    });
  }
  if (phases.has("draft") || phases.has("edit") || phases.has("review")) {
    logPhase(logFile, "draft-capable phase start");
    const draftingOutline = phases.has("revise") ? reviseMerge.revisedOutline : reviseSnapshot;
    const draftingClaims = draftingOutline.claims;
    const draftingSupports = draftingOutline.supports;
    const draftingReferences = draftingOutline.references;
    const draftingSectionPlan = defaultSectionPlan(title, draftingClaims, templateSpec, draftingOutline);
    const draftingGaps = deriveGaps(draftingSupports, draftingReferences);
    writeJson(sectionPlanPath, draftingSectionPlan);
    writeJson(templatePlanPath, templateSpec);
    fs.mkdirSync(path.dirname(texPath), { recursive: true });
    fs.writeFileSync(texPath, renderLatex(title, draftingSectionPlan, draftingClaims, draftingGaps, draftingReferences, templateSpec), "utf8");
    fs.writeFileSync(bibPath, renderBibtex(draftingReferences), "utf8");
    logPhase(logFile, "draft artifacts prepared", {
      sectionPlan: sectionPlanPath,
      templatePlan: templatePlanPath,
      tex: texPath,
      bib: bibPath,
      engine: templateSpec.latex_engine || "pdflatex",
      bibliographyBackend: templateSpec.bibliography_backend || "bibtex",
    });
    const latexRuns = compileLatex(
      texPath,
      draftingReferences.length > 0,
      templateSpec.latex_engine || "pdflatex",
      templateSpec.bibliography_backend || "bibtex",
    );
    for (const result of latexRuns) {
      if (result.stdout) {
        appendLog(logFile, result.stdout.trimEnd());
      }
      if (result.stderr) {
        appendLog(logFile, result.stderr.trimEnd());
      }
    }
    const failed = latexRuns.find((result) => result.status !== 0);
    if (failed || !fs.existsSync(pdfPath)) {
      const reason = failed
        ? (failed.stderr || failed.stdout || "LaTeX compiler failed").trim()
        : "paper.pdf was not produced";
      throw new Error(`failed to compile paper.tex to PDF: ${reason}`);
    }
    logPhase(logFile, "latex compile done", { pdf: pdfPath });
  }
  if (phases.has("edit") || phases.has("review")) {
    logPhase(logFile, "phase edit start");
    writeJson(sentenceEditPlanPath, {
      summary: "No sentence-level edit plan has been generated yet.",
      edits: [],
      source: "outline-to-paper",
    });
    fs.mkdirSync(path.dirname(polishedTexPath), { recursive: true });
    fs.copyFileSync(texPath, polishedTexPath);
    logPhase(logFile, "phase edit wrote artifacts", {
      sentenceEditPlan: sentenceEditPlanPath,
      polishedPaper: polishedTexPath,
    });
  }
  if (phases.has("review")) {
    logPhase(logFile, "phase review start");
    writeJson(mockReviewPath, mockReview);
    logPhase(logFile, "phase review wrote artifacts", {
      mockReview: mockReviewPath,
    });
  }

  const artifacts = [
    ...(phases.has("outline")
      ? [
          artifact(relativeArtifact(runDir, normalizedOutlinePath), normalizedOutlinePath),
          artifact(relativeArtifact(runDir, normalizedOutlineMarkdownPath), normalizedOutlineMarkdownPath),
        ]
      : []),
    ...(phases.has("draft") || phases.has("edit") || phases.has("review")
      ? [
          artifact(relativeArtifact(runDir, sectionPlanPath), sectionPlanPath),
          artifact(relativeArtifact(runDir, templatePlanPath), templatePlanPath),
          artifact(relativeArtifact(runDir, texPath), texPath),
          artifact(relativeArtifact(runDir, bibPath), bibPath),
          artifact(relativeArtifact(runDir, pdfPath), pdfPath),
        ]
      : []),
    ...(phases.has("revise")
      ? [
          artifact(relativeArtifact(runDir, unityReviewPath), unityReviewPath),
          artifact(relativeArtifact(runDir, supportReviewPath), supportReviewPath),
          artifact(relativeArtifact(runDir, coherenceReviewPath), coherenceReviewPath),
          artifact(relativeArtifact(runDir, sentenceSkillsReviewPath), sentenceSkillsReviewPath),
          artifact(relativeArtifact(runDir, candidateChangesPath), candidateChangesPath),
          artifact(relativeArtifact(runDir, requestedChangesPath), requestedChangesPath),
          artifact(relativeArtifact(runDir, appliedChangesPath), appliedChangesPath),
          artifact(relativeArtifact(runDir, skippedChangesPath), skippedChangesPath),
          artifact(relativeArtifact(runDir, gapPath), gapPath),
          artifact(relativeArtifact(runDir, revisionPlanPath), revisionPlanPath),
          artifact(relativeArtifact(runDir, sectionTodosPath), sectionTodosPath),
          artifact(relativeArtifact(runDir, revisedOutlinePath), revisedOutlinePath),
          artifact(relativeArtifact(runDir, revisedOutlineMarkdownPath), revisedOutlineMarkdownPath),
        ]
      : []),
    ...(phases.has("edit") || phases.has("review")
      ? [
          artifact(relativeArtifact(runDir, sentenceEditPlanPath), sentenceEditPlanPath),
          artifact(relativeArtifact(runDir, polishedTexPath), polishedTexPath),
        ]
      : []),
    ...(phases.has("review")
      ? [artifact(relativeArtifact(runDir, mockReviewPath), mockReviewPath)]
      : []),
  ];

  const manifest = {
    id: runId,
    status: "success",
    template,
    title,
    workspace,
    runDir,
    createdAt,
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    outline: outlinePath,
    requested_outline: requestedOutlinePath,
    outline_source: resolvedOutlineInput.source,
    current_outline: fs.existsSync(currentOutlineLinkPath) ? currentOutlineLinkPath : null,
    artifacts,
    gapCount: gaps.gaps.length,
  };
  writeJson(manifestPath, manifest);
  logPhase(logFile, "manifest written", { manifest: manifestPath });

  return {
    command: "outline-to-paper run",
    status: "success",
    exit_code: 0,
    summary: "generated outline-to-paper artifacts",
    details: {
      id: runId,
      manifest: manifestPath,
      run_dir: runDir,
      template,
      artifacts,
      gaps: reviseMerge.mergedGaps.gaps.length,
      llm_provider: llmProvider,
      outline: outlinePath,
      outline_source: resolvedOutlineInput.source,
      current_outline: fs.existsSync(currentOutlineLinkPath) ? currentOutlineLinkPath : null,
      phases: [...phases],
    },
  };
}

function inspectCommand(flags) {
  const workspace = resolveWorkspace(flags);
  const configuredRunDir = requireManagedInvocation("outline-to-paper inspect");
  const id = String(flags.id || "").trim();
  const manifestPath = path.join(configuredRunDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`run not found: ${configuredRunDir || id}`);
  }
  const manifest = readJson(manifestPath);
  return {
    command: "outline-to-paper inspect",
    status: "success",
    exit_code: 0,
    summary: "paper workflow metadata",
    details: manifest,
  };
}

function logsCommand(flags) {
  const workspace = resolveWorkspace(flags);
  const configuredRunDir = requireManagedInvocation("outline-to-paper logs");
  const id = String(flags.id || "").trim();
  const logPath = path.join(configuredRunDir, "stdout.log");
  if (!fs.existsSync(logPath)) {
    throw new Error(`log not found for run: ${configuredRunDir || id}`);
  }
  const text = fs.readFileSync(logPath, "utf8");
  return {
    command: "outline-to-paper logs",
    status: "success",
    exit_code: 0,
    summary: "workflow logs",
    details: {
      id: configuredRunDir ? path.basename(configuredRunDir) : id,
      log_file: logPath,
      text,
    },
  };
}

function stopCommand(flags) {
  const configuredRunDir = requireManagedInvocation("outline-to-paper stop");
  const manifestPath = path.join(configuredRunDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`run not found: ${configuredRunDir}`);
  }
  const manifest = readJson(manifestPath);
  const pid = typeof manifest.pid === "number" ? manifest.pid : null;
  const wasRunning = isRunningPid(pid);
  if (wasRunning) {
    process.kill(pid, "SIGTERM");
  }
  const next = {
    ...manifest,
    status: "stopped",
    updatedAt: new Date().toISOString(),
    signal: "SIGTERM",
  };
  writeJson(manifestPath, next);
  return {
    command: "outline-to-paper stop",
    status: "success",
    exit_code: 0,
    summary: wasRunning ? "stopped workflow run" : "run is not running",
    details: next,
  };
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command || command === "help" || flags.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  let payload;
  if (command === "run") {
    payload = await runCommand(flags);
  } else if (command === "inspect") {
    payload = inspectCommand(flags);
  } else if (command === "logs") {
    payload = logsCommand(flags);
  } else if (command === "stop") {
    payload = stopCommand(flags);
  } else {
    throw new Error(`unknown command: ${command}`);
  }

  if (flags.json) {
    printJson(payload);
  } else if (command === "logs") {
    process.stdout.write(payload.details.text);
  } else if (payload.details && payload.details.manifest) {
    process.stdout.write(`${payload.details.manifest}\n`);
  } else {
    process.stdout.write(`${payload.summary}${os.EOL}`);
  }
  return payload.exit_code || 0;
}

const keepalive = setInterval(() => {}, 1000);

(async () => {
  try {
    process.exitCode = await main();
  } catch (error) {
    const payload = {
      command: process.argv[2] ? `outline-to-paper ${process.argv[2]}` : "outline-to-paper",
      status: "error",
      exit_code: 1,
      summary: error.message,
      error: {
        code: "outline_to_paper_error",
        message: error.message,
      },
    };
    if (process.argv.includes("--json")) {
      printJson(payload);
    } else {
      process.stderr.write(`${error.message}\n`);
    }
    process.exitCode = 1;
  } finally {
    clearInterval(keepalive);
  }
})();
