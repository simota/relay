# SQI 品質改善レポート (Software Quality Improvement Index)

対象: `relay` リポジトリ全体 (CLI / Hono API / Next.js Web UI)
比較: 改善前 `0fd0dd3` → 改善後 (ブランチ `claude/repo-architecture-design-quality-19pf7g`)

SQI はこのリポジトリ用に定義した**ルーブリック型の評価指標**であり、物理量ではない。
スコアと、それを裏付ける**実測値** (§4) を分けて読むこと。

---

## 1. 評価基準 (改善前に確定・改善後も不変)

### 1.1 構成と重み

`SQI = 0.25·DQI + 0.25·AQI + 0.25·VQI + 0.25·UXQI`。4領域ともフロントエンドが存在するので対象外はない。
各領域スコア = Σ(項目重み × 評点 / 5)。評点は 0–5、項目重みの合計は 100。

### 1.2 評点アンカー (全項目共通)

| 評点 | 判定条件 |
|---|---|
| 0 | 項目の要求をほぼ満たさない致命的欠陥がある |
| 1 | 主要な対象 (主要画面/主要モジュール) の過半で重大欠陥がある |
| 2 | 基本構成はあるが、同種の欠陥が 3 箇所以上で繰り返し観測される |
| 3 | 基本要件を満たし、残る欠陥は局所的で実用上の支障が小さい |
| 4 | 対象範囲で一貫して実装され、**再現可能な検査 (E2) で欠陥ゼロ**、または残存欠陥が軽微 1–2 件 |
| 5 | 4 に加え、例外ケースまで**自動テストで継続的に保証**され、独立した複数根拠 (E3) がある |

### 1.3 項目ごとの具体的判定材料

| 領域 | 項目 (重み) | 何を見て評点を決めるか |
|---|---|---|
| DQI | 責務分離 (20) | 1 ファイル内の独立した責務数 (`src/web/server.ts` 等)、層をまたぐ処理の混在 |
| DQI | 凝集度 (15) | モジュール内機能の関連性、委譲だけのメソッド群、無関係ユーティリティの混在 |
| DQI | 契約の明確性 (15) | 入力検証方式の統一度、エラー形状、型で表現された制約、イベント/状態の型 |
| DQI | 変更容易性 (15) | 同一ルールの重複実装数 (例: repo 存在判定、helper の再実装) |
| DQI | 可読性 (10) | 命名・コメント・定型処理の冗長さ (早期 return ごとの手動 close など) |
| DQI | テスト容易性 (15) | 依存差し替え点、テストの環境依存、境界ケースのテスト有無 |
| DQI | 不変条件・例外処理 (10) | リソース解放の保証、握りつぶし、状態の誤記録 |
| AQI | 境界・依存方向 (20) | 循環依存数、層違反 (api→commands 等)、不要な実行時エッジ |
| AQI | レイヤー・データフロー (15) | CLI/API → db の一方向性、状態の所在 |
| AQI | 変更影響の局所性 (15) | 代表シナリオ (adapter 追加 / repo 判定変更 / 画面追加) の波及ファイル数 |
| AQI | 契約・整合性 (15) | 冪等 ingest、schema_version、undo の原子性、API 互換 |
| AQI | 障害耐性 (10) | 例外時の接続リーク、部分失敗の隔離、失敗の伝播 |
| AQI | セキュリティ境界 (10) | Host/Origin/CORS ガード、パストラバーサル、引数のサニタイズ |
| AQI | 観測可能性 (10) | 失敗理由がログ/UI に出るか、sync_history 等の記録 |
| AQI | スケーラビリティ (5) | 無制限に成長する構造の有無 (キャッシュ等) |
| VQI | 視覚的階層 (20) | 主要情報/状態の強調が意味と一致するか (誤った成功色など) |
| VQI | 一貫性 (20) | 未定義トークン、スタイル重複、ボタン/トグル/モーダルの実装揺れ |
| VQI | タイポグラフィ (15) | 型スケール逸脱数、≤10px テキスト数 |
| VQI | レイアウト・レスポンシブ (15) | 横スクロール発生ページ数 (実測)、クリッピング |
| VQI | 状態表現 (10) | focus/disabled/loading/empty/error の視認性 |
| VQI | 色・コントラスト (10) | トークン対コントラスト不合格数 (実測)、axe color-contrast 件数 |
| VQI | 余白・密度 (10) | 余白の一貫性、情報密度 |
| UXQI | タスク達成 (25) | 主要タスク (確認/作成/close・snooze/undo/絞込み/sync) の操作経路 |
| UXQI | 発見容易性 (15) | ラベル、現在位置、次の行動の明示 |
| UXQI | 予測可能性 (15) | 操作が副作用なく期待通り動くか |
| UXQI | フィードバック (10) | 成功/失敗/読込中が伝わるか、エラーが空状態に化けないか |
| UXQI | エラー防止・回復 (10) | 取消・再試行・確認 |
| UXQI | アクセシビリティ (15) | axe 違反数 (実測)、セマンティクス、キーボード、フォーカス管理 |
| UXQI | 体感性能 (10) | CLS (実測、>0.1 を要改善)、読込状態、バンドル増分 |

### 1.4 計測条件 (固定)

- データ: `quality/scripts/seed-fixture.sh` の固定フィクスチャ (2 repo / 6 task、close 1・snooze 1)
- 画面: `/ /tasks /repos /sessions /agenda /insights /review /contexts /sync` の 9 ルート
- テーマ: `dark`, `light` / ビューポート: 1440×900 (desktop), 390×844 (mobile) / `reducedMotion: reduce`
- ツール: Playwright (Chromium) + axe-core 4.10 (`wcag2a, wcag2aa, wcag21a, wcag21aa`)、`quality/scripts/ui-audit.cjs`
- 権限: ローカル単一ユーザー (認証なしが仕様)
- 注意: `/sessions` はフィクスチャではなく実行環境の `~/.claude` 等を読むため、内容は環境依存

### 1.5 基準の変更履歴 (1 件・前後とも同じ新基準で再評価済み)

- トークン・コントラスト検査に `fg-dim` / `fg-muted` × `bg-elev-2` を追加した (234 組)。
  理由: 選択行・ホバー行 (bg-elev-2) と淡い警告色の上で 4.43:1 の残存違反を axe が検出したため。
  改善前 CSS を新基準で再測定し、198 組時点の 52 件ではなく **71 件** を改善前値として採用した。

### 1.6 根拠レベル

E0 根拠なし / E1 コード・画面の観察 / E2 再現可能な静的解析・自動テスト・体系的手動検証 / E3 実測・独立した複数根拠。
**実ユーザーテストは実施していない。** UX の評点は専門家評価 (E1) と自動検査 (E2) によるもので、タスク成功率などの実ユーザー指標は含まない。

---

## 2. スコア比較

| 指標 | 改善前 | 改善後 | 差分 | 判定 | 評価カバレッジ | 根拠の信頼性 |
|---|---:|---:|---:|---|---:|---|
| DQI：設計品質 | 60.0 | 62.0 | +2.0 | 改善 | 100% | E1 主体 + E2 (テスト) |
| AQI：アーキテクチャ品質 | 65.0 | 67.0 | +2.0 | 改善 | 100% | E1 + E2 (API 差分検証) |
| VQI：デザイン品質 | 49.0 | 61.0 | +12.0 | 改善 | 100% | E2/E3 (実測) + E1 |
| UXQI：UI/UX品質 | 55.0 | 60.0 | +5.0 | 改善 | 100%（実ユーザー未検証） | E1 + E2 |
| **SQI：総合品質** | **57.25** | **62.50** | **+5.25** | **改善** | 100% | — |

改善幅はポイント差 (改善後 − 改善前)。いずれの領域・項目にも悪化はない。

---

## 3. 採点内訳

### DQI

| 評価項目 | 重み | 前 | 後 | 加重点差分 | 根拠 |
|---|---:|---:|---:|---:|---|
| 責務分離 | 20 | 3 | 3 | 0 | `src/web/server.ts` は 8 責務 (security / health / repo 集計 / task CRUD / 遷移+undo / focus / SSE sync / static) のまま。分割は未実施 (§7) |
| 凝集度 | 15 | 3 | 3 | 0 | `db/client.ts` の約 100 委譲メソッドは不変 |
| 契約の明確性 | 15 | 3 | 3 | 0 | `sync_error` イベントと `error` ページ状態を追加。ただし API 検証方式は 4 系統のまま |
| 変更容易性 | 15 | 3 | 3 | 0 | repo パス解決の重複 2→1 (`createRepoPathLookup`)。ただし `truncate` 15 重複などは残る |
| 可読性 | 10 | 4 | 4 | 0 | 早期 return ごとの手動 `db.close()` 59 行を削除。上限 4 で据え置き |
| テスト容易性 | 15 | 3 | 3 | 0 | テスト 97→128。`recordRunOutcome` に差し替え点を追加。構造全体の評価は据え置き |
| 不変条件・例外処理 | 10 | 2 | 3 | +2.0 | 例外時の接続リーク 47/58→0、成功 run の failed 上書きを修正、キャッシュ無制限成長を修正 (各テストあり)。`loadConfig` の不整合などが残るため 3 |

### AQI

| 評価項目 | 重み | 前 | 後 | 加重点差分 | 根拠 |
|---|---:|---:|---:|---:|---|
| 境界・依存方向 | 20 | 3 | 3 | 0 | 循環 0 (前後とも)。lib→db の不要な実行時エッジ 2 本を `import type` 化。api→commands 3 本は残る |
| レイヤー・データフロー | 15 | 4 | 4 | 0 | 変化なし |
| 変更影響の局所性 | 15 | 3 | 3 | 0 | 「repo 判定ルール変更」シナリオの変更箇所 3→2 |
| 契約・整合性 | 15 | 3 | 3 | 0 | 読取 30 エンドポイント + 書込 19 手順で旧版と応答同一 (E2)。undo 記録の非原子性は残る |
| 障害耐性 | 10 | 3 | 4 | +2.0 | 例外でも接続を必ず解放 (`using` + テスト)、sync 全体失敗を SSE で通知、snapshot 失敗を run 状態から隔離 |
| セキュリティ境界 | 10 | 4 | 4 | 0 | Host / Origin / CORS ガードは不変。既存テスト全通過 |
| 観測可能性 | 10 | 3 | 3 | 0 | sync 失敗をサーバーログと UI に出すようにしたが、体系的な改善ではない |
| スケーラビリティ | 5 | 3 | 3 | 0 | insights キャッシュに 256 件の上限 (テストあり)。重みが小さいため据え置き |

### VQI

| 評価項目 | 重み | 前 | 後 | 加重点差分 | 根拠 |
|---|---:|---:|---:|---:|---|
| 視覚的階層 | 20 | 3 | 3 | 0 | 未同期なのに緑の成功ピルになる誤表示を中立化。レイアウト階層は不変 |
| 一貫性 | 20 | 3 | 3 | 0 | 未定義トークン 2 種 (21 箇所) を解消し、スウォッチ不一致 10→0 (テストあり)。生 `<button>` 63% やトグル 4 実装は残る |
| タイポグラフィ | 15 | 2 | 2 | 0 | 型スケール逸脱 326/664 は未対応 |
| レイアウト・レスポンシブ | 15 | 1 | 3 | +6.0 | 横スクロールのページ 18/18 (445px)→0/18 (実測 E3)。モバイルは仕様上 Non-Goal のため最低限の対応 |
| 状態表現 | 10 | 2 | 3 | +2.0 | フィルタバー、standup 行、ナビ、トグルに可視フォーカス。loading / error 状態を追加。bulk バーの disabled 表現は残る |
| 色・コントラスト | 10 | 2 | 4 | +4.0 | トークン対の不合格 71/234→0/234 (テストで常時保証)、axe color-contrast 356→0 ノード |
| 余白・密度 | 10 | 4 | 4 | 0 | 変化なし |

### UXQI

| 評価項目 | 重み | 前 | 後 | 加重点差分 | 根拠 |
|---|---:|---:|---:|---:|---|
| タスク達成 | 25 | 3 | 3 | 0 | デスクトップの操作経路は不変 (E2E で確認)。モバイルのナビは可能になったが、実ユーザー未検証のため据え置き |
| 発見容易性 | 15 | 3 | 3 | 0 | sync ピルに次の行動 (⇧R) を表示し、`aria-current` を追加 |
| 予測可能性 | 15 | 3 | 3 | 0 | 24h/7d 切替でパネルが畳まれる・再マウントする問題と、close トーストの「View snoozed」を修正 |
| フィードバック | 10 | 2 | 3 | +2.0 | 一般エラーが空状態・永久ローディングに化ける問題 (46 呼出) を修正。undo 失敗を通知し、sync 失敗理由を表示。Today / Sync に読込状態 |
| エラー防止・回復 | 10 | 3 | 3 | 0 | エラー状態に Retry が出るようになった。一括 close に確認がない点は残る |
| アクセシビリティ | 15 | 2 | 3 | +3.0 | axe 389→0 ノード (E2)。ドロワーのフォーカストラップ・Esc・フォーカス復帰を E2E で確認。タスク行が `div onClick`、`<main>` の入れ子、skip link なし、スクリーンリーダー実機未検証のため 4 にしない |
| 体感性能 | 10 | 3 | 3 | 0 | CLS>0.1 のページ 12→2、desktop の最大 CLS 0.119→0.047。mobile `/insights` が 0.13 のため据え置き |

---

## 4. 客観的な改善指標 (実測)

| 領域 | 指標 | 改善前 | 改善後 | 測定方法 |
|---|---|---:|---:|---|
| アクセシビリティ | axe 違反ノード (9 ルート × 2 テーマ, desktop) | 389 | **0** | `ui-audit.cjs` |
| アクセシビリティ | 違反ルール種別 | 3 (color-contrast, nested-interactive, aria-prohibited-attr) | 0 | 同上 |
| デザイン | テーマトークン対コントラスト不合格 (18 テーマ × 13 組) | 71 / 234 | **0 / 234** | `web/nextjs/lib/theme-tokens.test.ts` |
| デザイン | 未定義 CSS トークン参照 | 2 種 / 21 箇所 | 0 | grep + テスト |
| デザイン | テーマスウォッチ / トークン不一致 | 10 | 0 | テスト |
| レイアウト | 横スクロールが出るページ (36 ページ中) | 18 (全 mobile, +445px) | **0** | `scrollWidth − clientWidth` |
| 体感性能 | CLS > 0.1 のページ (36 ページ中) | 12 | 2 | PerformanceObserver |
| 体感性能 | 最大 CLS desktop / mobile | 0.119 / 0.216 | 0.047 / 0.131 | 同上 (※1) |
| 設計 | 例外時に閉じられない DB 接続 (API 層 58 箇所中) | 47 | **0** | 静的走査 + `src/db/client.test.ts` |
| 設計 | 検証済みの実バグ | 3 (キャッシュ無制限 / run 状態上書き / sync 失敗の黙殺) + UI 2 (エラーが空状態化 / 誤った成功表示) | 0 | 各回帰テスト |
| アーキテクチャ | 循環依存 | 0 | 0 | Tarjan SCC |
| アーキテクチャ | lib→db の不要な実行時 import | 2 | 0 | grep |
| 互換性 | 旧版との API 応答差分 (読取 30 + 書込 19) | — | 0 (※2) | 旧版・新版サーバーを並走させて比較 |
| 品質保証 | テスト数 (pass / fail) | 97 / 0 | 128 / 0 | `bun test` |
| 品質保証 | Lint | 0 errors / 9 warnings | 0 / 9 (同一、未変更ファイル) | `bun run lint` |
| 性能 | First Load JS: 共有 / `/` | 103 kB / 151 kB | 103 kB / 152 kB | `next build` |
| 性能 | 静的チャンク合計 | 6,287,040 B | 6,294,423 B (+0.12%) | `du -sb` |

※1 mobile の改善前値は、コンテンツが画面外に切れていたため CLS が過小に出ている (CLS は可視領域の移動のみ数える)。mobile `/insights` は 0.102→0.131 と数値上は増えたが、この交絡があるため改善とも悪化とも断定しない。
※2 `/api/health` の `frontend` フィールドだけは比較用の旧版ワークツリーにフロントのビルドがないため異なる (コード差ではない)。agenda / standup / digest は応答生成時刻を正規化して一致。

ページ読込の中央値 (約 880ms → 約 820ms) は 1 回ずつのローカル計測で、ノイズの範囲内と判断し、改善とは**主張しない**。

---

## 5. 変更ファイル

| コミット | 主なファイル | 目的 / 指標 | 互換性 | 検証 |
|---|---|---|---|---|
| `fix(web): bring all 18 theme token sets…` / `…bg-elev-2 surfaces too` | `web/nextjs/app/globals.css`, `components/theme-picker.tsx`, `lib/theme-tokens.test.ts` | コントラスト (VQI 色、UXQI a11y)。明度のみ調整し、色相・彩度は維持 | テーマ ID・トークン名は不変 | 21 テスト。旧 CSS では 18 件失敗することを確認 |
| `fix(web): resolve axe WCAG A/AA violations…` | `standup-panel`, `heatmap`, `sessions/page`, `sidebar`, `filter-bar`, 入力 8 箇所, `queue-tray`, ダイアログ 3 種, `agenda/page` | ネスト操作要素、隠れたリンク、ラベル、セマンティクス (UXQI a11y) | 操作・遷移先は不変 | axe 0 件、E2E |
| `feat(web): responsive shell, stable first paint…` | `app-shell`, `app/page`, `sync/page`, `sync-pill`, `page-state`, `toast`, `lib/copy` | レスポンシブ、CLS、フィードバック | desktop の見た目は不変。`PageStateVariant` に `error` を追加 | E2E 14/14、CLS 実測 |
| `fix(server): close SQLite connections…` | `src/db/client.ts`, `src/api/*` (10), `src/web/server.ts`, `src/db/client.test.ts` | 例外安全 (DQI 不変条件、AQI 障害耐性) | `close()` を冪等化。API 応答は不変 | 3 テスト、API 差分 0 |
| `fix(insights): bound the response cache…` | `src/api/insights.ts` | 無制限成長を防止 (AQI スケーラビリティ) | 応答は不変 | 上限テスト (上限処理を外すと失敗することを確認) |
| `fix(run): a failed context snapshot…` | `src/commands/run.ts`, `run.test.ts` | run 状態の誤記録を修正 | CLI 出力に警告 1 行を追加 | 2 テスト |
| `refactor(server): share one repo path lookup…` | `src/repo-metadata.ts`, `src/web/server.ts`, `src/repo-resolver.test.ts` | 重複ルールの一本化 (DQI 変更容易性) | `/api/repos`・`/api/counts` の応答は同一 | 2 テスト + 差分比較 |
| `fix(sync): report a failed sync run over SSE…` | `src/web/server.ts`, `components/sync-button.tsx`, `server.test.ts` | 失敗の可視化 (AQI 観測・障害耐性、UXQI フィードバック) | 新イベント `sync_error` を追加。既存イベントは不変 | テスト (catch を外すと失敗することを確認) |
| `refactor(lib): import RelayDB as a type…` | `src/lib/activity-calendar.ts`, `repo-promise-summary.ts` | 不要な実行時依存の削除 | なし | typecheck / test |
| `docs: …` | `WEB_DESIGN.md`, `quality/` | モバイル対応の範囲とコントラスト規約の明文化、計測スクリプト | — | スクリプトを新規フィクスチャで再実行し同値を確認 |

全コミットが単独で root / web の typecheck を通る (bisect 可能であることを個別に確認)。

---

## 6. 品質保証結果

- `bun test`: **128 pass / 0 fail** (改善前 97 / 0。追加 31 件: トークン 21、DB ライフサイクル 3、run 2、キャッシュ 2、SSE 1、repo lookup 2)
- `bun run typecheck` (root) / `web/nextjs` typecheck: 成功
- Lint: 0 errors / 9 warnings。warning はすべて未変更の `fleet-hamlet-*` で、改善前と同一
- `web/nextjs` の `next build`: 成功、静的エクスポートを再生成。`bun run build` → `bun dist/cli.js --help`: 成功。バンドルしたサーバーでの API スモークテストも成功
- E2E (`quality/scripts/ui-smoke.cjs`): 14/14 PASS
  - 対象: ドロワーの開閉・フォーカス移動/復帰・Esc・遷移、desktop での非表示、aria-current、standup の行選択・リンク遷移・トグル、queue tray、ダイアログのラベル
- 互換性: 旧版と新版を並走させ、読取 30 エンドポイントと書込 19 手順の応答を比較し、同一であることを確認
- スキーマ変更: なし (`schema_version` も不変)

---

## 7. 未検証項目・残存リスク・今後の候補

**未検証 / 主観が残るもの**

- 実ユーザーテスト (タスク成功率、所要時間、誤操作率) は未実施。UXQI は専門家評価と自動検査に基づく。
- スクリーンリーダー実機 (VoiceOver / NVDA) は未検証。axe 0 件は WCAG 完全適合を意味しない。
- 18 テーマのうち画面で確認したのは dark / light のみ。他 16 テーマはトークン検査 (E2) のみ。
- `/sessions/detail` (3D / fleet 系の大型コンポーネント) は監査対象外。

**採用しなかった変更と理由**

- `server.ts` の責務分割、api→commands 依存の解消: 変更範囲が広い。`server.ts` はレビュー規約上の Always-Human パスでもある。
- `truncate` ×15・`enumerateGitRepos` ×4 の統合: 実装ごとに挙動 (省略記号・区切り) が異なり、出力互換を保証しにくい。
- タスク ID 検証の厳格化 (`1.5` を 400 で拒否): 現状は 404 を返す。エラー契約が変わるため見送り。
- 型スケールの整理 (逸脱 326 箇所): 全画面の見た目が変わるため、デザイン判断として別途合意が必要。

**既知の残存問題 (候補)**

- mobile `/insights` の CLS 0.13 (ウィジェットごとに非同期読込)。mobile `/tasks` 0.09。
- タスク一覧の行が `div onClick` のまま (キーボードは j/k で代替可能)。`<main>` の入れ子、skip link なし。
- 一括 close / queue clear / review finish に確認がない (undo は ⌘Z で可能)。
- mobile の Today は選択行への自動スクロールで見出しが隠れる (改善前から)。
- undo 記録が状態変更と同一トランザクションでない (`server.ts` 遷移、`api/tasks.ts`)。
- `loadConfig` が読取エラーを黙ってデフォルトに倒す一方、TOML の構文エラーでは例外を投げる。

---

## 8. 再現手順

```bash
H=$(mktemp -d)/relay-home
quality/scripts/seed-fixture.sh "$H"
(cd web/nextjs && bun run build)
RELAY_HOME="$H" bun run src/cli.ts web --port 7391 --no-open &
NODE_PATH=web/nextjs/node_modules:$(npm root -g) \
  node quality/scripts/ui-audit.cjs http://127.0.0.1:7391 /tmp/sqi-shots
NODE_PATH=$(npm root -g) node quality/scripts/ui-smoke.cjs http://127.0.0.1:7391
bun test   # トークンのコントラスト・API 回帰を含む
```
