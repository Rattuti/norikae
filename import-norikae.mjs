#!/usr/bin/env node
// Notionブリッジ(notion-bridge)経由で、応募先・採点データを一括投入するスクリプト。
//
// 使い方:
//   APP_KEY=xxxxx node import-norikae.mjs payload.json
//   node import-norikae.mjs payload.json --dry   (投入せず中身を確認するだけ)
//
// payload.jsonの形式:
//   {
//     "jobs":   [ { "企業名": "...", "ステージ": "...", "メモ": "...", "志望度": 3 }, ... ],
//     "scores": [ { "候補と基準": "...", "候補": "...", "基準": "...", "重要度": 4 }, ... ]
//   }
// 各要素はそのままNotionのpropertiesとして渡される(キー名の変換は行わない)。

import fs from "node:fs";

const BRIDGE = "https://notion-bridge.rattuti.workers.dev";
const DATA_SOURCES = {
  jobs: "e371bbf6-6920-4a28-a7d7-57334f5ce084",
  scores: "6d4c91e1-208e-4373-b617-937943c738e0"
};
const PROGRESS_FILE = "progress.json";
const PROGRESS_INTERVAL = 20;

function loadProgress() {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    return { done: Array.isArray(data.done) ? data.done : [] };
  } catch {
    return { done: [] };
  }
}

function saveProgress(done) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ done: Array.from(done) }, null, 2));
}

const REQUEST_INTERVAL_MS = 350; // Notion APIのレート制限(概ね3req/秒)を超えないための間隔
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createPage(dataSourceId, properties) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BRIDGE}/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Key": process.env.APP_KEY || ""
      },
      body: JSON.stringify({ dataSourceId, properties })
    });
    if (res.ok) return res.json();

    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`create failed (${res.status}): ${text}`);
    }
    const backoff = REQUEST_INTERVAL_MS * Math.pow(2, attempt + 1);
    console.log(`  再試行します(${res.status}、${backoff}ms待機)`);
    await sleep(backoff);
  }
}

function buildTasks(payload) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const scores = Array.isArray(payload.scores) ? payload.scores : [];
  return [
    ...jobs.map((properties, index) => ({ type: "jobs", index, properties })),
    ...scores.map((properties, index) => ({ type: "scores", index, properties }))
  ];
}

async function main() {
  const filePath = process.argv[2];
  const isDry = process.argv.includes("--dry");

  if (!filePath) {
    console.error("使い方: node import-norikae.mjs <payload.jsonのパス> [--dry]");
    process.exitCode = 1;
    return;
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const scores = Array.isArray(payload.scores) ? payload.scores : [];

  if (isDry) {
    console.log(`応募先: ${jobs.length}件 / 採点: ${scores.length}件`);
    console.log("先頭数件のプレビュー:");
    console.log(JSON.stringify({ jobs: jobs.slice(0, 3), scores: scores.slice(0, 3) }, null, 2));
    return;
  }

  if (!process.env.APP_KEY) {
    console.error("環境変数 APP_KEY が設定されていません。");
    process.exitCode = 1;
    return;
  }

  const progress = loadProgress();
  const done = new Set(progress.done);
  const tasks = buildTasks(payload);
  const skipped = tasks.filter((t) => done.has(`${t.type}:${t.index}`)).length;
  if (skipped) console.log(`${skipped}件は投入済みのためスキップします。`);

  const remaining = tasks.filter((t) => !done.has(`${t.type}:${t.index}`));
  console.log(`投入対象: ${remaining.length}件`);

  let count = 0;
  try {
    for (const task of tasks) {
      const key = `${task.type}:${task.index}`;
      if (done.has(key)) continue;

      if (count > 0) await sleep(REQUEST_INTERVAL_MS);
      await createPage(DATA_SOURCES[task.type], task.properties);
      done.add(key);
      count++;

      if (count % PROGRESS_INTERVAL === 0) {
        console.log(`進捗: ${count}/${remaining.length}件投入(直近: ${key})`);
        saveProgress(done);
      }
    }
    console.log(`完了。今回${count}件投入しました(累計${done.size}件)。`);
  } catch (err) {
    console.error(`エラーが発生しました: ${err.message}`);
    console.error(`ここまでの進捗(${done.size}件)を保存して終了します。再実行すれば続きから投入されます。`);
    process.exitCode = 1;
  } finally {
    saveProgress(done);
  }
}

main();
