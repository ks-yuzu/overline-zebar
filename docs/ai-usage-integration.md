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
  - Claude JSONの検証、取得、main bar表示、詳細widgetの起動を担当する。
- `widgets/main/src/components/codexUsage/`
  - Codex JSONの検証、取得、表示を担当する。
- `widgets/ai-usage-details/`
  - クリックで開くClaude詳細。左を5H、右を7Dとする3段構成で、
    現在値・window内の推移・14日の推移を並べる。
  - CPU/RAM詳細と同様、main bar直下へ配置し、focusを失うと閉じる。
- `widgets/codex-usage-details/`
  - クリックで開くCodex詳細、rate-limit windowの現在値と履歴グラフを表示する。
  - window名と時間幅は`windowDurationMins`から動的に決める。

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
- Codex詳細もClaudeと同じ3段構成とし、列をwindowに対応させる (短い順)。
  幅920px、高さ580px。3段目は14日を横軸とし、windowの長さで見方を変える。
  Claude・Codexで扱いは同じである。
  - **1日未満のwindow**はwindowごとの到達点。1日に何度もresetするため、
    日へ畳むと複数のwindowが混ざる。
  - 集計単位を示すラベル (`Per window` / `Per day`、凡例) は両providerで同じ語に
    する。providerごとの呼び分け (Claudeは5Hを"session"と呼ぶ) を持ち込むと、
    同じ集計を別物として読ませてしまう。呼び名は上段のcardに残る。
  - **1日以上のwindow**は日次の消費量と累積。windowごとにすると14日で
    数本しか出ない。分母はその列のwindow自身のquotaで、横断的な基準は要らない。
- **windowのrangeは利用開始時点で確定する。** 使っていない間、報告される
  reset時刻は先送りされ続ける。Claude・Codexとも同じ挙動で、次で確認した。
  - reset時刻が前進した瞬間の使用率は、Claudeで92.9%、Codexで95.5%が0%だった。
  - **途中の値へ下がる遷移が皆無**である (Claude 0件/2607、Codex 0件/2583)。
    使用率は必ず「0 → 上昇 → 一気に0」しか通らない。rolling windowなら
    古い使用分から順に落ちるため、必ず途中の値を通る。
  - reset時刻が滑ることだけを見てrolling windowと誤判定した経緯がある。
    **滑るのは未使用の間だけ**であり、判別には減衰の有無を見る。
- trendの横軸は、開始済みのwindowでは`resets_at`を終端とするそのwindowのrange、
  未開始なら直近のwindow長とする。滑っている値を終端にすると軸のほとんどが
  未来になる。pace guideも未開始のwindowでは出さない。
  - **sampleは時間範囲ではなく、そのwindowのものを選ぶ。** 開始済みなら終端が
    一致するsample、未開始ならresetからの0%の連なり。範囲で選ぶと、reset直後の
    枠に前のwindowの登りが入る。
- 長期graphの消費量は、reset時刻ではなく**値の上昇から求める**。
  - 下降は使い切ったのではなく返却されたもの (reset) なので数えない。
  - **provider側で定時外のquota resetが起きることがある。** `resets_at`は
    変わらないまま使用率だけが0へ落ちる。値の上昇から求めていればこれも
    正しく扱える (下降は0として無視し、そこからの登り直しを数える)。
  - reset時刻に依存しないため、providerがそれを揺らしても壊れない。
    代償はresetから次のsampleまでに使った分だけで、5分粒度では無視できる。
- windowを識別するのは`windowEndsAt`で、**±5分の許容差**をもって比較する。
  揺れ幅はproviderで違う (Claudeは1分、Codexは秒) が、稼働中の終端は両者とも固定。
  - 未使用の間だけ終端が自走するため、**両端とも0%の移動では境界を開かない。**
  - **「値が下がったこと」を境界の条件にしてはいけない。** sampling gapがresetを
    またぐと、gap明けの値はgap前より高いことも同じくらいあり、境界が立たずに
    gap中のwindowがすべて融合する。実cacheで3本のwindowが消えていた。
  - 揺れへの耐性は許容差が担う。以前は「値が下がった」で代用していたが、Claudeが
    週次のresetを1分ずれて報告したsample1件でwindowが3つに割れ、1日に約49%の
    幻の消費が出た経緯がある。
- graphの系列色は、progress barと同じ`--success`を使う。
  **1つのgraphで緑にするのは主系列だけとし**、副系列は`--primary`に落とす。
  両方を同じ強さで塗ると、どちらを読めばよいかが伝わらない。
  - 14D weeklyの主系列はcumulative。日次の棒は副系列とする。
  - 単一系列のgraph (5H/7D trend、14D 5H peaks) はその系列が主系列。
  - pace guideと「データなし」の帯は系列ではないため`--border`のまま。
- **Claude/Codex chipの背景は、reset時点の予測使用率を左から塗る。**
  現在値はchipに数字で出ているため、背景は重複させず「このペースで
  reset前に尽きるか」を担う。popupを開かずに常時見えることが要件。
  - 予測 = 現在の使用率 ÷ windowの経過割合。詳細viewのpace guideと同じ
    線形の仮定を、1つの数にしたもの。
  - 5Hと7D (Codexは各window) のうち**予測が最も高いものだけ**を塗る。
    背景は信号を1つしか持てず、作業を止めるのは先に尽きるwindowであるため。
  - 経過が10%未満のwindowは投影しない。除数が小さく、reset直後に
    値が暴れるため。塗りは出さない。
  - **7Dの前半で過敏に出るのは、このモデルの性質として受け入れている。**
    線形外挿は経過が浅いほどburstに支配される。経過12%で週クォータの20%を
    使えば予測167%となり、その日はdangerの塗りが続く。閾値を上げる案と、
    経過が浅いうちは現在値へ寄せる案は採らなかった。前者は本当に速いペースの
    検知も遅らせ、後者は「このペースなら」という素直な意味を失う。
    **これを「バグ」として直しにかからないこと。**
  - 塗りの色は予測値に`systemStatThresholds`を当てる。100%を超える予測は
    満タン + danger色になる。
- リセット表示に`↻`記号は付けない。
- Claude/Codex chipはクリックで各専用詳細widgetを開く。native tooltipは使用しない。
- **詳細widgetのサイズは`zpack.json`のpresetではなく、`startWidget`へ渡すplacementが
  決める。** 各chipの`calculateWidgetPlacementFromRight`に渡す`height`が実際の高さになる。
  presetだけを変えても反映されないため、両方を同じ値に保つ。
- 詳細widgetは各windowの使用率、リセット、履歴、最終更新、freshness状態を表示する。
- graphの横軸は履歴量にかかわらず、reset時刻を終端として各window時間幅に固定する。
  Claudeは5時間・7日間、Codexは`windowDurationMins`の時間幅を使う。
  履歴が0件でも時間軸を表示し、1件ならその時刻の点だけを表示する。
- window開始時の0%からreset時刻の100%まで破線を引き、期間全体で線形消費した
  場合のpace guideとする。実績線が上なら速い消費、下なら遅い消費を示す。
- Claude詳細は3段構成とし、**全段で左を5H、右を7Dに固定する。**
  現在値、window内の推移、14日の推移が同じ列に並び、列が期間を表す。
  - この配置のため幅は920px、高さは580pxとする。
  - 3段目は保持履歴14日分を横軸とし、左に5H window単位、右に日単位の推移を置く。
    日や5H windowをまたぐ傾向は、window内のgraphからは読めない。
- 右列 (7D) の14日graph:
  - 棒は各日に消費した週クォータの割合、線は週次使用率の累積で、reset位置で区切る。
  - 棒は線がその日に上がった高さであり、同一単位となって0-100%の1軸へ二重軸なしで
    重ねられる。
  - ただし**定時外のresetが入ると、棒の合計は線の終端を上回る。** 同じ週の枠内で
    quotaが複数回配り直されるためで、消費量としてはそれが正しい。
  - 軸は使用量に追従させず0-100%へ固定する。追従させると使用が増えた時に
    軸が伸び、日ごとの比較が壊れるため。
  - sampleが1件もない日は0%の棒ではなく「データなし」として区別する。
    cron停止と不使用が同じ見え方になるため。
  - 保持期間の先頭のwindowは切り詰められているため、その最初のsampleは
    消費ではなく基準値として扱う。
- 左列 (5H) の14日graph。5Hの上限は作業を実際に止めるため、100%へ近づいた
  頻度を週クォータの消費とは別に見られるようにする。
  - 1本が1つの5H windowで、高さはそのwindowで到達した最大値。
    生の5H系列は14日の横軸では周期より粗くresampleされ、エイリアシングになる。
  - 値は最後のsampleではなくwindow内の最大値を取る。resetをまたいだsampleが
    新しい値と古いresets_atの組で入っても、そのwindowの山を消さないため。
  - sampleが1件もないwindowは「データなし」の帯にする。cronが取り逃したwindowと
    使わなかったwindowは、この面では区別が要る。
  - resetがまだ来ていないwindowは破線の枠だけで描き、最大値の表示からも除く。
    日次の棒も同じで、軸の両端にかかる日は一部しか入っていないため同じ扱いにする。
- `UsageTrend`のviewBox幅は`viewWidth`で渡す。svgは縦横比を保つため、
  card幅に対して比が合わないと、plotだけが中央へ寄って軸ラベルとずれる。
- `UsageHistory`のバーの横位置は、sampleの`windowEndsAt`から引く。これはwindowの
  同一性そのものでもある。以前は丸めた識別子を別に持っていたが、それを時刻として
  読み戻せずバーの位置がずれたため、許容差付きの比較へ一本化した。

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
- Claude Codeは起動directoryのtrustを一度確認し、応答するまでpromptを出さない。
  helperは`$HOME/.cache/claude-usage-json/workdir`で起動するため、この
  directoryだけ事前に手動でtrustしておく。cronからは応答できない。
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

**JSONは整形しない。** widgetがこのfileを60秒ごとに読み直すため、indentだけで
Claudeは約3割、Codexは約4割を占めていた。

**reset時刻を解析できなかった読み取りはhistoryへ入れない。** 使用率だけ取れて
reset時刻が取れないのは画面を描画途中で拾った時で、その使用率も信用できない
(観測された1件は、前後が8%の週次を0%と報告していた)。現在値の公開は続ける。
次回の取得で自然に直る一方、historyに入ると長期graphの消費量が二重計上になる。

定時外のresetと取得失敗は、**0へ落ちた後の戻り方**で区別できる。元の値へ戻れば
取得失敗、0付近から積み上がればresetである。

生sampleの追記先 (widgetは読まない):

| Provider | Path                                             |
| -------- | ------------------------------------------------ |
| Claude   | `$HOME/.cache/claude-usage-json/samples.ndjson`  |
| Codex    | `$HOME/.cache/codex-usage-json/samples.ndjson`   |

**cacheの`history`は書き込みのたびに14日で切り詰められ、それより古い生データは
恒久的に失われる。** 後から集計方法を変えても遡れないため、sampleを1行1件で
別fileへ追記しておく。1日288行、年あたり15-20MB程度で、rotationは行わない。
60秒以内の再実行ではcacheと同じく`recorded_at`が重複しうるので、読む側で
除去する。

Claude UIが必要とする主なfield:

- `generated_at`
- `refresh_status`
- `last_known_age`（任意）
- `current_session.used_percent`、`resets_at`
- `current_week.used_percent`、`resets_at`
- `history`
  - 5分ごとの5H・7D使用率と各reset日時を14日分保持する。
  - Claude側がlast-known値を返した場合は新しい履歴点として追加しない。

Codex UIが必要とする主なfield:

- `generated_at`
- `rate_limits.primary`
- `rate_limits.secondary`
- 各windowの`usedPercent`、`windowDurationMins`、`resetsAt`
- `history`
  - 5分ごとに、その時点で報告された全windowの使用率、時間幅、reset時刻を保持する。
  - 14日分を保持し、現在windowと時間幅・reset時刻が一致するsampleだけを描画する。

## Widgetが実行するcommand

widgetはdistribution名・user名・home directoryを埋め込まず、既定のWSL
distributionを既定のuserで起動する。

```text
wsl.exe -- sh -c '$HOME/bin/<helper> --cached-only'
```

`$HOME`はWSL側の`sh`が展開する。`--cached-only`はcacheを読むだけで、
`jq`・`flock`・各CLIも`PATH`も必要としないため、cron以外の最小環境で動く。

前提は次の2つだけである。

| 前提                     | 内容                                                      |
| ------------------------ | --------------------------------------------------------- |
| 既定のWSL distribution   | helperのcacheを更新するcronが動いているdistributionであること |
| helperの配置             | 既定userの`$HOME/bin/`にあること                            |

既定のdistributionは`wsl -l -v`の`*`で確認する。異なる場合は
`wsl --set-default <name>`で切り替えるか、各`config.ts`へ`-d <name>`を戻す。

widgetのcommandは各`config.ts`、許可する完全一致commandは`zpack.json`の
`argsRegex`にある。片方だけを変更すると`shellExec`が拒否されるため、
必ず同時に変更する。

## 配置・更新手順

配られたreleaseから入れる場合は[Releaseから導入する](./install-from-release.md)を見る。
ここはソースから作って実機へ反映する手順である。

この構成では、WSL上のソースリポジトリと、Windows側でZebarが実際に読む
インストール済みpackは別directoryである。ソースをbuildしただけでは実行中の
widgetは更新されないため、生成物と`zpack.json`をpack側へ同期してZebarを
再起動する。

> [!IMPORTANT]
> UI変更は「build → 実行packへの同期 → Zebarのreloadまたは再起動」までを
> 一続きの反映作業として扱う。buildだけ成功しても実行packは更新されず、
> その状態でreloadしても古いwidgetが再読込されるだけである。
>
> 実機への反映を含む作業では、表示確認を依頼したり作業完了を報告したりする前に、
> 必ず手順3の同期と同期結果の確認まで行う。CIやソース変更だけが目的で実行packへ
> 同期しない場合は、「未配置・未反映」であることを明記する。

配置先は次のとおり。

| 用途               | 配置先                                             |
| ------------------ | -------------------------------------------------- |
| ソースリポジトリ   | このリポジトリのcheckout                           |
| Claude helper      | `$HOME/bin/claude-usage-json`                      |
| Codex helper       | `$HOME/bin/codex-usage-json`                       |
| Claude cache・履歴 | `$HOME/.cache/claude-usage-json/usage.json`        |
| Claude作業directory | `$HOME/.cache/claude-usage-json/workdir`          |
| Codex cache        | `$HOME/.cache/codex-usage-json/usage.json`         |
| Zebar実行pack      | `%USERPROFILE%/.glzr/zebar/<pack>@<version>`       |

実行packは`%USERPROFILE%/.glzr/zebar`配下にある。`%APPDATA%/zebar/downloads`は
download元であり、custom packの配置先とは異なる点に注意する。packのversionは
Marketplace更新で変わるため、以下の`ZEBAR_PACK_DIR`はZebarが選択している実際の
directoryへ読み替える。

### 1. WSL helperを配置する

helperを変更した場合、リポジトリ内のscriptを`$HOME/bin`へ再配置する。

```sh
install -Dm755 scripts/claude-usage/claude-usage-json \
  "$HOME/bin/claude-usage-json"
install -Dm755 scripts/codex-usage/codex-usage-json \
  "$HOME/bin/codex-usage-json"
```

初回だけ各READMEに従って依存package、認証、cronも設定する。

- [Claude helper setup](../scripts/claude-usage/README.md)
- [Codex helper setup](../scripts/codex-usage/README.md)

### 2. Widgetをbuildする

main barとクリック時の各詳細viewは別widgetなので、3つともbuildする。

```sh
corepack pnpm --filter @overline-zebar/main build
corepack pnpm --filter @overline-zebar/ai-usage-details build
corepack pnpm --filter @overline-zebar/codex-usage-details build
```

### 3. Zebarの実行packへ同期する

`dist`だけでなく、新しいwidget定義とshell command権限を含む`zpack.json`も
必ず同期する。`ZEBAR_PACK_DIR`は自分の環境の実行packへ読み替える。

```sh
ZEBAR_PACK_DIR="/mnt/c/Users/<windows-user>/.glzr/zebar/<pack>@<version>"

install -d "$ZEBAR_PACK_DIR/widgets/main/dist"
install -d "$ZEBAR_PACK_DIR/widgets/ai-usage-details/dist"
install -d "$ZEBAR_PACK_DIR/widgets/codex-usage-details/dist"
cp -a widgets/main/dist/. "$ZEBAR_PACK_DIR/widgets/main/dist/"
cp -a widgets/ai-usage-details/dist/. \
  "$ZEBAR_PACK_DIR/widgets/ai-usage-details/dist/"
cp -a widgets/codex-usage-details/dist/. \
  "$ZEBAR_PACK_DIR/widgets/codex-usage-details/dist/"
install -m644 zpack.json "$ZEBAR_PACK_DIR/zpack.json"
```

同期後は、少なくとも各entry pointがbuild元と一致することを確認する。
次の`cmp`がすべて終了code 0なら、Zebarが次回読む`index.html`は最新である。

```sh
cmp widgets/main/dist/index.html \
  "$ZEBAR_PACK_DIR/widgets/main/dist/index.html"
cmp widgets/ai-usage-details/dist/index.html \
  "$ZEBAR_PACK_DIR/widgets/ai-usage-details/dist/index.html"
cmp widgets/codex-usage-details/dist/index.html \
  "$ZEBAR_PACK_DIR/widgets/codex-usage-details/dist/index.html"
```

`index.html`内のasset名はcontent hashを含むため、同期前後でasset名が更新されて
いることも反映確認の目安になる。

### 4. Zebarを再起動して確認する

Zebarのtray menuから終了して再起動する。main barのClaude/Codex chipをクリックし、
次を確認する。

- `ai-usage-details`と`codex-usage-details`がmain bar直下に開く。
- 5H・7Dの現在値とreset時刻が表示される。
- 取得済みの履歴がある場合、推移graphが表示される。
- 詳細viewの外をクリックすると閉じる。

開かない場合は、まずZebarが参照しているpackの`zpack.json`に
対象の詳細widget定義があることと、同じpack内に対応する`dist/index.html`が
あることを確認する。ソース側だけを更新しても、インストール済みpackには
自動反映されない。

## Cron環境

cronはinteractive shellの初期化を行わない。特にNVMのPATHは通常読み込まれない。

Claude helperは`$HOME/bin/claude`、次にcronから見える`PATH`を探索する。CLIを
`$HOME/.local/bin`などPATH外へ入れている場合はどちらでも見つからないため、
cron entryで`CLAUDE_USAGE_CLAUDE_BIN`を指定する。`expect`もcronから見える位置に
必要である。例は`scripts/claude-usage/crontab.example`にある。

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
corepack pnpm --filter @overline-zebar/main build
corepack pnpm --filter @overline-zebar/ai-usage-details build
corepack pnpm --filter @overline-zebar/codex-usage-details build
```

## Troubleshooting

widgetは失敗しても`--`を出すだけである。取得に失敗したとき、helperは実行した
commandと原因を`console.error`へ出す。widgetにfocusを当てて**Ctrl+Shift+I**を
押すとdevtoolsが開き、Consoleでそれを読める（Zebarに組み込まれたTauriの
devtools hotkey）。main barでfocusが取れない場合は、chipをクリックして開いた
詳細widgetで同じ操作を行う。詳細widgetも同じcommandを実行するため、原因は
同じものが出る。

Zebar自身はwidget実行時のerrorをlogに残さない。`~/.glzr/zebar/errors.log`にも
記録されないため、devtoolsを使わない場合はWindows側からZebarと同じcommandを
直接実行し、続けてcronのjournalを見る。`WSL_UTF8`を付けないと、`wsl.exe`自身の
errorはUTF-16LEで出るため文字化けする。

```powershell
$env:WSL_UTF8=1
wsl.exe -- sh -c '$HOME/bin/codex-usage-json --cached-only'
wsl.exe -- sh -c '$HOME/bin/claude-usage-json --cached-only'
$LASTEXITCODE
```

```sh
journalctl -t claude-usage.cron -t codex-usage.cron --since -30min
```

| 症状・出力                                          | 原因と対処                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `exited with -1`（`0xFFFFFFFF`）                    | helperではなく`wsl.exe`自身の起動失敗。errorはstdoutへ出るのでdevtoolsの続きの文言を読む。`wsl -l -v`で既定distributionを確認し、正しければ`wsl --shutdown`後に`wsl --update` |
| `exited with 127`                                   | 既定distributionにhelperが無い。`wsl --set-default <name>`、または`config.ts`へ`-d <name>`を戻す |
| distributionが見つからない旨のerror                 | 既定distributionがcacheを更新しているdistributionではない。`wsl -l -v`で確認し`wsl --set-default <name>`、または`config.ts`へ`-d <name>`を戻す |
| `cache is not available yet`（exit 66）             | cacheが未生成。cron側のlive更新が失敗しているので下の行を確認する          |
| `required command not found: expect`（exit 69）     | Claude helperの依存不足。`expect`を導入する                                |
| `Claude executable not found`（exit 69）            | cronのPATHに`claude`が無い。`CLAUDE_USAGE_CLAUDE_BIN`で明示する            |
| `timed out waiting for Claude Code input prompt`    | 起動directoryがtrustされていない。workdirで一度手動trustする               |
| `Codex executable not found`（exit 69）             | cronのPATHに`codex`が無い。`CODEX_USAGE_CODEX_BIN`で明示する               |
| 値は出るがstale表示のまま                           | cron停止、またはClaudeが`refresh_status: last_known`を返している           |

`shellExec`はwidgetの`config.ts`と`zpack.json`の`argsRegex`が完全一致した
ときだけ実行される。commandを変えて片方だけ更新すると、helperが正常でも
widgetは`--`のままになる。`env`は`argsRegex`の対象外なので、`WSL_UTF8`を
足しても`zpack.json`の変更は要らない。

exit codeの読み分けは次のとおり。`0`・`64`・`66`・`69`はhelperが返したもので、
それ以外は`wsl.exe`が返したものである。widgetはhelperのstderrと`wsl.exe`の
stdoutの両方をerror messageへ載せる。

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
git push --force-with-lease origin feat/ai-usage
```

rebase後は、`App.tsx`内の表示順が
`StatProviders → AiUsage`になっていることと、`zpack.json`のcommand・正規表現が
各`config.ts`と一致していることを確認する。

## 検証項目

変更時は最低限、次を確認する。

```sh
corepack pnpm exec eslint \
  packages/ui/src/components/usage-trend \
  packages/ui/src/components/usage-history \
  packages/ui/src/utils/usageSeries.ts \
  widgets/main/src/components/aiUsage \
  widgets/main/src/components/claudeUsage \
  widgets/main/src/components/codexUsage
corepack pnpm exec tsc --noEmit -p widgets/main/tsconfig.json
CI=1 corepack pnpm --filter @overline-zebar/main build
CI=1 corepack pnpm --filter @overline-zebar/ai-usage-details build
CI=1 corepack pnpm --filter @overline-zebar/codex-usage-details build
bash -n scripts/claude-usage/claude-usage-json
bash -n scripts/codex-usage/codex-usage-json
```

実機反映を伴うUI変更の完了条件は次のとおり。

- 対象widgetのlint・型check・buildが成功している。
- buildした全widgetの`dist`を、Zebarが実際に参照するpackへ同期している。
- ソース側とpack側の各`dist/index.html`が`cmp`で一致している。
- 同期後にZebarをreloadまたは再起動し、対象表示を確認している。

加えて、Windows側（PowerShellなど）からZebarと同じcommandを実行し、既定の
distributionでJSONが返ることを確認する。

```powershell
wsl.exe -- sh -c '$HOME/bin/claude-usage-json --cached-only'
wsl.exe -- sh -c '$HOME/bin/codex-usage-json --cached-only'
```
