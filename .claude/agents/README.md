# .claude/agents/

このディレクトリには **互いに無関係な2系統** のAgentが同居しています。混同
しないこと — 片方はこのリポジトリのプロダクト本体を触り、もう片方は一切触りません。

この表は **何を壊せるか** で分けてある。同じ系統でも権限は違うので、行をまとめない。

| 系統 | 対象 | Agent | 権限(`tools:` 実体) |
|---|---|---|---|
| **A-1. 本体のコードを書き換える** | `src/`・`*.html`・`vite.config.js`・`automation/` | `vn-page-builder` | Read/Write/Edit/Glob/Grep/Bash/Skill |
| **A-2. データファイルだけ書く** | `public/data/news.json`・`econ-actuals.json` | `vn-news-tagger` | Read/Write/Glob(**Edit・Bashなし**) |
| **A-3. 書き込まない** | 読むだけ | `vn-frontend-reviewer`(Bashあり)・`vn-market-context`・`vn-sector-rotation` | Read/Glob 中心、**Writeなし** |
| **B. 日本株スクリーニング(同居する別ツール)** | 外部Webのみ | `orchestrator` ほか8体 | WebFetch/WebSearch のみ |

---

## A. VN Market Dashboard 本体を触るAgent

ページの追加・修正はここ。**必ず skill `vn-dashboard-engineering`
(`.claude/skills/vn-dashboard-engineering/SKILL.md`)を読んでから着手する**
設計になっており、両Agentの本文の冒頭にその手順が書いてある。

- `vn-page-builder.md` — ページ/パネル/フックの追加・修正。手順は
  「構造を分析 → grepで検証 → 4つの質問に答える → コード → build+preview」の順で固定。
- `vn-frontend-reviewer.md` — 読み取り専用のレビュー。偽の数値・`as of`欠落・
  `0`の露出・base pathの罠・JSON契約の断絶を、`file:line` の証拠付きで報告する。
- `vn-market-context.md` — `live.json` + `regime.json` + `cashout-vn.json` を読み、
  当日の市場概況をベトナム語で150–250字に要約する。買い/売り推奨なし。
- `vn-sector-rotation.md` — `sector-flows.json` の RS-Ratio/Momentum から
  Leading/Weakening/Lagging/Improving の4象限にセクターを分類して表示する。
- `vn-news-tagger.md` — `news-raw.json` を読み、3–6件の重要ニュースを選別して
  `news.json` に書き出す。`econ-actuals.json` のupsertも担当。WebSearch不要。

規範の優先順位: `CLAUDE.md`(法) > skill `vn-dashboard-engineering`(現状の
アーキテクチャ) > 本ファイル。

---

## B. 日本株過小評価株スクリーニング Multi-Agent システム

> 実際の運用手順・トラブルシューティングは `PLAYBOOK.md` を参照。

こちらのAgent群は **VN Market Dashboard 本体とは無関係の別ツール**です
(ユーザー個人の日本株リサーチ用に、このリポジトリに同居させているだけ)。
`src/`・`automation/`・`public/data/` には一切アクセスしません — 全Agentが
`tools: WebFetch, WebSearch`(orchestratorのみ`Agent`も追加)しか持たず、
Edit/Writeを持たないため構造的に不可能です。

### 構成
- `orchestrator.md` — 総責任者。8つの専門Agentを実際に起動・統合する(`Agent` tool必須)
- `benchmark-agent.md` — 業種別PER/PBRベンチマーク
- `intelligent-data-agent.md` — 個別銘柄データ収集+品質スコア付与
- `quantitative-screener.md` — 業種相対バリュエーションによる一次スクリーニング
- `eps-quality-analyst.md` — 利益の質評価
- `balance-sheet-quality-agent.md` — 財務健全性評価
- `catalyst-re-rating-agent.md` — 再評価トリガー検出
- `risk-liquidity-agent.md` — 流動性・集中リスク評価
- `dynamic-scoring-agent.md` — 全結果の統合・動的スコアリング

8つの専門Agentは末端(`Agent` toolなし、他Agentを起動しない)。orchestratorのみが
これらを呼び出す。呼び出し順序・並列化のルールは `orchestrator.md` 本文を参照。

## 既知の制約
- **Agent定義(frontmatterの`tools`等)を編集しても、編集した時点で動いている
  セッションには反映されない。** 新しいセッション(新しい会話)を開始して初めて
  変更が読み込まれる。同一セッション内で「直したから今すぐ動くはず」という
  前提を置かないこと。
- WebSearch/WebFetchのみで動作するため、EDINET/JPXの一次データへの網羅アクセスは
  できない。候補銘柄は二次集計サイト(株探・Yahoo!ファイナンス等)からのサンプリング
  に留まる。「市場全体の系統的フルスクリーニング」ではなく「業種横断的なサンプル
  調査」である点を、orchestratorは最終レポートで必ず開示する設計にしている。
- 投資助言(「買い」「目標株価」等)は出力しない方針を全Agentの出力原則に含める。

## 変更履歴
- 2026-08-29: `data-collector.md` / `fundamental-quality-agent.md` /
  `catalyst-detector.md` / `scoring-ranking-agent.md`(いずれも上位互換に統合済みの
  旧版)を削除。複数の類似Agentが並存すると自動選択時に曖昧さが生じるため。復元が
  必要な場合はgit履歴を参照。
- 2026-08-29: `orchestrator.md` に `Agent` tool を追加、かつ実行前のツール確認・
  ステージ別並列化・呼び出し回数の上限・失敗時の扱いを明文化。以前はAgent toolが
  frontmatterに無く、orchestrator自身が全専門Agentの役割をロールプレイで代行して
  いた(=分業による独立検証になっていなかった)ため。
