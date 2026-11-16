// analyze.mjs —— 联想词分析（Node18+ ESM）
// 用法： node analyze.mjs            （自动取 collected 下最新 json）
//       node analyze.mjs collected/suggest_xxx.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'collected');

/* ---------- 定位数据文件 ---------- */
function locate() {
  const arg = process.argv[2];
  if (arg) return path.resolve(__dirname, arg);
  const files = fs.readdirSync(DIR).filter(f => /^suggest_.*\.json$/.test(f));
  if (!files.length) throw new Error('collected 下没有 suggest_*.json，先跑采集脚本');
  return path.join(DIR, files.sort().pop());
}
const file = locate();
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const freq = data.freq || {};
const records = data.records || [];

/* ---------- 工具 ---------- */
const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
const total = entries.reduce((s, [, c]) => s + c, 0);
const pct = n => ((n / total) * 100).toFixed(1) + '%';
const bar = (n, max) => '█'.repeat(Math.max(1, Math.round((n / max) * 24)));
const MAX = entries[0]?.[1] || 1;

/* ---------- 1. 高频词 TOP 30 ---------- */
console.log(`\n数据源：${path.basename(file)}`);
console.log(`总词条 ${total}，去重 ${entries.length}，覆盖查询 ${records.length} 个\n`);
console.log('===== 高频词 TOP 30 =====');
entries.slice(0, 30).forEach(([w, c], i) =>
  console.log(`${String(i + 1).padStart(2)}. ${w.padEnd(16)} ${String(c).padStart(3)}  ${pct(c).padStart(5)}  ${bar(c, MAX)}`));

/* ---------- 2. 意图分类 ---------- */
const RULES = {
  价格: /多少钱|价格|费用|收费|便宜|贵|划算|免费|元/,
  教程: /怎么用|怎么弄|怎么操作|教程|方法|步骤|如何|怎么开|怎么办理|怎么办/,
  避坑: /避坑|骗局|骗|坑|靠谱吗|可靠|真假|风险|注意|后悔/,
  对比: /哪个好|排行|排名|推荐|对比|区别|vs|和.*哪个/,
  定义: /是什么|什么意思|什么叫|区别|原理|为什么/,
  资源: /下载|官网|入口|在线|工具|软件|app|链接/,
};
const buckets = {};
for (const [w, c] of entries) {
  for (const [k, re] of Object.entries(RULES)) {
    if (re.test(w)) { (buckets[k] ||= []).push([w, c]); break; }
  }
}
console.log('\n===== 意图分布 =====');
Object.entries(buckets)
  .map(([k, list]) => [k, list.reduce((s, [, c]) => s + c, 0), list])
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, sum, list]) => {
    console.log(`\n【${k}】共 ${sum} 次（${pct(sum)}）`);
    list.slice(0, 8).forEach(([w, c]) => console.log(`   - ${w} (${c})`));
  });

/* ---------- 3. 长尾需求（只出现 1 次但含疑问词）---------- */
const longtail = entries.filter(([w, c]) => c === 1 && /[?？]|怎么|如何|为什么|是什么|能不能|可以吗/.test(w));
console.log('\n===== 长尾疑问（各仅 1 次，共 ' + longtail.length + ' 条）=====');
longtail.slice(0, 20).forEach(([w]) => console.log('   · ' + w));

/* ---------- 4. 题材建议 ---------- */
console.log('\n===== 选题建议 =====');
const ideas = [];
Object.entries(buckets).forEach(([k, list]) => {
  const top = list.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  if (top.length) ideas.push({ k, top });
});
ideas.forEach(({ k, top }, i) =>
  console.log(`${i + 1}. [${k}] 围绕「${top.join('、')}」出内容，标题可直接套用搜索原词`));

/* ---------- 5. 导出 ---------- */
const out = path.join(DIR, 'report_' + path.basename(file).replace('suggest_', '').replace('.json', '.md'));
const md = [
  `---`，
  `title: 联想词分析报告`, 
  `pubDate: ${new Date().toLocaleString()}`,
  `---`，``,
  `数据源：${path.basename(file)} | 生成：${new Date().toLocaleString()}`, ``,
  `总词条 ${total}，去重 ${entries.length}`, ``,
  `## 高频词 TOP 30`, `| 词 | 次数 | 占比 |`, `|---|---|---|`,
  ...entries.slice(0, 30).map(([w, c]) => `| ${w} | ${c} | ${pct(c)} |`), ``,
  `## 意图分布`,
  ...Object.entries(buckets).map(([k, list]) =>
    `### ${k}（${list.reduce((s, [, c]) => s + c, 0)} 次）\n` + list.map(([w, c]) => `- ${w} (${c})`).join('\n')),
].join('\n');
fs.writeFileSync(out, md);
console.log('\n报告 →', out);
