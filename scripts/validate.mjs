#!/usr/bin/env node
// Validates the structural contract of the standards guide:
//   - every standards/*.md has frontmatter: name, description, load_when (1+), rule_prefix
//   - frontmatter name matches the filename
//   - rule headings follow "### PREFIX-NNN LEVEL: title", numbered 001.. sequentially
//   - levels are MUST | MUST NOT | SHOULD | MAY
//   - the Quick reference table lists exactly the same IDs/levels as the rule headings
//   - rule IDs are unique across the entire guide
//   - every `*.md` filename referenced in backticks exists
//   - AGENTS.md indexes every standards file
// Zero dependencies. Exit 0 = contract holds.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standardsDir = join(root, "standards");
const LEVELS = ["MUST NOT", "MUST", "SHOULD", "MAY"];
const errors = [];
const allIds = new Map(); // id -> file

const files = readdirSync(standardsDir).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) errors.push("standards/ contains no markdown files");

for (const file of files) {
  const text = readFileSync(join(standardsDir, file), "utf8");
  const where = `standards/${file}`;

  // --- frontmatter ---
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) {
    errors.push(`${where}: missing YAML frontmatter`);
    continue;
  }
  const fmText = fm[1];
  const name = fmText.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fmText.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const rulePrefix = fmText.match(/^rule_prefix:\s*(.+)$/m)?.[1]?.trim();
  const loadWhen = [...fmText.matchAll(/^\s+-\s+(.+)$/gm)].map((m) => m[1]);
  if (!name) errors.push(`${where}: frontmatter missing name`);
  if (!description) errors.push(`${where}: frontmatter missing description`);
  if (!rulePrefix) errors.push(`${where}: frontmatter missing rule_prefix`);
  if (loadWhen.length === 0) errors.push(`${where}: frontmatter has no load_when triggers`);
  if (name && name !== file.replace(/\.md$/, ""))
    errors.push(`${where}: frontmatter name "${name}" != filename`);

  // --- rule headings ---
  const headingRe = /^### ([A-Z]+-\d{3}) (MUST NOT|MUST|SHOULD|MAY): (.+)$/gm;
  const headings = [...text.matchAll(headingRe)].map((m) => ({ id: m[1], level: m[2], title: m[3] }));
  if (headings.length === 0) errors.push(`${where}: no rule headings matching "### ${rulePrefix}-NNN LEVEL: title"`);
  headings.forEach((h, i) => {
    const expected = `${rulePrefix}-${String(i + 1).padStart(3, "0")}`;
    if (h.id !== expected) errors.push(`${where}: rule #${i + 1} is ${h.id}, expected ${expected} (sequential from 001)`);
    if (!LEVELS.includes(h.level)) errors.push(`${where}: ${h.id} has invalid level "${h.level}"`);
    if (allIds.has(h.id)) errors.push(`${where}: duplicate rule ID ${h.id} (also in ${allIds.get(h.id)})`);
    else allIds.set(h.id, where);
  });

  // --- quick reference table agrees with headings ---
  const tableRows = [...text.matchAll(/^\|\s*([A-Z]+-\d{3})\s*\|\s*(MUST NOT|MUST|SHOULD|MAY)\s*\|/gm)]
    .map((m) => ({ id: m[1], level: m[2] }));
  const headingIds = headings.map((h) => `${h.id}:${h.level}`).join(",");
  const tableIds = tableRows.map((r) => `${r.id}:${r.level}`).join(",");
  if (headingIds !== tableIds)
    errors.push(`${where}: Quick reference table disagrees with rule headings\n  table:    ${tableIds}\n  headings: ${headingIds}`);

  // --- referenced files exist ---
  for (const m of text.matchAll(/`([a-z0-9-]+\.md)`/g)) {
    const ref = m[1];
    if (ref === file) continue;
    if (!existsSync(join(standardsDir, ref)) && !existsSync(join(root, ref)))
      errors.push(`${where}: references \`${ref}\` which does not exist`);
  }
}

// --- router indexes every file ---
const routerPath = join(root, "AGENTS.md");
if (!existsSync(routerPath)) {
  errors.push("AGENTS.md router is missing");
} else {
  const router = readFileSync(routerPath, "utf8");
  for (const file of files) {
    if (!router.includes(file)) errors.push(`AGENTS.md: does not index standards/${file}`);
  }
}

if (errors.length) {
  console.error(`FAIL — ${errors.length} contract violation(s):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
console.log(`OK — ${files.length} files, ${allIds.size} rules, contract holds.`);
