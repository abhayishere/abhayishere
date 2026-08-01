#!/usr/bin/env node
// Refreshes the OSS-STATS block in README.md from the GitHub search API.
// Counts PRs authored by GH_USER in repos NOT owned by GH_USER.

import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "abhayishere";
const README = process.env.README_PATH || "README.md";
const TOKEN = process.env.GITHUB_TOKEN;
const START = "<!-- OSS-STATS:START -->";
const END = "<!-- OSS-STATS:END -->";

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `${USER}-profile-readme`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} — ${path}`);
  }
  return res.json();
}

const search = (q) =>
  api(`/search/issues?q=${encodeURIComponent(q)}&per_page=100&sort=updated&order=desc`);

// "-user:X" excludes repos owned by X, so forks and personal projects don't inflate the count.
const BASE = `is:pr author:${USER} -user:${USER}`;

const repoOf = (item) => item.repository_url.replace("https://api.github.com/repos/", "");

const starCache = new Map();
async function stars(fullName) {
  if (!starCache.has(fullName)) {
    try {
      const repo = await api(`/repos/${fullName}`);
      starCache.set(fullName, repo.stargazers_count);
    } catch {
      starCache.set(fullName, null);
    }
  }
  return starCache.get(fullName);
}

const fmtStars = (n) => {
  if (n == null) return "";
  if (n >= 1000) return ` ⭐${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return ` ⭐${n}`;
};

const escape = (s) => s.replace(/\|/g, "\\|");

async function rows(items, badge) {
  const out = [];
  for (const it of items) {
    const full = repoOf(it);
    const s = await stars(full);
    out.push(
      `| [${full}](https://github.com/${full})${fmtStars(s)} | ${escape(it.title)} | [#${it.number}](${it.html_url}) | ${badge} |`
    );
  }
  return out;
}

async function main() {
  const merged = await search(`${BASE} is:merged`);
  const open = await search(`${BASE} is:open -is:draft`);

  const mergedItems = merged.items ?? [];
  const openItems = open.items ?? [];
  const repos = new Set([...mergedItems, ...openItems].map(repoOf));

  const lines = [];
  lines.push(
    `**${merged.total_count} merged** · **${open.total_count} open** · across **${repos.size}** repos`
  );
  lines.push("");

  if (mergedItems.length || openItems.length) {
    lines.push("| Repo | Contribution | PR | Status |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(...(await rows(openItems, "🟡 Open")));
    lines.push(...(await rows(mergedItems.slice(0, 10), "✅ Merged")));
    lines.push("");
  }

  lines.push(
    `<sub>Updated ${new Date().toISOString().slice(0, 10)} · ` +
      `[all PRs →](https://github.com/pulls?q=${encodeURIComponent(BASE)})</sub>`
  );

  const block = `${START}\n${lines.join("\n")}\n${END}`;
  const readme = readFileSync(README, "utf8");

  if (!readme.includes(START) || !readme.includes(END)) {
    throw new Error(`Markers ${START} / ${END} not found in ${README}`);
  }

  const updated = readme.replace(
    new RegExp(`${START}[\\s\\S]*?${END}`),
    () => block
  );

  if (updated === readme) {
    console.log("No changes.");
    return;
  }
  writeFileSync(README, updated);
  console.log(`Updated: ${merged.total_count} merged, ${open.total_count} open.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
