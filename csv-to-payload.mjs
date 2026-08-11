#!/usr/bin/env node
// 「表によるマトリックス分析 - 企業一覧」CSVをimport-norikae.mjs用のpayload.json
// (jobs/scores)に変換するスクリプト。
//
// 使い方: node csv-to-payload.mjs <CSVファイルのパス> [出力先.json]
//   出力先を省略した場合は payload.json に書き出す。

import fs from "node:fs";

const DATA_START_ROW_INDEX = 9; // 10行目(1始まり)から先がデータ
const COMPANY_COL = 5;
const SITE_COL = 1;
const REQUEST_COL = 2;
const STATUS_COL = 3;
const OLD_TOTAL_COL = 4;
const CRITERIA_START_COL = 7; // r[7]〜r[18]の12列

const CRITERIA_NAMES = [
  "ワークライフバランス",
  "雇用の安定",
  "労働時間",
  "シフトワーク",
  "通勤時間",
  "自由（仕事のコントロール権）",
  "達成（フィードバックシステムの有無）",
  "明確（タスク、ビジョン、評価の明確さ）",
  "多様（プロジェクト全体への関与）",
  "焦点（モチベーションタイプ）",
  "仲間（ソーシャルサポートの有無）",
  "貢献（他人への役立ちが見える）"
];

// RFC4180相当の簡易CSVパーサ(ダブルクォート内のカンマ・改行・エスケープ""に対応)。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function determineStage(request, status) {
  const req = (request || "").trim();
  const stat = (status || "").trim();
  // 「○」(U+25CB)と「◯」(U+25EF)が同じ意味で混在しているため両方を丸として扱う。
  if (stat.includes("✕") || req.includes("残念")) return "見送り";
  if (stat.startsWith("３")) return "一次";
  if (stat.startsWith("１") || stat.startsWith("２")) return "応募済";
  if (req.includes("✕")) return "見送り";
  if (req.includes("○") || req.includes("◯")) return "応募済";
  if (req.includes("△")) return "気になる";
  return "気になる"; // 空、その他
}

function buildMemo(site, request, status, oldTotal) {
  return `掲載: ${(site || "").trim()} / 応募: ${(request || "").trim()} / 選考: ${(status || "").trim()} / 旧合計${(oldTotal || "").trim()}点`;
}

function computeDesire(oldTotalRaw) {
  const n = parseFloat(oldTotalRaw);
  if (isNaN(n) || n === 0) return null; // 0点(未記入含む)は志望度を省略する
  let d = Math.round(n / 22);
  if (d < 1) d = 1;
  if (d > 5) d = 5;
  return d;
}

function convert(rows) {
  const jobs = [];
  const scores = [];
  let skippedNoCompany = 0;

  for (let i = DATA_START_ROW_INDEX; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const company = (r[COMPANY_COL] || "").trim();
    if (!company) {
      skippedNoCompany++;
      continue;
    }

    const site = r[SITE_COL];
    const request = r[REQUEST_COL];
    const status = r[STATUS_COL];
    const oldTotal = r[OLD_TOTAL_COL];

    const job = {
      "企業名": company,
      "ステージ": determineStage(request, status),
      "メモ": buildMemo(site, request, status, oldTotal)
    };
    const desire = computeDesire(oldTotal);
    if (desire !== null) job["志望度"] = desire;
    jobs.push(job);

    CRITERIA_NAMES.forEach((name, idx) => {
      const raw = r[CRITERIA_START_COL + idx];
      if (raw === undefined || raw === null || String(raw).trim() === "") return;
      const value = parseInt(raw, 10);
      if (isNaN(value)) return;
      scores.push({
        "候補と基準": `${company} / ${name}`,
        "候補": company,
        "基準": name,
        "重要度": value
      });
    });
  }

  return { jobs, scores, skippedNoCompany };
}

function main() {
  const csvPath = process.argv[2];
  const outPath = process.argv[3] || "payload.json";
  if (!csvPath) {
    console.error("使い方: node csv-to-payload.mjs <CSVファイルのパス> [出力先.json]");
    process.exitCode = 1;
    return;
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  console.log(`CSV総行数: ${rows.length}(先頭9行はヘッダー等としてスキップ)`);

  const { jobs, scores, skippedNoCompany } = convert(rows);
  fs.writeFileSync(outPath, JSON.stringify({ jobs, scores }, null, 2));

  console.log(`会社名なしでスキップした行: ${skippedNoCompany}`);
  console.log(`応募先: ${jobs.length}件 / 採点: ${scores.length}件 (合計 ${jobs.length + scores.length}件)`);
  console.log(`書き出し先: ${outPath}`);
  console.log("先頭2件のプレビュー:");
  console.log(JSON.stringify({ jobs: jobs.slice(0, 2), scores: scores.slice(0, 24) }, null, 2));
}

main();
