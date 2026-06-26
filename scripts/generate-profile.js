const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'm1lestones';

async function ghFetch(endpoint) {
  const res = await fetch(`https://api.github.com/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'profile-generator'
    }
  });
  if (!res.ok) return null;
  return res.json();
}

function generateSparklineSVG(weeklyData) {
  const values = (Array.isArray(weeklyData) ? weeklyData : []).map(w => w.total).slice(-24);
  if (!values.length) return sparklineFallback();
  const max = Math.max(...values, 1);
  const W = 120, H = 28, pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <polyline points="${pts}" fill="none" stroke="#39d353" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}

function sparklineFallback() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28">
  <text x="4" y="18" font-size="10" fill="#555" font-family="monospace">private repo</text>
</svg>`;
}

function timeSince(dateStr) {
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function stackBadges(stack) {
  return stack.map(s => `\`${s}\``).join(' ');
}

function prStatusEmoji(pr) {
  if (pr.merged) return '✅ MERGED';
  if (pr.state === 'open') return '⏳ OPEN';
  return null;
}

async function getRepoMeta(repo) {
  const data = await ghFetch(`repos/${repo}`);
  const activity = await ghFetch(`repos/${repo}/stats/commit_activity`);
  return { data, activity };
}

async function buildOSSSection(prs) {
  const merged = [], open = [];

  for (const entry of prs) {
    const pr = await ghFetch(`repos/${entry.repo}/pulls/${entry.pr}`);
    if (!pr) continue;
    const status = pr.merged ? 'merged' : pr.state;
    if (status === 'closed') continue; // silently drop
    const row = { ...entry, merged: pr.merged, state: pr.state, url: pr.html_url };
    if (pr.merged) merged.push(row);
    else open.push(row);
  }

  let out = `## 🤝 Open Source Contributions\n\n> Real codebases. Real maintainers. No tutorial projects.\n\n`;

  if (merged.length) {
    out += `### ✅ Merged\n\n| Repository | Contribution | Stack |\n|---|---|---|\n`;
    for (const r of merged) {
      out += `| [${r.repo}](${r.url}) | ${r.description} | ${stackBadges(r.stack)} |\n`;
    }
    out += '\n';
  }

  if (open.length) {
    out += `<details>\n<summary>⏳ Open PRs (${open.length})</summary>\n\n`;
    out += `| Repository | Contribution | Stack |\n|---|---|---|\n`;
    for (const r of open) {
      out += `| [${r.repo}](${r.url}) | ${r.description} | ${stackBadges(r.stack)} |\n`;
    }
    out += `\n</details>\n\n`;
  }

  return out;
}

async function buildProjectCard(proj, sparklineSrc) {
  const liveLink = proj.url ? ` · [Live ↗](${proj.url})` : '';
  const repoLink = proj.private ? '🔒 Private' : `[GitHub ↗](https://github.com/${proj.repo})`;
  const discussLink = proj.private ? '' : `\n💬 [Leave feedback](https://github.com/${proj.repo}/discussions)`;

  return `### ${proj.name}
${proj.description}

![activity](assets/sparklines/${proj.repo.replace('/', '_')}.svg)

${stackBadges(proj.stack)} · ${repoLink}${liveLink}${discussLink}

---`;
}

async function buildFeaturedSection(projects) {
  const featured = projects.filter(p => p.category === 'featured');
  let out = `## 🌟 Featured Projects\n\n`;
  for (const proj of featured) {
    out += await buildProjectCard(proj) + '\n\n';
  }
  return out;
}

async function buildActivitySection(projects) {
  const ranked = [];
  for (const proj of projects.filter(p => !p.private)) {
    const activity = await ghFetch(`repos/${proj.repo}/stats/commit_activity`);
    const recentCommits = (activity || []).slice(-4).reduce((s, w) => s + w.total, 0);
    const repoData = await ghFetch(`repos/${proj.repo}`);
    ranked.push({ ...proj, recentCommits, pushedAt: repoData?.pushed_at });
  }
  ranked.sort((a, b) => b.recentCommits - a.recentCommits);

  let out = `## 📊 By Activity\n\n`;
  out += `<details>\n<summary>View all projects sorted by recent commit activity</summary>\n\n`;
  out += `| Project | Last Active | Recent Commits | Stack |\n|---|---|---|---|\n`;
  for (const p of ranked) {
    const repoLink = `[${p.name}](https://github.com/${p.repo})`;
    const lastActive = p.pushedAt ? timeSince(p.pushedAt) : '—';
    out += `| ${repoLink} | ${lastActive} | ${p.recentCommits} | ${stackBadges(p.stack)} |\n`;
  }
  out += `\n</details>\n\n`;
  return out;
}

function buildCategorySection(title, emoji, projects, category) {
  const filtered = projects.filter(p => p.category === category);
  if (!filtered.length) return '';
  let out = `<details>\n<summary>${emoji} ${title} (${filtered.length})</summary>\n\n`;
  out += `| Project | Description | Stack |\n|---|---|---|\n`;
  for (const p of filtered) {
    const link = p.private ? p.name : `[${p.name}](https://github.com/${p.repo})`;
    out += `| ${link} | ${p.description} | ${stackBadges(p.stack)} |\n`;
  }
  out += `\n</details>\n\n`;
  return out;
}

async function generateSparklines(projects) {
  const dir = path.join(process.cwd(), 'assets/sparklines');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const proj of projects) {
    const slug = proj.repo.replace('/', '_');
    const filePath = path.join(dir, `${slug}.svg`);
    if (proj.private) {
      fs.writeFileSync(filePath, sparklineFallback());
      continue;
    }
    const activity = await ghFetch(`repos/${proj.repo}/stats/commit_activity`);
    fs.writeFileSync(filePath, generateSparklineSVG(activity));
    await new Promise(r => setTimeout(r, 300)); // rate limit buffer
  }
}

async function main() {
  const projects = JSON.parse(fs.readFileSync('projects.json', 'utf8'));
  const ossPRs = JSON.parse(fs.readFileSync('oss-prs.json', 'utf8'));

  console.log('Generating sparklines...');
  await generateSparklines(projects);

  console.log('Building OSS section...');
  const ossSection = await buildOSSSection(ossPRs);

  console.log('Building featured section...');
  const featuredSection = await buildFeaturedSection(projects);

  console.log('Building activity section...');
  const activitySection = await buildActivitySection(projects);

  const pursuitSection = buildCategorySection('Pursuit / School Projects', '🎓', projects, 'pursuit');
  const personalSection = buildCategorySection('Personal Projects', '🔧', projects, 'personal');

  const readme = fs.readFileSync('README.md', 'utf8');

  const updated = readme
    .replace(/<!-- FEATURED_START -->[\s\S]*?<!-- FEATURED_END -->/,
      `<!-- FEATURED_START -->\n${featuredSection}<!-- FEATURED_END -->`)
    .replace(/<!-- ACTIVITY_START -->[\s\S]*?<!-- ACTIVITY_END -->/,
      `<!-- ACTIVITY_START -->\n${activitySection}<!-- ACTIVITY_END -->`)
    .replace(/<!-- OSS_START -->[\s\S]*?<!-- OSS_END -->/,
      `<!-- OSS_START -->\n${ossSection}<!-- OSS_END -->`)
    .replace(/<!-- PURSUIT_START -->[\s\S]*?<!-- PURSUIT_END -->/,
      `<!-- PURSUIT_START -->\n${pursuitSection}<!-- PURSUIT_END -->`)
    .replace(/<!-- PERSONAL_START -->[\s\S]*?<!-- PERSONAL_END -->/,
      `<!-- PERSONAL_START -->\n${personalSection}<!-- PERSONAL_END -->`);

  fs.writeFileSync('README.md', updated);
  console.log('README updated.');
}

main().catch(console.error);
