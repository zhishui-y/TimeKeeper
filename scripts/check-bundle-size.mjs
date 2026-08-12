import { readFile, readdir } from "node:fs/promises";
import process from "node:process";
import { gzipSync } from "node:zlib";
import path from "node:path";

const assetsDirectory = path.resolve("dist", "assets");
const indexHtml = await readFile(path.resolve("dist", "index.html"), "utf8");
const initialMatch = /<script[^>]+src="\/?assets\/([^"]+\.js)"/u.exec(indexHtml);
if (!initialMatch) throw new Error("无法从 dist/index.html 找到初始 JavaScript chunk");

const assetNames = await readdir(assetsDirectory);
const revenueChartAsset = assetNames.find(
  (name) => name.startsWith("RevenueCharts-") && name.endsWith(".js"),
);
if (!revenueChartAsset) throw new Error("无法找到 RevenueCharts JavaScript chunk");

const budgets = [
  { label: "初始 JavaScript", asset: initialMatch[1], maximumKiB: 70 },
  { label: "收益图表 JavaScript", asset: revenueChartAsset, maximumKiB: 205 },
];

for (const budget of budgets) {
  const source = await readFile(path.join(assetsDirectory, budget.asset));
  const gzipKiB = gzipSync(source, { level: 9 }).byteLength / 1024;
  if (gzipKiB > budget.maximumKiB) {
    throw new Error(
      `${budget.label} ${gzipKiB.toFixed(2)} KiB gzip 超过 ${budget.maximumKiB} KiB 预算`,
    );
  }
  process.stdout.write(
    `${budget.label}: ${gzipKiB.toFixed(2)} KiB gzip / ${budget.maximumKiB} KiB\n`,
  );
}
