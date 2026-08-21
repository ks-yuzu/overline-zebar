# AI usage integration

この文書は、main widgetへ追加したClaude Code・Codex usage表示の設計、
表示仕様、運用方法、upstream追従時の注意点をまとめたものです。

## 目的と設計方針

- Claude CodeとCodexのusageをCPU/RAMと同じ場所で確認できるようにする。
- Zebarから認証済みCLIを直接起動せず、WSL内のJSONキャッシュだけを読む。
- 複数モニターやwidget再描画によるCLIの多重起動を避ける。
- usage取得によって不要な会話履歴やモデルtokenを発生させない。
- upstreamとのrebase競合を抑えるため、実装の大部分を新規ファイルへ分離する。
- 更新が止まっても最後に取得できた値を残し、stale状態を明示する。

## データフロー

```text
cron（5分ごと）
  ├─ claude-usage-json --force ─→ Claude /usage ─→ JSON cache
  └─ codex-usage-json --force  ─→ account/rateLimits/read ─→ JSON cache

Zebar（1分ごと・モニターごと）
  └─ wsl.exe ... *-usage-json --cached-only ─→ JSON cacheを読むだけ
```

live取得とwidget表示を分離する理由は次のとおりです。

- Claude取得には数秒以上かかる。
- Codex app-server取得にも実測で約3秒かかる。
- widgetはモニターごとに起動するため、直接取得するとプロセスが重複する。
- `--cached-only` のWindows→WSL読み出しは実測で約0.4秒だった。

各ヘルパーは一時ファイルへJSONを書き、検証後にcacheへ移動する。`flock`で
同時更新も防ぐ。live取得に失敗し、既存cacheがある場合は最後のcacheを返す。
このとき`generated_at`は更新されないため、widget側で停止を検出できる。

## ファイル配置

### Widget

- `widgets/main/src/components/aiUsage/`
  - Claude/Codexの配置、時刻更新、stale判定・表示を共有する。
- `widgets/main/src/components/claudeUsage/`
  - Claude JSONの検証、取得、表示を担当する。
- `widgets/main/src/components/codexUsage/`
  - Codex JSONの検証、取得、表示を担当する。

### WSL helpers

- `scripts/claude-usage/`
  - Claude `/usage` の操作、解析、cache更新、cron例。
- `scripts/codex-usage/`
  - Codex app-serverのusage取得、cache更新、cron例。

## 表示仕様

main widget右側の順序は次のとおり。

```text
StatProviders（CPU/RAMなど） → Claude usage → Codex usage → Volumeなど
```

共通仕様:

- Claudeは`Bot`、Codexは`Code2`アイコンを先頭に表示する。
- CPU/RAMと同じ`useInlineStats`設定を共有する。
  - ring設定: 割合を円形ゲージで表示する。
  - inline設定: 数値と`%`を表示する。
- usageの色は既存の`systemStatThresholds`を使う。
- リセット表示に`↻`記号は付けない。
- tooltipにはリセット、最終更新、stale理由などの詳細を表示する。

リセット表示:

- 24時間未満の枠は`2h 34m`のような残り時間にする。
- 24時間以上の枠は`08/24 09:00`のような日付・時刻にする。
- 残り時間はJSON更新と独立した1分timerで再計算する。
- Claudeのcurrent sessionは通常5H、current weekは通常7Dとして扱う。
- Codexは`windowDurationMins`から`5H`や`7D`を動的に作る。
- Codexの`primary`と`secondary`が両方ある場合は、短い期間から表示する。

## Stale判定

`generated_at`とwidget内の現在時刻を比較し、プロバイダーごとに判定する。

| 状態    | 条件                                      | 表示                           |
| ------- | ----------------------------------------- | ------------------------------ |
| fresh   | 8分未満                                   | 追加表示なし                   |
| warning | 8分以上、またはClaudeが`last_known`を報告 | 黄色の`ClockAlert`と`8m old`   |
| danger  | 20分以上                                  | 赤色の`ClockAlert`と`20m old`  |
| unknown | 日時が不正、または5分を超えて未来         | mutedの`ClockAlert`と`unknown` |

staleでもusage値は非表示にせず、最後に取得できた値を表示し続ける。色だけに
依存せず、アイコン・経過時間・tooltipを併用する。

Claudeの`refresh_status: "last_known"`は、cacheが新しくてもsource側の値が
古いことを示すため、直ちにwarningとする。Codexの失敗時は古いcacheの
`generated_at`が残るため、経過時間で検出する。

## 更新間隔

| 処理                        | 間隔・timeout |
| --------------------------- | ------------- |
| cron live更新               | 5分           |
| Zebar cache読み出し         | 60秒          |
| React Query `staleTime`     | 55秒          |
| Claude cron timeout         | 60秒          |
| Codex cron timeout          | 30秒          |
| Claude helper内部timeout    | 45秒          |
| Codex app-server応答timeout | 15秒/応答     |

`@reboot`はWindows起動そのものではなく、WSL内でcron daemonが起動した時点で
実行される。

## 認証とセッション履歴

### Claude

- cronを実行するWSL userでClaude Codeへ認証しておく。
- 固定の専用session UUIDを使い、毎回別のsessionを作らない。
- `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`でprompt履歴を保存しない。
- `/usage`だけを開き、model promptを送らない。
- 実測ではusage取得前後のccusage token差分は0だった。

### Codex

- cronを実行するWSL userでCodexへ認証しておく。
- app-serverの初期化後、account-levelの`account/rateLimits/read`だけを呼ぶ。
- `thread/start`、`thread/resume`、`thread/fork`、`turn/start`は呼ばない。
- modelを起動せず、会話thread・turnを作らない。
- 強制更新前後で`~/.codex/sessions`のファイル数とファイル名集合が変化しない
  ことを実測確認済み。

## CacheとJSON契約

Cache:

| Provider | Path                                        |
| -------- | ------------------------------------------- |
| Claude   | `$HOME/.cache/claude-usage-json/usage.json` |
| Codex    | `$HOME/.cache/codex-usage-json/usage.json`  |

cache directoryはmode `700`、JSONはmode `600`にする。認証tokenそのものはJSONへ
保存しない。

Claude UIが必要とする主なfield:

- `generated_at`
- `refresh_status`
- `last_known_age`（任意）
- `current_session.used_percent`、`resets_at`
- `current_week.used_percent`、`resets_at`

Codex UIが必要とする主なfield:

- `generated_at`
- `rate_limits.primary`
- `rate_limits.secondary`
- 各windowの`usedPercent`、`windowDurationMins`、`resetsAt`

## Machine-specific設定

現在のforkは次の環境を明示的に対象としている。

| 項目             | 値                                      |
| ---------------- | --------------------------------------- |
| WSL distribution | `<wsl-distribution>`                          |
| WSL user         | `<wsl-user>`                                  |
| Claude helper    | `$HOME/bin/claude-usage-json` |
| Codex helper     | `$HOME/bin/codex-usage-json`  |

Widgetのcommandは各`config.ts`、許可する完全一致commandは`zpack.json`にある。
環境を変える場合は両方を同時に変更する。

## Cron環境

cronはinteractive shellの初期化を行わない。特にNVMのPATHは通常読み込まれない。
Codex helperは次の順で実行ファイルを探索する。

1. `$HOME/bin/codex`
2. cronから見える`PATH`
3. `$HOME/.nvm/versions/node/*/bin/codex`

NVM配下で見つけた場合は、同じ`bin` directoryをPATHへ追加してから起動する。
これにより`#!/usr/bin/env node`もcron環境で解決できる。

cron jobは正常時のJSONを`/dev/null`へ送り、stderrだけを次のjournal tagへ送る。

- `claude-usage.cron`
- `codex-usage.cron`

## 運用コマンド

Live更新:

```sh
$HOME/bin/claude-usage-json --force
$HOME/bin/codex-usage-json --force
```

Cacheだけを確認:

```sh
$HOME/bin/claude-usage-json --cached-only
$HOME/bin/codex-usage-json --cached-only
```

更新時刻だけを確認:

```sh
jq -r .generated_at "$HOME/.cache/claude-usage-json/usage.json"
jq -r .generated_at "$HOME/.cache/codex-usage-json/usage.json"
```

cronとerror logを確認:

```sh
systemctl status cron
crontab -l
journalctl -t claude-usage.cron --since today
journalctl -t codex-usage.cron --since today
```

Widgetをbuild:

```sh
pnpm --filter @overline-zebar/main build
```

## Upstream追従

fork固有実装は可能な限り新規directoryへ分離している。upstream既存ファイルの
主な接続点は次の2つだけ。

- `widgets/main/src/App.tsx`
  - `AiUsage`のimportと配置。
- `zpack.json`
  - Claude/Codex helperを読むための`wsl.exe`権限。

`dist`、`node_modules`、cacheはGit管理しない。upstream更新時は次を基本とする。

```sh
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin feat/claude-usage
```

rebase後は、`App.tsx`内の表示順が
`StatProviders → AiUsage`になっていることと、`zpack.json`のcommand・正規表現が
各`config.ts`と一致していることを確認する。

## 検証項目

変更時は最低限、次を確認する。

```sh
corepack pnpm exec eslint \
  widgets/main/src/components/aiUsage \
  widgets/main/src/components/claudeUsage \
  widgets/main/src/components/codexUsage
corepack pnpm exec tsc --noEmit -p widgets/main/tsconfig.json
CI=1 corepack pnpm --filter @overline-zebar/main build
bash -n scripts/claude-usage/claude-usage-json
bash -n scripts/codex-usage/codex-usage-json
```

加えて、Windowsから実際のZebar commandと同じ`wsl.exe ... --cached-only`を実行し、
JSONが返ることを確認する。
