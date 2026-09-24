# AI usage integration

この文書は、main widgetへ追加したClaude Code・Codex usage表示の設計、
表示仕様、運用方法、upstream追従時の注意点をまとめたものです。

## 目的と設計方針

- Claude CodeとCodexのusageをCPU/RAMと同じ場所で確認できるようにする。
- Zebarから認証済みCLIを直接起動せず、WSL内のJSONキャッシュだけを読む。
- 複数モニターやwidget再描画によるCLIの多重起動を避ける。
- usage取得によって不要な会話履歴やモデルtokenを発生させない。
- upstreamとの競合を抑えるため、実装の大部分を新規ファイルへ分離する。
- 更新が止まっても最後に取得できた値を残し、stale状態を明示する。

## データフロー

```text
cron（5分ごと）
  ├─ claude-usage-json --force ─→ usage endpoint ─→ JSON cache
  │                            └→ (失敗時) Claude /usage ─┘
  └─ codex-usage-json --force  ─→ account/rateLimits/read ─→ JSON cache

Zebar（1分ごと・モニターごと）
  └─ wsl.exe ... *-usage-json --cached-only ─→ JSON cacheを読むだけ
```

live取得とwidget表示を分離する理由は次のとおりです。

- Claude取得には数秒以上かかる。
- Codex app-server取得にも実測で約3秒かかる。
- widgetはモニターごとに起動するため、直接取得するとプロセスが重複する。
- `--cached-only` のWindows→WSL読み出しは実測で約0.4秒だった (bash/perl helper時)。
  Python helperはWSL側だけで約0.7秒 (旧: 約0.007秒) を要し、interpreter起動が支配的である。

各ヘルパーは一時ファイルへJSONを書き、検証後にcacheへ移動する。lockで同時更新も
防ぐ。live取得に失敗し、既存cacheがある場合は最後のcacheを返す。
このとき`generated_at`は更新されないため、widget側で停止を検出できる。

## Claude usageの取得元

### Python helper

`scripts/claude-usage/claude-usage-json` は、既存のJSON契約をPython 3.9以上の標準library
で実装する。既定の出力先は `$HOME/.cache/claude-usage-json/usage.json` である。
endpointから受け取った有効なJSON応答は同じdirectoryの
`api-response.json` に原文のbyte列で保存する。

**同じbyte列を`api-responses/`にも残し、直近4032件を保持する。** 5分ごとのcronで
14日分、samplesと同じ長さである。**歪んだreadingは数日後に14Dのgraphの形として
初めて見えるため、最新1件だけでは出所を辿れない。**実際、週次の使用率が1日のうちに
7%と37%を4往復し、日次消費が143%に膨らんだ事例で、生応答が残っておらず
7%の出所を特定できなかった。整形せず原文で残すのは、誤りが応答の中身ではなく
読み出し側にある可能性を潰せないためである。

**JSONとして読めなかった応答は残さない。**readingを生まないため、辿るべき
readingが無い。endpointが壊れた理由を追うのは別の目的である。

**Codex helperも同じ形で生応答を残す。**保持先は`$HOME/.cache/codex-usage-json/api-responses/`、
保持数は `CODEX_USAGE_API_RESPONSE_KEEP` (既定4032)。**出所についてこれまで得られた
唯一の手がかりはCodex側から出た**ため、ここで残らないと次の発生でも辿れない。

- 残すのは`account/rateLimits/read`の応答行そのもの。`read`が取り込んだ改行だけが違う
- 連番順・剪定・権限の規則はClaude helperと同じ
- **名前がパターンに合わないfileは候補にしない。**連番は最新の名前から読むため、
  手で置かれた`.json`が1つあると算術エラーで`set -e`が実行ごと落とす
- 通常のfile以外 (同名のdirectoryなど) も候補にしない

保持数は `CLAUDE_USAGE_API_RESPONSE_KEEP` で変えられる。上限の4032件で8.2MB、
剪定の一覧取得と整列は実測58ms (drvfs上)。これが走るのはliveに取得した時、つまり
`--force`か、cacheが`CLAUDE_USAGE_CACHE_TTL`を過ぎた素の実行である。**widgetが叩く
`--cached-only`は触れない。**素の実行を繰り返すと保持枠を消費するため、疑わしい
readingを追う時は`--cached-only`で読むこと。

**整列の鍵に時計を使わない。**file名は連番が先頭で、捕捉時刻はその後ろに続く。
ホストの復帰などで時計が巻き戻ると、その間の実行はすべて「最も古い名前」を
書くことになり、次の実行に消される。`api-response.json`は更新されるため、
失われたことに気付く手段が無い。**時計が乱れた直後こそreadingが疑われる場面である。**

「直前に書いたfileを剪定の対象から外す」だけでは足りない。消すのは次の実行であって
自分自身ではないため、1 tick先送りされるだけで、時計が遅れている間じゅう保持される
post-stepのfileは常に1件だけになる。連番は書いた順そのものなので、時計と無関係に
正しく並ぶ。

**消せない1件で剪定を止めない。**削除は1件ずつ捕まえて次へ進む。詰まるfileは常に
最古＝常に先頭なので、一括で中断すると以後どの実行も同じ場所で止まり、
**剪定が恒久的に効かなくなる。**drvfs上でWindows側が掴んだfileなどが引き金になる。

**`api-response.json`の書き込み失敗でarchiveを諦めない。**別々の写しであり、
疑わしいreadingを引くのはarchiveの方である。

開発時など通常のcacheを分離したい場合は、`CLAUDE_USAGE_CACHE_DIR` に別directoryを
指定する。この指定だけでJSON cache、raw response、history、lockと、既定の作業directory
が分離される。

`CLAUDE_USAGE_TEXTFILE_PATH` を指定すると、成功したreadingから
node_exporter textfile collector用のfileも原子的に生成する。stale判定は静的な
真偽値に固定せず、次を組み合わせる。

- `claude_usage_generated_timestamp_seconds`: readingが生成された時刻。
- `claude_usage_refresh_last_known`: Claude自身がlast-knownと報告したか。

更新失敗時はcollector fileを置換しない。したがって
`time() - claude_usage_generated_timestamp_seconds` は古いreadingを保ち、取得停止を
新しい値で覆い隠さない。出力先の親directoryは事前に作成し、例えば次のように実行する。

```sh
CLAUDE_USAGE_TEXTFILE_PATH=/var/lib/node_exporter/textfile_collector/claude_usage.prom \
  "$HOME/bin/claude-usage-json" --force
```

出力する全metricには、`$HOME/.claude.json`の
`.oauthAccount.organizationUuid`、`.oauthAccount.accountUuid`、
`.oauthAccount.emailAddress`、`.userID`からそれぞれ`organization_id`、
`user_account_uuid`、`user_email`、`user_id`を付ける。email addressを含むため、
collector fileとPrometheusの閲覧権限はアカウント情報として扱う。4値のどれかが
読めない場合は、部分的で意味が変わるlabel setを出さず、4つとも省略する。
これはhelperが出す`used_percent`、`reset_timestamp_seconds`、
`generated_timestamp_seconds`、`refresh_last_known`の全sampleに適用する。

`https://api.anthropic.com/api/oauth/usage` を第一の取得元とする。認証は
`$HOME/.claude/.credentials.json` の OAuth access token、`anthropic-beta:
oauth-2025-04-20` ヘッダが要る。**画面解析は戻り道として残す。**

| | 画面解析 | endpoint |
| --- | --- | --- |
| 所要 | 14秒 | 0.4秒 |
| 起動するもの | Claude Code一式 | HTTPS 1本 |
| 必要な外部command | expect | なし |
| windowの判別 | 見出しの括弧書きを分類する | `kind` field |
| reset | 表記から日付を推定する | ISO 8601の瞬間 |

endpointは`kind`で枠を、`scope.model.display_name`でmodel名を明示するため、
**画面解析で必要だった括弧書きの分類がまるごと不要になる。**resetも瞬間で来る
ので、`5:50am`からどの日かを推定する処理も要らない。

### 失敗したときに何をするか

**endpointの答え方で分ける。panelを開くことが助けになる場合だけ開く。**

| 結果 | 扱い |
| --- | --- |
| 200かつwindowが揃う | それを使う |
| 401 / 403 | tokenが切れている。panelを開いて更新し、**その時だけ**再取得する |
| 404など、windowを含まない200 | endpointが変わった。panelの読み取りへ落とす |
| 429 / 5xx / 到達しない | **panelを開かない。**最後のcacheを返す |

**再取得するのは401/403の後だけ。** panelを開くとtokenが更新されるので、答えが
変わりうる。`changed`の後に訊き直しても同じ答えが返るだけで、拒否されている相手への
requestが1つ増える。

**429でpanelを開いてはいけない。** endpointはburstを拒否する (実測: 2分間に
8回で以降429、回復まで181秒)。panel自身のrefreshも同じendpointを叩くため、
開けば14秒かけて拒否されている通信を増やすだけになる。cacheを返し、鮮度表示に
任せる。**cronの5分間隔はこの制限の内側にある。**

**tokenの更新とpanelの読み取りは同じ1回で済ませる。** helperが起動するsessionは
自分からrequestを出さない (画面上も`0 input, 0 output`) ため、**起動しただけでは
tokenは更新されない。**`/usage`を開くと認証付きrequestが飛ぶので、そこで更新が
起きる。つまり「更新のための起動」と「画面を読むための起動」は同じ操作であり、
分けると起動が2回になる。

### 戻り道が守る範囲

**2つの経路は同じ認証情報を使う。** refresh tokenまで切れていればClaude Codeは
対話的な再ログインを求めるので、画面解析も同じく失敗する。画面解析が助けになるのは
**認証は生きていてendpointが変わった/落ちた**場合だけである。

**`timezone`は当てにならない前提で使う。** helperはhostから分かる名前をそのまま
載せるが、hostが正当に持つ形すべてを`Intl`が受けるわけではない (`JST`・`EST`は
通り、`CEST`・POSIX形式の`JST-9`や`:Asia/Tokyo`・`posix/Asia/Tokyo`は落ちる)。
**判定はwidget側で行い、使えない名前は捨てて閲覧者のzoneへ退避する** (`usableTimeZone`)。
生産側で形ごとに規則を足すと、新しい形が出るたびに抜ける。`resets_at`は絶対時刻
なので、どちらのzoneで描いても指す瞬間は変わらない。

**2つの経路が付ける`label`は一致している必要がある。** 画面は見出しの括弧書きを、
endpointは`scope.model.display_name`をそのまま使う。widget側はhistoryを`label`で
区切るため、**綴りが違えば切り替えた時点でmodel別のgraphが空になり、14日かけて
埋まり直す。**2026-09-07時点では両方とも`Fable`で一致することを実測で確認した。
model名が増えた時はここを確かめる。

**`CLAUDE_USAGE_SOURCE=screen`で経路を固定できる。** endpointが答えるようになると
画面解析はほぼ実行されず、通らない経路は必要になった時には壊れている。手動確認で
定期的に引くこと。

**tokenはheaderのfileから渡す。**command lineに置くと同じホストの全processから
見える。captureにもlogにも出さない。

## セッション名の解決

Claude Code自身がOpenTelemetryで送るmetric (`claude_code_*`) は、全sampleに
`session_id`を付けるが、**そのsessionが何の作業だったかは付けない。**それを持って
いるのは`~/.claude/projects`のtranscriptで、起動したdirectoryと、付けられた題が
そこにある。

`scripts/claude-sessions/claude-session-info-prom`がtranscriptを走査し、
node_exporter textfile collector向けに`claude_session_info`を出す。
**名前の解決はPromQLのjoinで、読み出し時に行う。**

```text
claude_session_info{session_id="…",session_name="#104 …",custom_title="#104 …",
  ai_title="…",task_id="104",project="overline-zebar",cwd="/home/…"} 1
```

**transcriptの最終更新は出さない。**emitterが止まったかどうかは、node_exporterが
このfileに対して既に出している`node_textfile_mtime_seconds`が答える。session
ごとの時刻を読む利用者は無い。

**読み出す側でtranscriptを引かないのは、別マシンのsessionを名前にできないため
である。**同じGrafana stackへ送っている別のマシンでこのemitterも動かせば、そちらの
sessionもこちらのpanelで名前が付く。手元のtranscriptを引く形ではこれができない。
実測 (2026-09-13) では、週のコスト$1,080のうち$397 (37%) が手元にtranscriptを
持たないsessionだった。

| label | 出所 |
| --- | --- |
| `session_id` | transcriptのfile名 |
| `custom_title` | 最後の`customTitle`。人かhookが付けた題 |
| `ai_title` | 最後の`aiTitle`。会話から生成された題 |
| `session_name` | `custom_title`、無ければ`ai_title` |
| `task_id` | `custom_title`が`#<数字>`で始まる時、その数字 |
| `project` | `cwd`のbasename |
| `cwd` | transcriptの**最初の**`cwd` |

**`session_name`は単純な合成であって、画面に出す文字列とは限らない。**
`custom_title`が`#102`のように本文を持たない時、表示側は`ai_title`を副題として
足す。**「表示名」の答えが2つあることになるので、片方を変える時はもう片方を見る。**

**空のlabelは書かない。**Prometheusは空値と欠損を同じに読む。`foo=""`と書くと、
題が付いた最初の1回で系列が入れ替わったように見える。

**`cwd`は最初の値を採る。**sessionは作業の途中でworktreeや下位directoryへ移る。
実測で53本中17本が2つ以上の`cwd`を持ち、最も多いもので11あった。最後の値は
たまたま最後に居た場所でしかない。最初の値は起動したdirectoryで、
`~/.claude/projects`のdirectory名が指すものと同じである (53本すべてで一致)。

**`task_id`は`custom_title`からだけ読む。**custom titleは人かhookが明示的に付けた
名前で、先頭の`#104`は参照としか読めない。`aiTitle`は会話から生成された散文で、
`#3 things to fix`のような偶然の一致はそこからしか来ない。**層を分けると誤爆の
入口が無くなる** (実測: `ai_title`を持つ44本で`^#<数字>`にマッチしたものは0件)。
区切りは空白または行末で、**空白を必須にはできない。**本文を持たない`#102`が
実測で6件ある。

**この規則が偽になる観測。** custom titleを`#3 things to fix`と付ければ
`task_id="3"`が付く。このlabelは題の先頭にある`#<数字>`を写したものであって、
そのidが存在することを意味しない。再測は
`gcx metrics query -d grafanacloud-prom 'claude_session_info'`のlabelと題の
突き合わせ。

**`git_branch`は出さない。**実測で53本中20本が2つ以上のbranchを持ち、最多は19
だった。最初のbranchは「始めた時のbranch」でしかなく、「作業したbranch」ではない。
**曖昧な主張をするlabelは置かない。**

**30日より古いtranscriptは出さない。**Prometheusの保持期間はそれよりずっと短く、
古いsessionがcostのqueryに現れることはない。一方でtranscriptは消えない
(`cleanupPeriodDays`の既定は36500) ため、上限を置かないと系列が増え続ける。

**走査cacheが実行時間を抑えている。**transcriptは追記しかされないので、`mtime`と
sizeが変わらなければ中身も同じである。手元の53本 (drvfs上186MB) を全部読むと
12.3秒、変わったものだけなら2.0秒で、後者の大半はinterpreterの起動である。
cacheを失っても、遅い実行が1回増えるだけで答えは変わらない。

**走査が立たなかった時は、既にある出力を置き換えない。**`Path.glob`は走査元が
無くても、通常のfileでも、読めなくても、例外を上げずに空を返す。emitterは
`iterdir`で開き、その 3 つを例外として受け取る。**読めなかったことと、1 つも
無かったことを混ぜない。**headerだけのfileを書くと、解決できていたsessionが
一斉に「不明」へ落ちる。**空だが読めるdirectoryは別で、出力を置き換える。**
publishするものが無いことは 1 つの答えである。

**出力にはconversation由来の題が入る。**usage helperが送るaccount labelと同じ
Prometheusへ届くので、collector fileとPrometheusの閲覧権限はアカウント情報として
扱う。

## 週の消費の内訳

`scripts/claude-cost/claude-cost-json`が、5Hと7Dそれぞれの窓のコストをsessionごとに
引いてJSON cacheへ書く。**両方を出すのは、panelの他のすべての段が2つのwindowを
並べて出すためである。**片方だけの段は、そこだけ別の問いに答えることになる。
widgetは`--cached-only`で読むだけで、既存の2つのhelperと同じ形である。読み出しは
`gcx`に任せ、HTTPとtokenの扱いを自前で持たない。

**窓はusage helperが報告するresetからwindow長だけ戻して求める。**5Hは
`current_session.resets_at`、7Dは`current_week.resets_at`である。読めない場合は
今からwindow長だけ戻した窓に落とし、**どちらで求めたかを`source`に残す。**同じ形の
数字が別の窓から来ていることは、後から見て分からない。

**既に過ぎたresetは、window単位で今の窓へ送る。**usage cacheがresetをまたいで
止まっていると、`resets_at`は読めるが前の窓のものになる。そのまま使うと窓が
window長より長くなり、**window長でない期間を「今の窓」として公開する。**
window長は`reset - 長さ`で既に前提にしているので、同じ前提で送り、`source`を
`usage_cache_rolled`にする。
**この規則が偽になる観測:** providerがwindow長を変えると窓は静かにずれる。
chipのcount downと`resets_at`が食い違う。**ここのwindow長は、既に複数箇所に
ある写しがもう1つ増えたものである。変更時は揃える。**

**同じ瞬間で評価するqueryは4種類ある。**コストの2本、名前を読む1本、
クォータのgaugeを読む1本である。`--time`でhelperが捕まえた時刻へ固定する。渡さないとgcxがサーバへ届いた時刻で
個別に評価するため、rangeの起点が窓の起点より後ろへずれる。名前の側を固定し
損ねると、その間に題が書き換わった時、**別の瞬間のlabelを別の瞬間のコストへ
付ける。**

### 窓の消費の求め方

```text
session ごとに:  sum(increase(cost[窓]))
               + sum(first_over_time(cost[窓]) unless (cost @ 窓の起点))
```

**`increase()`だけでは、系列ごとに最初のsample 1回分が落ちる。**counterはsession
開始時の暗黙の0から始まるが、Prometheusはその0を見ない。系列が窓の内側で始まると
外挿も効かないため、最初のexportがそのまま失われる。実測 (2026-09-13) で週合計の
9%、最悪のsessionで21%だった。

**窓の起点に在った系列には足し戻さない。**そこにある値は前の窓の残高であって、
この窓の消費ではない。

**`last_over_time()`では代えられない。**同じ`session_id`のままresumeすると
counterがリセットされ、リセット前の分が丸ごと落ちる (実測で5 sessionに発生)。

**この2本を1本のPromQLにまとめない。**`A + (B unless C)`は内部結合で、`unless`が
除いた系列を加算ごと落とす (実測$49.04→$4.46)。**窓をまたぐ系列が1つも無い週では
この誤りが再現しない。**`unless`が何も除かないためで、次の週次resetで初めて
本番に出る。足し算はhelper側で行う。

### クォータの按分

同じ窓のクォータ消費 (`claude_usage_used_percent`) を、sessionごとに割り振る。
**コストで代用できない。**実測 (2026-09-15、5Hの窓) で、最も金を使ったsessionは
上限の10.9%しか取っておらず、2位のsessionが26.9%を取っていた。$とtokenは互いに
一致して動き、クォータだけが両方から外れる。**窓全体で1つの`%/$`を使うと、
出るのはコスト列の定数倍で、順位も比率も変わらない。**

```text
境界 = 窓の起点(値0) / gaugeの読みが増加した各観測時刻 / 窓の中のresetの時刻 / now(値=measured)

各境界について、直前の境界からその境界までの増加量を、
同じ区間に各sessionが使ったコストの比率でsessionへ分配する
```

**バケットを固定幅にしない。境界は、gaugeの読みが増加した観測時刻に取る。**gaugeは
整数でしか報告されないので、5分の固定幅で区切ると「コストはあるが増加量0」のバケットが
生じる。実測で**窓のコストの35%**がそのバケットに入り、**配分にまったく反映されない。**
その増加は後続のバケットに整数で現れ、そのバケットで動いていたsessionが全量を受け取る。
増加した観測時刻を境界にすれば、窓の中のコストは必ずいずれかの増加量の分配に反映される。

**境界は1ptごとではない。**gaugeの書き込みは5分に1回なので、1つの境界が2pt以上を
まとめて運ぶ。実測 (7日・5Hの窓) で増加イベントは279件・合計495ptあり、**そのうち
304pt (61%) が2pt以上の増加**だった。**分配の分解能の上限はこの粒度である。**

**両端の値を固定する。**系列の先頭に`(窓の起点, 0)`を、末尾に`(now, measured)`を
追加する。追加しないと合計は「最初のサンプルから最後のサンプルまで」の増加量になり、
**窓の先頭と末尾の消費が合計から欠落する** (実測で5Hの窓は3のうち2、7Dの窓は25のうち1)。
**合計が実測と一致するのはこの2点を追加しているためであって、queryの精度に
よるものではない。**

**増分をPromQLで作らない。両側ともである。**gaugeは`delta`も`increase`も外挿する
ため、隣り合う差の合計が端点の差と一致しない。costは、系列がその区間の中で始まると
最初のexportが欠落する (counterが始まる暗黙の0をPrometheusが見ないため)。
`window_cost`が足し戻しているのと同じ欠けだが、**こちらで欠落するのは額ではなく
取り分なので、その区間に居た他のsessionへ分配される。**実測 (20h) で合計の11.6%、
sessionごとでは-14%〜+60%ずれた。どちらも生の値をrange queryで取得し、差はhelper側で
計算する。

**counterが下がったら、そこにある値がresume後の消費である。**同じ`session_id`の
ままresumeするとcounterがリセットされる (実測で週に5件)。

**窓の起点に在った系列の残高は、按分側では除外しなくてよい。**range queryの刻みは
`--from`ではなくstepの絶対境界に揃う (実測) ため、その初値は窓の起点かそれより前に
位置し、按分は起点より後の区間しか見ない。`window_cost`が`unless`で明示的に抑えて
いるのは、あちらが窓ぜんぶを1本のrangeで数えていて同じ逃げ道が無いためである。

**`max by (window)`で引き、instanceでは絞らない。**同じaccountの値を複数のhostが
報告している (実測で2台、24hの上昇は177.0で完全に一致)。1台を選ぶと、その台が
止まっていた間の増加量が丸ごと欠落する。

**range queryは12時間ずつに割る。****gcxはrangeの点数でstepを勝手に上げる。**
実測で300s stepが通るのは12hまで (145点)、18hを投げると600sに、7dを1発で投げると
900sになる。**上がったことは応答からは分からない。**7dぶんで28本になる。

**subqueryに載せない。**`(コストの取り分 * クォータの増分)[6h:5m]`以上は、
**エラーにならずに0を返す** (実測)。`[1h:5m]`なら正しく48を返し、片方ずつなら
`[24h:5m]`でも正しい。2つのmetricを掛けた式を長いsubqueryに載せた時だけ静かに壊れる。

**窓の外から来た読みだけしか無いなら按分しない。**`measured`も同じ15分の
lookbackで引いているため、resetの直後、gaugeの書き込みとscrapeが追いつくまでは
前の窓の値を返す。0に固定した起点との差が「窓の先頭で一気に消費した」形になり、
**reset直後に動いていたsessionへ前の窓ぶんが帰属する。下降が無いので、下の検出では
判定できない。**窓の中の読みが1つも無く、かつ`measured`が0でない時に止める。
まだ使っていないだけの窓は`measured`が0なので、空の按分がそのまま出る。

**窓の中のresetは足し戻す。**providerは不具合対応などで窓の途中に一括リセットを
かけることがある。**実測 (usage cacheのhistory 13日) で1つの週に3回起きており
(45→0、24→5、73→0)、その週の消費は最終値56%に対して199%だった。**捨てると、
resetより前に動いていたsessionが行から丸ごと消える。
**5Hでは13日・約105窓で1件も無く、7Dだけの現象である。**

**下降がresetかどうかは、落ちた先で見る。下げ幅では見ない。**gaugeは下方修正で
1ptだけ下がることがあり、それをresetと読むと残りの値がもう一度加算される (84→81を
resetと読むと165%になる)。**resetは0付近まで下がり、修正は直前の水準の近くで止まる。**
実測でreset後は0・0・5、修正は前の値の0.92〜0.99倍だった。
**下げ幅で測ると2種類が数ptしか離れず** (1・1・1 対 19・45・73)、閾値の1pt上の
修正がresetとして通る。
**この規則が偽になる観測:** 前の値の半分より下まで下がる下方修正、または半分以上で
止まるreset。

**その読みがどの窓のものかは、値ではなく`claude_usage_reset_timestamp_seconds`が
持つ。**resetの直後、lookbackと同じ長さのあいだ、窓の中の刻みで引いても返るのは
前の窓の値である (書き込みとscrapeが追いついていない)。**その値は、窓の頭の本物の
消費と同じ形をしていて値からは見分けられない。**読みを台ごとに自分のstampと組にし、
stampがこの窓のresetと一致する組だけを集約する。

**「起点より後ろか」ではなく「この窓のresetか」で判定する。**前の窓のresetは窓の
起点とほぼ同じ値なので、境目で区別する方式は、そのずれの大きさに依存する。厳密な
`> 起点`では**reset前の読みがすべて通り、5Hのカードがgauge 10に対し20を出した** —
前の窓の値が新しい窓の先頭に現れ、その下降がwindow内resetとして足し戻された。
**余裕を足して`> 起点+60`とする方式では、ずれが余裕を超えた日に同じ不具合が再発する
(警告は出ない)。**一致で判定すれば、ずれた日に残る読みは0件になり、**クォータは
出ないが、誤った値も出ない。**

`RESET_SKEW`は**報告されるresetのぶれ幅**である。resetは秒未満を持たないが、
**同じ窓のresetが複数の値で届く。**`samples.ndjson`13日ぶんで測ると、多くは
±1秒 (`1789948799`/`1789948800`/`1789948801`) だが、**最頻値より60秒早い報告が
混じる** — 7Dは3窓中2窓 (11回)、5Hは61窓中3窓 (4回) にあった。

**120にしてある。**上は、**前の窓のresetまでの距離から観測したぶれを引いた分**
より狭くなければならない。5Hなら`18000 - 60 = 17940`秒で、これを超えると
**前の窓のresetが遅れて報告された時に一致し**、直したlive バグへ戻る。
下は観測した60秒より広くなければならず、狭いと**ずれた回に読みが1件も残らず、
カードから`%`が消える。**120は両端の内側で、観測が13日ぶんしかないことへの
余裕を持たせた値である (**倍にする決まりがあるわけではない**)。

**この規則が偽になる観測:** 最頻値から120秒を超えて離れたresetの報告。数え直す:

```bash
python3 - <<'PY'
import collections, datetime as dt, json, os
rows = sorted((json.loads(l) for l in open(
    os.path.expanduser("~/.cache/claude-usage-json/samples.ndjson")) if l.strip()),
    key=lambda r: r["recorded_at"])
for key, length, label in (("session_resets_at", 5 * 3600, "5H"),
                           ("week_resets_at", 7 * 86400, "7D")):
    groups = []                       # 窓の長さの半分より近い報告を同じ窓とみなす
    for row in rows:
        if not row.get(key):
            continue
        stamp = int(dt.datetime.fromisoformat(row[key]).timestamp())
        for g in groups:
            if abs(g[0] - stamp) < length / 2:
                g[1].append(stamp)
                break
        else:
            groups.append((stamp, [stamp]))
    worst, hit = 0, 0
    for _, stamps in groups:
        mode = collections.Counter(stamps).most_common(1)[0][0]
        worst = max([worst] + [abs(s - mode) for s in stamps])
        hit += any(s != mode for s in stamps)
    print("%s: %d 窓、最頻値からのずれの最大 %d 秒、ぶれのあった窓 %d"
          % (label, len(groups), worst, hit))
PY
```

実行すると `5H: 61 窓、最頻値からのずれの最大 60 秒、ぶれのあった窓 47` /
`7D: 3 窓、... 60 秒、... 3` が出る。**この最大が120を超えたら`RESET_SKEW`を
見直す。**metricsの側のstampを直に見るなら:

```bash
gcx --context cron metrics query \
  'max by (window) (claude_usage_reset_timestamp_seconds)' \
  --from $(( $(date +%s) - 86400 )) --to $(date +%s) --step 300s -o json |
python3 -c '
import json, sys
seen = {}
for s in json.load(sys.stdin)["data"]["result"]:
    seen.setdefault(s["metric"]["window"], set()).update(
        int(float(v)) for _, v in s["values"])
for window, values in sorted(seen.items()):
    print("報告", window, sorted(values))'
python3 -c '
import datetime as dt, json, sys
p = json.load(sys.stdin)
for key in ("current_session", "current_week"):
    print("JSON", key,
          int(dt.datetime.fromisoformat(p[key]["resets_at"]).timestamp()))' \
  < "$HOME/.cache/claude-usage-json/usage.json"
```

**組にするのは台ごとである。queryごとではない。**値とstampを別々に`max`すると、
**stampは追いついた台から、値は追いついていない台から**来る。実測 (reset+60秒) で、
一方が`0 / 新しいstamp`、もう一方が`18 / 古いstamp`で、2つのmaxを合わせると18が
新しい窓の先頭の消費として計上される。

**resetは、0まで下がったかどうかに関わらず配分の境界にする。**resetの後に在る値は
resetから後に積んだ分なので、reset前のコストで分配すると、reset前に終わっていた
sessionへreset後のクォータが帰属する。0まで下がったresetは増加を記録せず、0でない
resetは記録する (実測の`24→5`) ので、**片方だけを見る書き方では後者が漏れる。**

**reset自身の5分の刻みに含まれるコストは、判定できる側へ残す。**resetはその刻みの
どこかで起きており、同じ刻みのコストがreset前か後かは判別できない。両側から除外すると
行から消え、**記録されている消費について画面が「No spend recorded」と表示する。**
境界を1刻み手前に置き、判別できない1刻みはreset後の増加量へ含める。

**accountは1つを前提にしている。cost側のqueryも同じである。**どちらも
`user_account_uuid`で絞っていないため、2 account分が入ったdatasourceでは、
片方のgaugeをもう片方のコストにも配ることになる。
**この規則が偽になる観測:** `count(count by (user_account_uuid) (claude_usage_used_percent))`
が2以上になる (実測では両metricとも、保持期間の20日いっぱいで1)。

**起点がresetでない窓では按分しない。**按分は「窓の起点で0だった」ことを前提に
している。resetを1つも読めず今からwindow長だけ戻しただけの窓 (`source`が
`fallback_length`) は起点がresetではなく、そこにあった残高が起点直後の増加として
現れて、**その時に動いていたsessionへ最大で窓ぜんぶが帰属する。**cost側は窓の決め方が
多少ずれても額がずれるだけなので、そちらは出す。

**クォータが引けないことをcost全体の失敗にしない。**按分に要るrange queryは、
満了した7Dの窓で**28本** (gaugeを12時間ずつで14本、同じ刻みのコストで14本)。
一方**cost列そのものは窓あたりinstant query 2本** (`increase`と`first_over_time`) と、
名前を引く1本だけである。ここの失敗でcacheごと前回の内容へフォールバックすると、
**28本ある側の失敗率が、3本しかない側の鮮度を決める。**`quota`を`null`にして
cost列だけを出す。

#### どこまで信じてよいか

**合計は一致する。**行 + `unresolved` + `unattributed` = `quota.total`で、実測で
両窓とも誤差0である。

**`total`と`used_percent`は別物である。**前者はこの窓で実際に使った量、後者は
gaugeの現在値 (chipが出している数字) で、窓の中でresetが起きた窓では前者が
大きくなり100%を超える。

**下方修正でも、その幅だけ離れる。**修正の前の上昇は既に数えてあり、返さない。
**1つの窓に何度も入るので、差は1ptに留まらない。**返すには、既に付けたsessionから
その1ptを引く必要があるが、**どのsessionの上昇が修正されたのかは分からない。**
引く相手を決められない以上、機構を足しても恣意的な配り直しにしかならない。

**下方修正は取得側の産物ではない。**`max by (window)`は、高い値を報告していた台が
欠測すると残った台の低い値へ落ちるので、下降がscrapeの穴でも起こりうる。
**そうではないことを、`samples.ndjson`と突き合わせて確かめた。**これはusage helperが
APIから直に書いた1本の系列で、台ごとのmaxもscrapeも挟まっていない。Prometheus側で
見えた3件の下降 (`34→33`、`39→38`、`39→38`) は、**時刻まで含めてこちらにも在った。**

**どれくらい乖離するかをバックテストした** (`samples.ndjson`、09-05〜09-17)。
被覆9割以上の完了窓で見る。

| 窓 | 完了窓 | 乖離のあった窓 | 最大 | 中央値 |
| --- | --- | --- | --- | --- |
| 5H | 59 | 1 (2%) | +1pt (消費の1%) | +0pt |
| 7D | 1 | 1 | +2pt (消費の2%) | +2pt |

**5Hではほぼ起きない。7Dは完了窓が1つしか無く、判断の材料になっていない。**
進行中の窓は被覆46%の時点で既に+3pt (消費の6%) で、**窓が長いほど修正を拾う機会が
増えるため、7Dの方が大きく出る。**
**この規則が偽になる観測:** 1ptより大きい下方修正 (これまでの実測はすべて1pt)、
または7Dの完了窓で差が消費の1割を超えること。再測する:

```bash
python3 - <<'PY'
import datetime as dt, json, os
rows = sorted((json.loads(l) for l in open(
    os.path.expanduser("~/.cache/claude-usage-json/samples.ndjson")) if l.strip()),
    key=lambda r: r["recorded_at"])
keys, windows = set(), {}
for row in rows:                      # resetは前後1秒ぶれるので寄せる
    stamp = int(dt.datetime.fromisoformat(row["week_resets_at"]).timestamp())
    key = next((k for k in keys if abs(k - stamp) <= 2), None)
    if key is None:
        keys.add(stamp); key = stamp
    windows.setdefault(key, []).append((row["recorded_at"], float(row["week_used_percent"])))
for key in sorted(windows):
    s = sorted(windows[key]); total = s[0][1]; rev = []
    for (_, b), (m, a) in zip(s, s[1:]):
        if a > b: total += a - b
        elif a * 2 < b: total += a
        elif a < b: rev.append((m, b, a))
    print("%s total %3.0f gauge %3.0f 差 %+3.0f 下方修正 %d件 被覆 %3.0f%%" % (
        dt.datetime.fromtimestamp(key).strftime("%m-%d"), total, s[-1][1],
        total - s[-1][1], len(rev), min((s[-1][0]-s[0][0])/604800, 1) * 100))
PY
```

窓ごとの一致 (行の合計が`quota.total`になること) は別に確かめる:

```bash
CLAUDE_COST_GCX_CONTEXT=cron claude-cost-json --force | python3 -c '
import json, sys
for name, w in json.load(sys.stdin)["windows"].items():
    q = w.get("quota")
    if not q: print(name, "quota unavailable"); continue
    parts = sum(r["quota"] for r in w["sessions"]) + w["unresolved"].get("quota", 0)
    whole = parts + q["unattributed"]
    print("%s: %.2f vs total %.2f (gauge %.2f)"
          % (name, whole, q["total"], q["used_percent"]))'
```

**行ごとの値は近似である。**刻みを5分から15分へ動かすと、行の値は窓の合計の1割ほど
動く。**細かくしても収束しない** (60s→120sで21%、120s→300sで12%、300s→600sで7%)。
24hでクォータの上昇イベントは69件しか無く、細かい刻みは1件の上昇をその1分に
動いていたsessionへ丸ごと付けるだけになる。

**帰属の向きは確かめてある。**60秒刻みの生データで1 sessionだけが走った区間を
抽出すると、10分以上続いた区間は5〜15分の刻みで90〜100%がそのsessionへ帰属する。5分未満の区間は
当たらない (区間が刻みより短く、分離できない)。時刻合わせも、クォータを1バケット
ずらすと24hで24〜29ポイントがコストの無い区間へ移り、配分が20〜24%動く。
ずらさなければ0である。

**$/クォータの比まで信じてはいけない。**modelの違いで説明が付くのは一部である
(Fable主体のsessionは$1.83/pt、Opus勢は$2.5〜6.4/pt)。tokenの量も内訳もほぼ同じで
金額も近い2つのsessionが、クォータでは2.3倍違う例があり、**その残りが本物か
按分の誤差かは、手元のデータでは区別できない。**整数丸め (目盛り境界に替えても
行は最大2.3ポイントしか動かない) と時刻ずれ (±5分が最適、±10分で悪化) は潰した。

**`unattributed`と`unresolved`は別のものである。**`unresolved`は「コストは分かるが
名前が付かないsession」で、`unattributed`は「上昇した区間にコストが1件も無く、
どのsessionにも帰属できないクォータ」である。前者は別マシンでemitterを動かせば消え、
後者は消えない。**どちらも行として出す。**出さないと、画面に出ていない行が1つ
あることが、どこにも現れない。**一致するのはcacheの中の値である。**画面は行ごとに
1桁へ丸めるので、見えている数字の合計は見えている見出しと一致しないことがある。

### 出力

```json
{"generated_at":"…","currency":"USD",
 "windows":{
   "session":{"starts_at":"…","resets_at":"…","source":"usage_cache","total":21.12,
              "sessions":[…],"unresolved":{…},"quota":{…}},
   "week":{"starts_at":"…","resets_at":"…","source":"usage_cache","total":1246.03,
           "sessions":[{"session_name":"#46","custom_title":"#46",
                        "ai_title":"ツール仕様まとめ","task_id":"46","project":"…",
                        "session_id":"…","cost":123.92,"quota":8.64}],
           "unresolved":{"cost":451.61,"sessions":11,"quota":3.2},
           "quota":{"used_percent":25.0,"total":25.0,"unattributed":1.0}}}}
```

**emitterが出すlabelはすべて写す。**読む側がどれでも絞り込めるようにするため。
**scrapeが付けるlabel (`agent_hostname` `instance` `job`) は写さない。**sessionの
属性ではなく収集側の設定で変わるもので、設定が変われば黙って消える。

**消費のあったsessionはすべて行にする。上限を置かない。**行を切ると、切った分が
`total`にだけ残って内訳と突き合わせられず、読む側がlabelで絞った画面も黙って
少なく出る。**要求が定まっていない利用者のために、不完全なcacheを作らない。**
抑えるべき増え方も無い。窓に入るsession数は現実の側で頭打ちで、実測ではPrometheusが
保持する20日いっぱいでも29件だった。

**消費が厳密に0のsessionは行にしない。閾値では落とさない。**窓の中に居ただけで
使っていないsessionがあり、実測で5H窓の10系列中7件がこれだった。`increase()`は
それを厳密に0として返す。**$0.004も消費である。**閾値で落とすと、その額が`total`から
消えるか、消えないなら内訳と合わなくなる。実測でも、0と$0.005の間の値はどの窓にも
1件も無かった。

**行と`unresolved`の合計が`total`である。**`total`は報告する値から
積むので、数えた額が内訳から欠けることはない。

**金額を丸めない。**何桁を見せるかは読む側の判断である。ここで丸めると、行ごとに
丸めた値と別に丸めた合計が食い違い、上の1行に但し書きが要る (実際に一度足した)。
読む側が別の順で足し直せばdoubleの最下位桁は動きうるが、それは浮動小数の性質で
あって、この出力の性質ではなく、表示する桁のはるか下である。`total`は報告する値から
積むので、数えた額が内訳から欠けることはない。

**`unresolved`は「`claude_session_info`の系列が1本も無いsession」である。**別マシンから
送られたsessionと、transcriptを消した後のsessionが該当する。落とすと行の合計が
totalに合わなくなるため、まとめて数える。**題を持たないことではない。**titleがまだ
付いていないsessionもinfoは持ち、`project`が入る。projectの分かる行は「不明」より
情報があるので、行として出す。

**表示名は上から順に採る。**`custom_title` (本文を持たなければ`ai_title`を副題に
足す) → `ai_title` → `project` → `session_id`の先頭。**最後の1つは飾りではない。**
emitterは`session_id`以外のlabelを任意にしているため、cwdが`/`のsessionのように
1つもlabelを持たない行が来る。既知のsessionなので行として出し、`session_id`の
先頭で示す。

**表示名はここで組み立てない。**`session_name`は2つの題の単純な合成で、`#102`の
ように本文を持たない題は`ai_title`を副題として足した方が読める。それは読む側の
判断なので、両方の題をそのまま渡す。

**同じ`session_id`に`claude_session_info`が2本来たら、名前を付けない。**どちらが
正かを決める情報が無く、あるsessionを別のsessionの名前で出すより、「不明」に
送る方が軽い。

**resetがoffsetを持たなければ、読めない値として扱う。**offsetの無い日時もparseは
できるが、awareな現在時刻と比べた瞬間にTypeErrorになり、**cacheを読めなかった時の
退避経路を通らずに実行ごと落ちる。**窓の側のfallbackに載せる。

**有限でない値は読めなかった値として扱う。**Prometheusは`"NaN"`を返すことがあり、
`float()`はそれを受ける。通すと`json.dumps`が裸の`NaN`を書き、**前の正しいcacheを
置き換えたcacheがJSONでなくなる。**widgetのparserはfileごと拒むので、クォータだけで
なくコスト列も消える (下の退避経路を通らない)。parserで弾いて下の経路へ送り、
書き出しの`allow_nan=False`を最後の砦にする (有限どうしの足し算は溢れうる)。
**どちらも「引けなかった時」と同じ経路で降りる。**traceback で終わるとcacheは残るが、
前回のcacheを出し直す経路を通らず、cronのlogには文ではなく例外が残る。

**応答の形は、`CostError`以外で抜けるものを1つも残さない。**`main`も`quota_for`も
それ以外を捕まえないため、`TypeError`や`AttributeError`は**前回のcacheを出し直す
経路を素通りしてtracebackで終わる。**レビュー3巡で3件 (label setを警告なく除外する /
objectの所にscalar / listの所に`null`) 続けて出たので、envelope・list・各項目の
`metric`を、**値を読む前に1か所で**確かめる。

**閉じ方は列挙であって、例外をまとめて変えることではない。**JSONの値は6通りしか
無いので組み合わせを並べてテストできる (162通り)。まとめて`CostError`へ変える形は、
parser自身の誤りや`MemoryError`まで区別なくCostErrorにする。しかも**quota側は失敗を
無視し、cost側はcacheごと前回へフォールバックするので、同じ誤りが「古いcache」と
「クォータの無い新しいcache」のどちらにもなる。**どちらも更新が成功したように見える。

**その列挙が示すのは「`CostError`以外で抜けない」ことだけである。**例外を出さずに
通った形は正しいものとして数えており、**壊れた形が「読めてしまう」側は見ていない。**
実際に1つ抜けていた: `[時刻, 値]`の組の所にstrが来ると、strも添字と展開が通るため、
`"1789416600"`が例外なしに**`7.0`というgaugeの読みになる。**組の他の壊れ方
(dict、None、長さ1、3要素) はすべて`CostError`になりクォータが出ない、という画面から
見える失敗になる。**strだけが「読めなかった」ではなく「別の答え」という結果になり、
捏造した数字で新しいcacheを公開する。**組はlistであって長さ2であることを要求する。

**長さも見る。**見ないと`[1, 2, 3]`はmatrixでは`CostError`、vectorでは添字1が
読めるので通る。**同じ応答が、当たったqueryの種類で「古いcacheへフォールバックする」
と「新しいcacheを公開する」に分かれる。**catch-allを外した理由と同じ形である。
**この規則が偽になる観測:** Prometheusが`[時刻, 値]`以外の形でsampleを返すこと
(現状の応答は保持期間ぶんすべて2要素)。再測は上の再測コマンドで
`quota unavailable`が出ないことの確認。

**壊れたcacheは、出す時に検査しない。**書ける経路が無い — 唯一書く所の手前に
`allow_nan=False`が在るので、「cacheはJSONである」は書く側で保たれている。
読むたびに (widgetが毎分呼ぶ`--cached-only`も含めて) 検査するのは、書く側が
既に守っている約束を測り直すことになる。

**値を読まない問い合わせに、値が読めることを要求しない。**`claude_session_info`は
常に1を出し、読む側はlabelしか見ない。ここで`NaN`を拒むと、**名前を引く1本の失敗が
その回のコストごと落とす。**label setだけを返すparserを使い、応答の形の検査は同じに保つ。

**引けなかった時は前回のcacheをそのまま返す。**`generated_at`が動かないので、
widgetのstale判定がそのまま効く。半分だけの答えは公開しない。

**失敗の理由は`gcx`のstdoutから採る。**gcxは失敗の詳細をstdoutへ書き、stderrは
空のまま終了する。stderrだけを見ると、cronのlogに残るのは終了コードだけになる。

**生応答は残さない。**usage helperが残すのは、歪んだreadingが数日後に14日graphの
形として現れるためである。この出力は背後にhistoryを持たず、誤った数字は次の更新で
消える。

## ファイル配置

### Widget

- `widgets/main/src/components/aiUsage/`
  - Claude/Codexの配置、時刻更新、stale判定・表示を共有する。
  - `panel.ts`が統合パネルの起動を持つ。どちらのchipもここを呼ぶため、
    開く先とその大きさが2つに分かれない。
- `widgets/main/src/components/claudeUsage/`
  - Claude JSONの検証、取得、main bar表示を担当する。
- `widgets/main/src/components/codexUsage/`
  - Codex JSONの検証、取得、表示を担当する。
- **読み取り側が契約を担保し、下流はそれを再検証しない。**`isUsagePeriod` /
  `isUsageWindow`が型と有限性を見て、満たさないpayloadはそこで落ちる。したがって
  使用率やwindow長がNaNのまま計算へ届くことはなく、**下流にそれを想定した防御を
  置かない。**置いても本番の入力では到達せず、その分岐を支えられるのは
  到達するよう仕込んだテストだけになる。
  - 契約を緩める (新しいfieldを検証せずに通す等) なら、緩めた側がその影響を
    引き受ける。下流を1つずつ固めて回るのは、規則だけが増えて担保は増えない。
- `widgets/ai-usage-details/`
  - どちらのchipをクリックしても開く統合パネル。左にClaude、右にCodexを置き、
    各blockが4段構成 (現在値・window内の推移・14日の推移・消費の内訳) を持つ。
  - `ClaudeSection.tsx` / `CodexSection.tsx`がprovider固有の読み替えを持ち、
    `SectionHeader.tsx` `UsageCard.tsx` `CostBreakdown.tsx` `usageStatus.ts`
    `panelLayout.ts`を共有する。
  - **コストはusageとは別に取得する。**経路がGrafanaで、usage helperが動いていても
    そちらだけ落ちることがあり、逆もある。片方が欠けてももう片方の段は残る。
  - window名と時間幅は、Codex側は`windowDurationMins`から動的に決める。
  - CPU/RAM詳細と同様、main bar直下へ配置し、focusを失うと閉じる。

### WSL helpers

- `scripts/claude-usage/`
  - Claude `/usage` の操作、解析、cache更新、cron例。
- `scripts/codex-usage/`
  - Codex app-serverのusage取得、cache更新、cron例。
- `scripts/claude-sessions/`
  - transcriptからの`claude_session_info`の生成、走査cache、cron例。
- `scripts/claude-cost/`
  - `gcx`経由での週の消費の取得、JSON cache更新、cron例。

## 表示仕様

**語は1つの意味だけを持たせる。**このpanelでは2つが衝突しやすい。

| 語 | 指すもの |
| --- | --- |
| **window** / `5H` / `7D` | quotaの窓。`[14D] 5H Usage Peak per Window`のWindowもこれ |
| **session** | Claude Codeの会話1本。`session_id`、`session_name`、costの各行、`Unresolved (n)` |
| **unresolved** | 名前の付かないsession。コストは分かっている。別マシンでemitterを動かせば消える |
| **unattributed** | どのsessionにも帰属できないクォータ。増加した区間にコストが1件も無い。名前を付けても消えない |

**Claudeの`/usage`はquotaの窓を`Current session`と呼ぶが、その語はここでは使わない。**
このツールの`session`は会話1本であり、**同じ語が2つの意味を持つとcostの段で破綻する** —
「session別のcost」を並べたcardに「sessionのcost」という見出しが載る。providerの語彙より
自分の語彙を優先する。

**見出しはTitle Case、副題と本文と失敗時の文言はsentence case。**見出しは名前で、
本文は文である。

**見出しの`[5H]` `[7D]` `[14D]`はそのgraphの横軸の幅で、同じ見出しの中に現れるwindowの
長さとは別物である。**`[14D] 7D Usage Trend and Daily Usage`は「14日ぶんのgraphに7Dの
windowの推移を描く」と読む。

**副題はplan名であり、無い時は出さない。**Codexは`rate_limits.planType`を出す。
Claudeのusageには相当する項目が無いので、**何も出さない。**固定文字列を置くと、
titleとcardが既に言っていることの言い換えが常設される。

main widget右側の順序は次のとおり。

```text
StatProviders（CPU/RAMなど） → Claude usage → Codex usage → Volumeなど
```

共通仕様:

- 先頭のアイコンはNerd Fonts v3.5.1のCodicons (Claudeは`cod-claude`、Codexは
  `cod-openai`) で、[Cojica](https://github.com/ks-yuzu/Cojica)から出す。
  **chipと詳細viewの見出しの両方で同じ印を使う** (`ServiceIcon`、
  `packages/ui/src/components/icons/service.tsx`)。
  - **fontは同梱しない。**Windows側に導入済みであることが前提で、無い環境では
    豆腐になる。導入手順は[Releaseから導入する](./install-from-release.md)にある。
  - Geist Monoのように`public/`へ実体を置く道も取れるが、widgetごとに複製が
    増える。iconのためだけに12MBのfontを3つのwidgetへ置くのは釣り合わない。
  - lucideの`Bot` / `Code2`から置き換えた。ロボットとコードの一般記号であって、
    2つ並んだときにどちらのproviderかは隣の数値を読まないと分からなかった。
  - **大きさは呼び出し側が決める。**chipは`text-lg` (14px、既定)、詳細viewの
    見出しは`text-xl` (16px)。置き換え前のlucideの`h-3.5` / `h-4`に合わせている。
  - **`label`を渡すのはchipだけ。**詳細viewの見出しは隣の`<h1>`がproviderを
    名乗るため、glyphはa11y treeから外す。lucideも同じ扱いだった。
- CPU/RAMと同じ`useInlineStats`設定を共有する。
  - ring設定: 割合を円形ゲージで表示する。
  - inline設定: 数値と`%`を表示する。
- usageの色は既存の`systemStatThresholds`を使う。
- **詳細はproviderごとのwidgetではなく、1枚の統合パネルである** (下記)。
  どちらのblockも3段構成とし、列をwindowに対応させる (短い順)。
  3段目は14日を横軸とし、windowの長さで見方を変える。
  Claude・Codexで扱いは同じである。
  - **1日未満のwindow**はwindowごとの到達点。1日に何度もresetするため、
    日へ畳むと複数のwindowが混ざる。
  - 集計単位を示す語 (見出しの`per window` / `per day`、凡例) は両providerで同じ語に
    する。providerごとの呼び分け (Claudeは5Hを"session"と呼ぶ) を持ち込むと、
    同じ集計を別物として読ませてしまう。呼び名は上段のcardに残る。
    **quotaを指す語はこの規則の外。**Claudeの7D列だけが週次を2つ持つため、
    そこでは`all models`とmodel名で呼び分ける (下記)。
  - **1日以上のwindow**は日次の消費量と累積。windowごとにすると14日で
    数本しか出ない。分母はその列のwindow自身のquotaで、横断的な基準は要らない。
- **報告されるresetは常にnowを含むwindowの終端である。到達の仕方はproviderで違う。**
  片方の観察をもう片方へ敷かないこと。以前この節は「rangeは利用開始時点で確定し、
  未使用の間resetは先送りされ続ける」を両者共通として書いていたが、**それはCodexにのみ
  当てはまる。**再測の手順は「windowの挙動を測り直す」に置く。
  - **Claude**: 固定された境界がカウントダウンし、境界を越える時だけ1 window分 (+5h)
    跳ぶ (変化54件中52件が+5.0h)。使用率0%のsample 996/996で
    `resets_at - 窓長 ≤ now ≤ resets_at`。**使用開始でresetは動かない**
    (0%→>0%の遷移45/45でdelta 0.00h)。**未使用のwindowも既に走っていて経過している。**
  - **Codex**: 未使用の間は`resetsAt = now + 窓長`へ滑り続ける (使用率0%のsample
    2029/2029で比0.999-1.000)。最初の使用でそこに固定される (19/19)。
    **未使用のwindowはnowに始まる。**
  - **これが偽になる観測**: 使用率0%のsampleで`resets_at - 窓長 > now`が出れば、
    「resetはnowを含むwindowの終端」は偽。Claudeで使用開始の前後に`resets_at`が動けば、
    「境界は固定」は偽。
  - **途中の値へ下がる遷移が皆無**である (Claude 0件/2607、Codex 0件/2583)。
    使用率は必ず「0 → 上昇 → 一気に0」しか通らない。rolling windowなら
    古い使用分から順に落ちるため、必ず途中の値を通る。
  - reset時刻が滑ることだけを見てrolling windowと誤判定した経緯がある。
    判別には減衰の有無を見る。**滑り方はproviderで違うので、判別の材料にしない。**
- trendの横軸は`resets_at`を終端とするそのwindowのrangeとする。**開始済みかどうかで
  分けない。**報告されたresetはnowを含むwindowの終端なので、Claudeの未使用windowでは
  経過中のwindowが、Codexの未使用windowではnowに始まるwindowが軸になり、
  どちらもcardが出すreset時刻と一致する。
  - **`resets_at`が読めない時だけ直近のwindow長へ退避する。**錨が無いことと、
    まだ使われていないことは別である。pace guideもこの時だけ出さない。
  - **sampleは時間範囲ではなく、そのwindowのものを選ぶ。**終端が一致するsampleを採る。
    範囲で選ぶと、前のwindowの登りが同じ枠に入る。
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
- **graphの系列色はテーマではなくパレットから採る** (`packages/ui/src/utils/seriesColors.ts`)。
  Grafanaのclassicパレット (v12.0.2) をそのまま持つ。
  - 系列0 `#7EB26D` — そのgraphが主題とする量。
  - 系列1 `#EAB839` (semi-dark-yellow) — **model別の週次。**同じ軸に載る別のquota。
  - 系列16 `#B7DBAB` — 主題と同じ量を2つ目の形で線で見せる時。
  - **棒はパレットから採らず、従来のテーマ色 (`--success` / `--primary`) のまま。**
    同じ値でも棒は線よりinkが多く主張が強い。日次の棒はその上の線を読むための
    文脈であって、cardが主題とする読み取りではない。
  - **テーマトークンを系列色に使わない。**`--success`や`--warning`は状態を表す語で、
    `--warning`はcardの閾値色 (70-85%) と`FreshnessIndicator`も使う。系列色に流用すると
    **同じ画面で3つの意味を持ち、**graphの凡例が教える対応とcard上の数字の色が
    食い違う。系列は状態ではないので、別の出所から採る。
  - card内のprogress barと数字は引き続き閾値色を使う。こちらは状態である。
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
- **未使用のwindowでも軸はreset時刻に合わせる。**以前は「未開始なら直近の時間帯」へ
  退避し、reset直後の1読み取りだけを例外にしていた (`hasJustReset`と15分の規定)。
  退避の根拠は「未使用の間resetは滑り続けるため軸がほぼ未来になる」だったが、
  **Claudeでは偽である** (上記の計測)。退避が無ければ例外も要らない。
  - 退避していた間は、**軸が時間範囲・系列がwindow部分集合**という食い違いが出ていた。
    軸の左側が「前のwindowで実際に使っていた時間帯」を指すのに線が無く、
    使用が始まる瞬間に軸が過去1窓から未来1窓へ全幅で反転していた。
- **panelの見出しは`[<軸の時間幅>] <系列の意味>`とする。** 「14D 5H peaks」は範囲
  (14D) とquota幅 (5H) を区切り無しに並べており、どちらがどちらの修飾か読めなかった。
  - 2段目: `[5H] usage trend`、`[7D] usage trend`
  - 3段目: `[14D] 5H usage peak per window`、`[14D] 7D usage trend and daily usage`
  - **軸幅とquotaが一致する段ではquotaを省く。** 2段目は軸そのものがquotaのwindow
    なので、`[5H] 5H usage trend`とはしない。
  - 3段目右が両系列を並記するのは、線が2段目と同じ累積のusageだからである。1語で
    まとめると、trendも累積である以上、両者を分ける語にならない。
  - 見出しの右にはsample数だけを置く。集計単位 (`per window` / `per day`) は見出しが
    持ち、範囲は角括弧が持つ。
- **panel下部の中央は、両段とも凡例にする。** 同じ位置に同じ種類のものが入ることが、
  列として読める条件である。
  - 5Hの段は系列が1つなので`usage`。
  - **7Dの段は週次のquotaが2つ並ぶため、`all models`とmodel名で呼び分ける。**
    集計の仕方 (増分か累積か) より、**どちらのquotaか**が読み分けるべき軸になる。
    3段目右も同じ理由で`daily`と`all models`とし、model名を足す。
  - **この呼び分けはClaudeの7D列だけに適用する。**Codex側は週次が1つなので
    `cumulative`のままである。集計単位を示す語を両providerで揃える規則 (上記) は
    集計の呼び名についてのもので、**どのquotaかを指す語はその外側にある。**
- **2つのgraphは縦の幾何を共有する** (`packages/ui/src/utils/chartGeometry.ts`)。
  同じ列に縦に並ぶため、同じ100%が同じ高さで描かれないと傾きや高さを比べられない。
  panelの高さ、plot上下の余白、左右のinset、既定のviewBox幅を共有する。高さだけ
  揃えても、余白が違えば帯がその差だけずれる。左右のinsetが違えばplot矩形が縦に
  揃わない。既定幅が違うと、片方でpropを省いた時に無言で別の幾何になる。
- **軸の造作も揃える。** 破線グリッドと%ラベル、下端の実線baselineを両方が持つ。
  片方にラベルとbaselineが無いと、同じ尺度でも別種のgraphに見える。
- window開始時の0%からreset時刻の100%まで破線を引き、期間全体で線形消費した
  場合のpace guideとする。実績線が上なら速い消費、下なら遅い消費を示す。
- **今のpaceが続いた場合の予測を、card下端の1行とwindow内graphの破線で示す。**
  同じ`usageProjection`の1回の呼び出しが両方へ渡るため、**graphが100%を横切る
  時刻とcardが述べる時刻は同じものになる。**以下、paceと出さない条件は両者に共通で、
  残りはcardとgraphで別に持つ。
  - **paceの出し方 (共通)**
    - **windowの直近1/7の実測消費から出す** (`windowPace` / `PACE_FRAME_DIVISOR`)。
      7Dなら直近24時間、5Hなら直近約43分。**windowの長さによらず出し方は変えない。**
    - **chipの`projectWindowUsage` (window全体の平均) とは別の定義である。**
      これは意図した差で、1本のbarしか持たないchipはwindow全体で均すのが妥当であり、
      直近と過去を描き分けられるgraphはそうではない。**したがって「cardが枯渇時刻を
      述べる」ことと「chipの塗りが100%を超える」ことは同値ではない。**
    - **測る枠はresetを跨いでよい。**paceは仕事の性質であって、その消費がどのquotaに
      付け替えられたかとは別である。windowへ切り詰めると、resetの直後は数分の履歴から
      外挿することになる。
    - 消費量の数え方は日別棒と同じ`consumedOver`による。**上げ幅だけを数え、window内で
      開いた最初のreadingは全量を数える。**下げはquotaが配り直された分であり、
      使った分ではない。
  - **出さない条件 (共通)**
    - **枠は両端が覆われていなければならない** (`MISSING_SAMPLES_SECONDS`)。
      覆われていなければ、静かだった枠と収集が届いていない枠を区別できない。
      外れた予測は無表示より害が大きい。
      - **開始側**: 単に「開始より前」では足りない。収集の途切れが開始をまたぐと、
        1つの上げ幅が開始の両側にまたがり、**どちらで起きたかはsampleからは分からない。**
        そのまま数えると、1週間ぶんの作業が直近1日に計上される。
      - **終端側**: 数時間前で収集が止まっていても合計は枠全体で割られ、その答えは
        `now`から残りを測る側へ渡る。**古い消費を現在の時間に当てる**ことになる。
    - **枠の内側の途切れは同じ問題ではない。**その上げ幅がいつ起きたにせよ、
      枠の中で起きている。枠全体の合計としては正しいので、拒否しない。
      実測では15分超の途切れは1日に0〜1回あり、内側まで拒否すると予測が定期的に消える。
    - **使用率0%のwindowにも出す。**枠は「時間の区間」であって「windowの一部」では
      ないため、resetを跨いで直近の作業を読む。**「直近の作業ペースが続けば新しい
      windowをこれだけ消費する」**が、この予測が見せたいものである。
      - 枠が前のwindowに届いている間 (5Hなら43分、7Dなら1日) は、その作業を
        引き継いだ値になる。**枠から抜ければ自走して0へ落ち**、`100% left at reset`
        に変わる。出し続けるための規則は要らない。
      - 以前は`windowStarted`で未開始のwindowを黙らせていた。理由は2つあり、
        **「軸がwindowでないため予測点が軸外に出る」は軸の統一で消えた。**残る
        「使用率0%でも前のwindowの消費から述べうる」は、上記のとおり**塞ぐべき
        経路ではなく見せたいもの**だった。`hasJustReset`と15分の規定も、これに
        伴って不要になった (reset直後だけ特別扱いする必要が無い)。
      - **resetが読めないwindowには出さない。**`resets_at`が無い読み取りは`NaN`で
        ここへ届き、`NaN% left at reset`として表示される。軸が錨を要求するのと
        同じ条件である。
    - **使い切ったwindow (100%) には出さない。**運ぶpaceが無く、cardは大きな数字と
      閾値色で既にそれを言っており、graphも上端で描画を止めている。
      **ここで答えようとして2度失敗した。**どちらも「尽きているか」の判定が背後の
      履歴に依存する形になっており、quotaが尽きたと告げる読み取りが履歴に依存する
      理由は無い。
  - **cardの行**
    - 100%へ達するなら`Runs out MM/DD HH:mm`、達しないなら`N% left at reset`。
      行を消さずに意味を切り替える。消すと、欠損なのか余裕があるのか読めない。
    - **1日未満のwindowは文言を相対にする** (`RELATIVE_WINDOW_SECONDS`)。
      resetを残り時間で数えているcardが枯渇だけ日付で言うと、2つの時計に読める。
    - **`Runs out`の側だけを強調する。**アイコン用の18pxへ警告アイコンを描き、
      行に色を付ける。`N% left at reset`はmutedのままとし、アイコンの有無と色の
      2点で区別する。2行が同じ書式で並ぶと、枯渇を述べる行が常に出ているreset行と
      区別できない。その場合、cardが出す警告は大きな数字の閾値色だけになり、
      これは**現在の使用率**を入力とするため、予測が枯渇を述べていても現在値が
      閾値未満なら強調は何も出ない。
    - **色は`thresholds`から決める。**`getThresholdColor(100, thresholds)`を使う。
      この行が述べているのはwindowが100%へ達することなので、色を決める入力も100とする。
      chipの`ProjectionFill`も同じ`thresholds`を`getThresholdColor`へ渡しており、
      **予測だからという理由で1段弱めることはしない。**`thresholds`は
      `useWidgetSetting('main', 'systemStatThresholds')`で読むユーザー設定であり、
      ここを`--danger`で固定すると、設定を変えた利用者の画面でcardとchipが異なる色を
      出す。既定の設定では`--danger`になる。
      - **この規則が偽になる観測**: `Runs out`を出しているcardの2行目の色tokenが、
        同じ`thresholds`で`getThresholdColor(100, thresholds)`を評価した結果と
        一致しない。
      - 再測: `usageProjection`が`exhausts: true`を返す状態を作り、2行目の`color`を
        読む。色の実値はテーマごとに異なる
        (`packages/config/src/defaults/theme-presets.ts`) ため、token名で比べる。
      - **fillの`--text`→`--success`の置換はしない。**`ProjectionFill`がこれを行うのは
        背景の塗りだからで、文字色では`--text`がそのまま「強調しない」を表す。
        cardの大きな数字も`getThresholdColor`の結果をそのまま文字色に使い、
        置換するのはProgressのindicatorだけである。
      - 85〜100%で終わる予測に`--warning`を出す拡張は、この規則の上で書けるが
        **今は実装していない。**cardが今答えているのは、枯渇するかどうかだけである。
    - **概算である旨の記号は付けない。**予測であることは文脈から明らかで、
      記号は丸め誤差しか表せない。この値の不確かさは丸めではなくpaceにある。
    - **出さない場合も行の領域は確保する。**cardの下端は`mt-auto`で押し下げており、
      2行目を落とすとreset行がそのぶん下がって、段の中でreset行が揃わなくなる。
      高さと行送りは同じ段 (12px) を明示する。`1lh`は単位を解さないwebviewで
      宣言ごと落ち、確保したはずの行が無くなる。
    - **アイコンを描かない時も、その18pxを空けたままにする。**`w-3` (12px) と
      `gap-1.5` (6px) で文字の開始位置は左端から18pxとなり、reset行の`Clock3`の
      後ろと一致する。この領域を削ると、2つの文言で文字の開始位置が変わる。
  - **graphの破線**
    - 最後の実測点から伸ばし、100%に達する点で止める。上端を横に走らせると
      「その水準を保つ」という別の意味に読める。
    - **100%との交点に印は置かない。**線が上端で止まること自体が交点を示す。
    - **model別のweekly windowにも引く。**chipがこれを`worstProjection`から
      除くのは、1本のbarではどちらのquotaを追っているか言えないためである。
      graphは2本を色で描き分けられるので、その制約は掛からない。
- Claude詳細は3段構成とし、**全段で左を5H、右を7Dに固定する。**
  現在値、window内の推移、14日の推移が同じ列に並び、列が期間を表す。
  - この配置のため幅は920px、高さは650pxとする (Claudeの詳細view)。
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
  - **ただし最初のsampleより前は「データなし」にしない。** retentionは14日遡るが
    収集がそこまで遡るとは限らず、収集前の区間は何かが記録に失敗した区間ではない。
    欠測として塗ると、収集期間が短い間は軸の大半が覆われ (実測で71%)、地の色と
    見分けがつかなくなるうえ、印が「ここでcronが止まった」を意味しなくなる。
  - 棒が1本も無い時は「No samples yet」を出す。上の規則により、収集開始直後は
    軸だけが残るため。
  - **この規則は「収集前」と「保持期間より古い停止」を区別しない。** cacheは14日で
    切り詰められるため、最古のsampleより前が未収集なのか、機械が止まっていたのかは
    cacheからは分からない。長期停止からの復帰直後は、止まっていた期間が印無しの軸
    として出る。生sampleの追記先 (`samples.ndjson`) には判別できる情報が残るが、
    widgetはそれを読まない。
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

model別の週次 (`current_week_model`) のmain barでの表示:

- **3つ目のringとして出す。**背景の`ProjectionFill`へは畳まない。あの1本は
  sessionとweekの予測の悪い方で、**同じ消費を別の窓で見た量どうし**なので畳んでよい。
  Fableは別の量なので、畳むと数字の意味が状況で変わる。
- **週次の2つは隣に置き、resetを1つ共有する。**両者のresetは同一である。間にreset
  文字列を挟むと並びが分断され、しかもその文字列はFable側でも同じ値になる重複である。
- **区切りの縦線はwindowの境目に置く。windowを共有するものは線の同じ側にまとめる。**
  Claudeなら`5H │ 7D Fable`、Codexなら`5H │ 7D`。**両providerで同じ規則**である。
  - 7DとFableの間には置かない。両者は同じwindowで、後ろのresetを共有している。
    そこへ線を置くと、共有resetがFableだけのものに見える。
  - クォータの違い (all models / model別) はlabelが持ち、線は持たない。
  - windowが1つしかない時は線も出さない。
- **ringのlabelを系列色で着色しない。**chip上は閾値色が働き、`--warning`が黄色である。
  labelを黄色にすると警告と競合する。graphとの対応はpanelを開いた時の凡例が担う。
- Fableのresetは出さない。7Dと同一なので直前の値の繰り返しになる。

model別の週次 (`current_week_model`) の詳細viewでの表示:

- **列を増やさず、7Dの列の3段すべてに重ねる。** all modelsとmodel別は**同じ軸**を
  共有する。resetも期間も同一で、利用者が知りたいのは片方をもう片方に対して読むこと
  である。列に分けると、軸の違い (5Hと7D) より系列の違いが目立ってしまう。
  - **1段目は右列を2段組みにし、model別に自分の数値と自分のbarを持たせる。**
    1本のbarで2つの数値を代表させると、より切迫している方にbarが無い状態が起こる。
    `used`ピルは両cardに残す (片方だけ消えると2枚並びで非対称になる)。
    `Resets`の行は`mt-auto`で下端へ寄せ、5H側の空きは下に出す。
    **panelの高さは1つの定数 (650px) とし、枠の有無で変えない。**2段目のぶんだけ
    1段目が高くなる (実測: 1段目が108 → 142px、内容が607 → 641px)。
    - **枠の有無で高さを変えてはいけない。**高さはbar側のqueryのsnapshotから決まる一方、
      2段目を描くかはpanel自身の別のqueryが決める。**別プロセスの2つの判断**なので
      食い違いを直せない。panelは60秒ごとに取り直すため、開いている間に枠が現れても
      windowの大きさは変えられない。
    - 枠が無いplanではfooterの下に約40pxの空きが出る。各sectionは`shrink-0`で
      伸びないため余りは下端へ落ちる。**この空きは高さを1つに保つ対価である。**
    - `zpack.json`のpresetも同じ650にする。**低い値でも切り詰めではなくscrollになる**
      (panel rootは`overflow-y-auto`)。揃えるのはscroll barを出さないためである。
    - 下端の位置に注意する。presetの`offsetY`は40pxなので、高さ690では下端が730pxに
      なり、**720pのディスプレイでは画面外**へ出る。rootは`h-screen`で
      `resizable: false`なので、はみ出した帯は辿れない。
  - 2段目はwindow内の推移に線を重ねる。
  - 3段目は累積の線を重ねる。棒 (日次) はall modelsのまま。
- **model別の系列は`--warning` (黄) で描く。**all modelsは`--success`のまま。
  色で系列を分ける。凡例の語は主系列を`all models`、副系列をmodel名とする
  (`cumulative`から改めた。2つの週次が並ぶ以上、集計の仕方より**どちらのquotaか**が
  読み分けるべき軸になる)。Codex側は系列が1つなので`cumulative`のままである。
- **model別の系列はwindowの同一性を問わず、時刻で絞って描く。**all modelsのwindowの
  軸に入るsampleをそのまま並べる。windowの識別 (`selectCurrentWindow`) は使わない。
  - 2つの週次はこれまでの全読み取りでresetが一致している (差0秒)。一致している限り、
    前windowのsampleは軸の外に落ちるため、時刻で絞るだけで現windowになる。
  - **一致を検査して分岐させる形は採らない。**ずれた時にどちらの`started`を採るか、
    どちらのrangeで絞るか、clipが何を隠すかという派生規則を次々に生み、
    レビュー3巡で同じ箇所が3度回帰した。**観測されていない状態のための機構**だった。
  - ずれた場合は前windowの読み取りが左端に少し混じる。前windowと現windowの区別は
    この面では重要でないと判断している。
- **model別の週次はresetが無くても数字も系列も出す。**時刻で絞る以上、window終端は
  要らない。`label`は必須で、これが無いと履歴を別modelと区別できず、凡例に出す名前も
  無い。
- **`UsageTrend`の面塗りは持たない。** 1つの系列の下を塗ると、軸を共有する系列が
  現れた瞬間に積み上げに見える。**ここは足し合わさらない。**2つの上限それぞれに
  対する割合であり、合計に意味が無い。**Claude・Codexとも積み上げではないため、
  providerを問わず塗らない。**系列が1つの段 (5H、Codexの各window) も揃える。

- **2つを1つの数字にまとめない。** all modelsは全modelの消費、model別はそのmodelだけの
  消費である。model別の上限に当たっても止まるのはそのmodelだけで、他は動く。
  大きい方を代表として出すと、数字の意味が状況で変わる。
- **枠が無い時はfieldごと省かれる。0%と区別する。** 現在値は併記そのものを出さず、
  線も描かない。planに枠が無いのは「使っていない」ことではない。
- **historyはlabelで区切る。** helperはlabelが変わっても系列を切らない (改名だけで
  14日分を捨てる方が損失が大きい)。区切りは`selectScopedSamples`が行う。

リセット表示:

- 24時間未満の枠は`2h 34m`のような残り時間にする。
- 24時間以上の枠は`08/24 09:00`のような日付・時刻にする。
- 残り時間はJSON更新と独立した1分timerで再計算する。
- Claudeのcurrent sessionは通常5H、current weekは通常7Dとして扱う。
- Codexは`windowDurationMins`から`5H`や`7D`を動的に作る。
- Codexの`primary`と`secondary`が両方ある場合は、短い期間から表示する。

### 統合パネル

**Claude詳細とCodex詳細は1枚のwidget (`ai-usage-details`、幅1700px・高さ854px) に
統合する。**chipは2つのままで、どちらをクリックしても同じパネルが開く。

- **統合の理由は、2つを並べて比べられないことにある。**詳細viewはfocusを失うと
  閉じるため、Claudeを開いた状態でCodexのchipを押すとClaude側が閉じる。
  「今どちらに余裕があるか」を読む操作が構造上存在しなかった。
- **開く位置はchipではなくbarの右端を基準にする。**パネルはchipから画面端までの
  余白より広く、chip基準で置くと画面左へはみ出す。加えて、押したchipで位置が
  変わるパネルは2枚に見える。
  - **幅はbarの幅で頭打ちにする。**1700pxは1366 / 1440のモニタより広く、click時の
    placementはpresetを上書きするため、上限が無いと左側のproviderが画面外に開いて
    手が届かない。グラフは自分のviewBoxを持つため縮んで収まる。
  - 判定にはmonitorのpixelではなく`document.documentElement.scrollWidth`を使う。
    barはmonitorいっぱいに広がっており、この値は幅やmarginと同じCSS pixelである。
    `outerSize`は物理pixelなので、拡大率が1でない環境で食い違う。
  - **縦の`offsetY`も同じくdocumentから取る** (`clientHeight`)。**規則は「この
    placementに物理pixelを混ぜない」であって、横だけの話ではない。**zebarは
    placementの`px`をmonitorのscale factorで掛けるため (`widget_factory.rs`の
    `to_px_scaled`)、物理pixelを渡すと拡大率が二重に掛かる。
    - barのrootは`h-screen`なので、documentのviewportはbarのwindowの高さである
    - **`scrollHeight`ではなく`clientHeight`を使う。**子が縦にはみ出すと
      `scrollHeight`はviewportを超える。欲しいのはbarのwindowの高さである
    - **偽になる観測は「拡大率の違うmonitorでパネルのyが揃わない」。**実測では
      拡大率1のmonitorで`y=40` (bar 34 + 隙間 6) に対し、1.25のmonitorで`y=48`と
      8px下へずれていた
    - 再測: zebarを再起動してchipを押し、`EnumWindows` + `GetWindowRect`で
      パネルの矩形を拾う。拡大率の違う2枚で`y`が一致すればよい
    - **`dockToEdge.windowMargin`はbarの高さではない。**zebarがwindowの「後ろ」に
      予約する量で、`enabled`がtrueの間しか読まない (`widget_factory.rs`)。
      ここはdockしないので`0px`を置く。**不活性な設定に動的な値を結ぶと、dockを
      有効にした時に検証していない規則が黙って効き始める**
  - **開くmonitorは、押したchipが乗っているbarのmonitorを名前で指す。**上限の元は
    呼び出し元のbarの幅であり、別のmonitorへ開くとその幅がそこの画面幅と合わない。
    monitorごとにbarが立つ (`zpack.json`のpresetが`monitorSelection: all`) ため、
    サブmonitorのchipもここを通る。
    - 名前は`@tauri-apps/api`の`currentMonitor()`から取る。zebar側の照合は
      `monitor.name.as_deref() == Some(name)`で、この`name`はtauriの
      `Monitor::name()`である。JS側の`currentMonitor().name`と出所が同じ。
      **偽になる観測は「chipを押してもパネルが1枚も開かない」。**照合に外れると
      `monitors_by_selection`が空を返し、開く対象が1つも無くなる
    - **`monitorSelection`に`index`は使わない。**zebarはmonitorを左から右・上から下へ
      並べ替えて保持しており、Tauriの`availableMonitors()`の順とは別である。
      ここで採った添字は別の画面を指しうる
    - **名前がnullの時はprimaryへ倒す。**Tauriは`name`をnullableで返す。照合する
      文字列が無いため、変更前と同じ挙動に戻す
    - 再測: `curl -sL https://raw.githubusercontent.com/glzr-io/zebar/v3.3.1/packages/desktop/src/monitor_state.rs`
      の`monitors_by_selection`と`available_monitors`。**tagは使っているzebarの版に
      合わせる**
  - 起動は`widgets/main/src/components/aiUsage/panel.ts`の1箇所に置く。どのwidgetを
    どの大きさでどこへ開くかが2つのchipで割れないようにする。
- **5段目は週と5Hの消費の内訳で、Claudeのblockだけが持つ。**Codexはusageのmetricを
  1つも送っていないため割るものが無い。**trackは共有templateに残し、Codex側は
  空にする。**左右のblockの高さを揃えるためと、出せるようになった時に段が既に
  あるようにするためである。
  - **上の段と同じ2列に割る。**列の位置が上の段のwindowと同じものを指す。
  - **全件を出し、段の中をscrollさせる。**cacheは消費のあったsessionを全部持つ。
    上位N件に切ると、切った分が`total`に現れず、行の合計と合わなくなる。
  - **`unresolved`も1行として出す。**落とすと行が`total`に合わない。実測では
    週の$1,329のうち$451 (34%) がこれで、別マシンのsessionである。
  - **1行に「上限の何%」と「いくら」を並べる。**$の側は実測値、%の側は按分値で
    ある。**同じ行に並べるのは、順位の食い違いこそが見たい情報だからである。**
    実測で、最も金を使ったsessionが上限の10.9%しか占めておらず、2位が26.9%を
    占めていた。2枚のcardに分けると、この1行が2つの一覧に分かれ、対応付けて
    読めなくなる。
    **画面には但し書きを足さない。**どこまで信じてよいかは「クォータの按分」に
    書く (行ごとの近似の幅、説明の付かない$/クォータの比)。
  - **%は窓の中での構成比ではなく、上限に対する割合である。**行の合計は100ではなく、
    見出しの`quota.total` (この窓で実際に使った量) になる。
    - **見出しはchipの%ではない。**窓の中でresetが起きた窓では、使った量がgaugeの
      現在値を超える (実測で56%に対し199%)。**chipと突き合わせて読めるのはresetの
      無い窓だけで、そこでは両者が一致する。**
  - **並び順とbarはcostのまま。**クォータは按分値で、刻み幅の決め方によって同じ
    消費でも順位が前後する。**問いによって行の位置が動くと、更新のたびに動いたように
    見える。**
  - **`unattributed`を`No spend recorded`として別の行に出す。**`unresolved`とは
    別のものである (前者はどのsessionにも帰属できないクォータ、後者は名前の付かない
    sessionのコスト)。出さないと、**画面に出ていない行が1つあることが、
    どこにも現れない。**
    - **ここでも合っているのは「行が欠けていないこと」であって、表示の桁では
      ない。**cacheの中では行と`unattributed`の合計がちょうど`quota.total`になるが、
      画面はそれぞれを1桁へ丸めるため、見えている数字の合計は見えている見出しと
      一致しないことがある。**列を合わせるために行の数字を調整しない。**
  - **`quota`を持たない窓も、cost列だけで出す。**helperはgaugeを引けなかった時に
    `null`を書き、この変更より前のcacheはfieldを持たない。**窓ごと拒むと、
    元から無かった列のために、届いているcost列まで消える。**
  - **表示名は`custom_title`→(本文が無ければ`ai_title`を副題に足す)→`ai_title`
    →`project`→`session_id`の先頭。**組み立てはここが持つ。helperは両方の題を
    そのまま渡す。実データで`#102`が`#102 AI usage ポップアップパネル統合`になる。
  - **合っているのは「行が欠けていないこと」であって、表示の桁ではない。**行と
    `unresolved`は`total`をちょうど作るが、画面はそれぞれを2桁へ丸めるため、
    見えている数字の合計は見えている`total`と最大で行あたり半セントずれる。
    **列を合わせるために行の数字を調整しない。**その行はそのsessionの額でなくなる。
  - **半セント未満は`$0.00`と出る。無ではない。**helperが落とすのは消費が厳密に0の
    行だけなので、**行があること自体が「0ではない」を示している。**切り上げると、
    `$0.004`の行が2つ並んだとき、合計1セントの下に1セントの行が2本出る。
  - **鮮度はこの段が自分で持つ。**helperは引けなかった時に前回のcacheを出し直すので、
    **数字は画面に残り、`generated_at`だけが止まる。**blockのheaderが出しているのは
    usageの鮮度で、そちらは別に取得しているため、**usageが今のものでもコストが
    数時間前ということがある。**古い時だけ、段の中にアイコンと経過時間を出す。
  - **usageの取得が失敗しても、この段は残す。**取得が別である以上、片方に答えが
    あってもう片方に無いことがある。失敗の表示で覆うと、届いた答えを隠すことになる。
- **このpanelのCardはすべて同じ面 (`bg-background-deeper/60`) を使う。**取得に失敗した
  ときの退避表示も含める。**面に意味を持たせない。**現在値のcardの強調は、文字サイズ・
  progress bar・`used`のpill・paddingの4つが担っており、面はその4つ目ではなく5つ目で
  あった。面を揃えると前景との対比が上がり、panel全体が読みやすくなる。
  - **一部だけ既定の面に残すと、そこだけ明るい継ぎ接ぎに見える。**実際、複数行に
    折り返された`<Card`を1行前提の置換が取りこぼし、Codexのwindow内の推移だけが
    揃っていない状態になった。
- **左右のblockは独立したgridで、同じtrack高さを共有する** (`panelLayout.ts`の
  `SECTION_GRID_ROWS`)。Claudeの7D cardはmodel別の枠を内側に持つぶん背が高く、
  高さを各blockに任せると左右で段の開始位置がずれる。
  - **header行も固定trackにする。**取得に失敗したblockはplan名を持たないため、
    `auto`だと隣のblockと段が揃わない。
  - 高さは854pxのパネルに対する割り当てである。想定より背の高い内容が来た時に
    黙って切らないよう、容器の`overflow-y-auto`は残す。
- **取得はprovider単位で、失敗も単位ごとに閉じ込める。**片方のhelperが落ちても
  もう片方のblockは残る。失敗したblockはheaderを保ったまま、cardの3段分を
  1枚のメッセージで埋める。
- **鮮度は1つにまとめない。**`generated_at`はproviderごとに別で、Claudeだけが
  `last_known`という状態を持つ。各blockのheaderが自分の更新時刻と状態を出す。
- グラフの`viewWidth`はcardの実寸に合わせる (`panelLayout.ts`)。svgは高さ132px
  固定で縦横比を保つため、viewBoxがcardより狭いと図だけが中央に寄り、
  その下のHTMLの軸ラベルと横幅が合わなくなる。
  - **これは1700pxのパネルに対する固定値で、上限が効いた幅には追従しない。**
    1366pxのモニタではcardが約305pxとなり、390pxのviewBoxが0.78倍に縮む。
    軸の8px文字が約6pxになり、132pxの枠内で上下に余白が出る。実寸を測って渡す道も
    あるが、計測後の再描画と未計測時の経路が増える。読めなくなるわけではないので、
    既知の制限として残している。

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
| Claude cost cron timeout    | 200秒         |
| Claude cost helper内部timeout | 30秒/query  |

**cost helperのtimeoutだけ桁が違うのは、所要が窓の長さに比例するためである。**
range queryは12時間ずつに割るので、7Dの窓は満了時にgaugeとコストで28本になり、
窓が若いうちはそれより少ない。実測で、**7Dの窓が68時間の時点でrange 14本・instant
7本・32〜41秒**だった。満了に近い窓はこれより長くなる。**内側は1 queryあたりで、
外側は1回の更新ぜんぶを覆う。**外側がrange queryを覆わないと、helperは理由を
logへ書く前に殺される。
**この規則が偽になる観測:** 満了した7Dの窓で200秒を超えること。cronのlogに
`claude-cost.cron`の行が出ないまま`--cached-only`の鮮度だけが古くなる形で現れる。

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

**同じ規則を14日retentionのfilterにも適用する。** 書き込み時に弾くだけでは、
その規則が無かった頃のhelperが残したsampleが14日間cacheに居座る。実際に、
`week_resets_at`を持たないsampleが17件残っていた状態で週次graphを描くと、
ある日の消費が449% (14日合計547) になった。該当sampleを除くと40% (合計101)
である。retention側でも弾くことで、次回の書き込みで消える。

**widget側も、window識別子を持たないsampleをgraphから落とす。** cacheはhelperの
どのversionよりも長生きするため、fileの内容を信用しない。消費量はwindow単位で
求めるので、reset時刻の無いsampleは現在windowへ0%への落下として混ざり、その後の
上昇で以前の分がもう一度計上されてしまう。

**画面が描き終わるまで読み続ける。固定時間の待機にしない。** `/usage`は2度に分けて
描画され、**model別のwindowは2度目に来る。**expectの`after`はptyを読まず、`log_file`は
読んだ分しか記録しないため、待機中に描かれたものは捕捉に一切入らない。待機を5秒から
90秒へ延ばしても変わらなかった。長い待機は「読まない時間が長い」だけである。

画面が静かになったら止め、上限で打ち切る。上限は、収まらない画面がcronの`timeout 60s`に
達して読み取りごと失われるのを防ぐためにある。実測で13〜14秒だった。

**画面はwindowの見出しで区切って読む。** `/usage`は`Current session`、
`Current week (all models)`、planによっては`Current week (<model>)`を並べる。各windowの
数字は自分の見出しから次の見出しまで、かつ**見出し直下4行まで**から読む。

見出しごとに1つの正規表現で`.*?% used`まで走らせると自分の節を越え、週次の見出しが
2つ並んだ時点でall modelsの枠がmodel別の数字を読む。行数の制限も要る。画面には
こちらのwindowに属さない数字があり、下部のcredits枠は自前の`100% 100% used`と
`Resets Oct 1`を持ち、部分再描画は見出しの無い数字を残す。数字が来る前に描かれた
見出しがそこまで届くと、**形の揃った、もっともらしい、誤ったwindowが公開される。**

### 見出しの括弧書きをどう読むか

括弧の中身は、集計枠の目印か、model名か、そのどちらでもない何かでありうる。
**画面はどれなのかを言わない。**規則を足して3種類目を捌こうとすると、1つ足すたびに
別の入力が壊れる (実際にレビュー3巡で同じ場所が回帰した)。そのため**規則を最小に保ち、
迷う入力では書かずに止まる**方針を採る。判定は上から順に次のとおり。

| 条件 | 扱い |
| --- | --- |
| 見出し直後に`(`があり、同じ行で閉じない | **読めない見出しとして捨てる** |
| `kind`が`session` | sessionのwindow。括弧の中身は見ない |
| 括弧が無い | all modelsの週次 (per-model window以前の表記) |
| 中身が`all models`と**完全一致** | all modelsの週次 |
| それ以外 | model別の週次。labelは画面の表記のまま持つ |

そのうえで、**model別の週次が2つ以上あればどれも記録しない。**どちらをwidgetが
指すのかを決める情報が画面に無く、片方を書くとあるmodelの消費が別のmodelの名前の
下に入る。model名による優先付けは持たない。持つと、planがwindowを1つ増やした時に
系列の中身が黙って入れ替わる。

それぞれの理由は次のとおり。

- **読めない括弧を「括弧が無い」と同じにしない。** 括弧が無い見出しは合計枠を指すが、
  読めなかった括弧は**読み損ねたmodel名**である。合計枠として扱うと、あるmodelの
  消費が週次の合計として公開される
- **`all models`は完全一致で見る。** 包含で見ると`(Fable, not all models)`のような
  model名を合計枠と判定してしまう。表記が変われば読み取りごと落ちるが、それは
  値を書かずに止まる失敗で、`generated_at`が動かなくなるためwidgetから見える
- **sessionでは括弧を見ない。** 今日のsessionの見出しは括弧を持たない。括弧を
  model名と決めつけると、`(5h)`のような注記が付いただけでsessionを見失い、
  週次まで含めて何も公開できなくなる

**model別の週次はsampleの記録条件にしない。** 見出しもreset表記も画面の中で最も
新しい部分で、変わる可能性が高い。そこが読めないことでsample全体を落とすと、
読めていた2つのwindowのgraphまで空になる。

**reset時刻は「現在時刻に最も近い候補」として解釈する。** Claudeはsessionのreset
を時刻だけ (`5:50am`)、weekのresetを月日だけ (`Sep 7, 9am`) で表示し、どちらも
日付や年を持たない。候補 (前日・当日・翌日 / 前年・当年・翌年) のうちnowに最も
近いものを採る。

refreshされた直後の画面ならresetは必ず先にあり、他の候補は1日・1年離れている
ため、この規則は単純に先送りするのと同じ結果になる。**向きが問題になるのは
`last_known`の画面である。** 表示されているresetが既に過ぎていることがあり、
それを先送りするとsessionは約24時間後、weekは約1年後のresetを公開してしまう。
chipの残り時間が「23h」と出たり、詳細viewの横軸が未来へ飛んで
「No samples yet」になったりする。過ぎたresetは過ぎたまま公開する。

**候補はwindow長 (5H / 7D、表示が分単位に丸まる分の猶予10分を加える) 以内に
限る。** window長より離れたresetは、先ならまだ始まっていない window のもので、
後ろなら画面がwindow 1本以上古いことになり、どちらもそのreadingのresetでは
ない。該当する候補が無い場合は`resets_at`を公開しない。widgetはClaudeの表示
文字列 (`5:50am`) をそのまま出し、残り時間のcount downをやめる。

この上限が無いと、`last_known`が12時間以上古い時に翌日の候補が最も近くなる。
5H windowに対して「6h」残っていると表示するようなreadingが出てしまう。

**window長は3箇所に重複している。** helperの`%window_seconds`、
`widgets/main/src/components/claudeUsage/ClaudeUsage.tsx`と
`widgets/ai-usage-details/src/ClaudeSection.tsx`の`SESSION_WINDOW_SECONDS` /
`WEEK_WINDOW_SECONDS`である。helper側は「公開するか否か」を決めるため、
providerがwindow長を変えた場合は`resets_at`とhistory収集が止まる (手がかりは
1 runあたりstderr 1行のみ)。変更時は3箇所を揃える。

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
- `current_week_model`（任意）
  - `Current week (Fable)`のような、1つのmodelだけを対象とする週次window。
    `label`にmodel名、残りは`current_week`と同じ形を持つ。
  - **planによっては存在しない。無い時はfieldごと省く。** 週次の枠が1つしかない
    planでこのfieldを空で置くと、widget側が「0%」と区別できない。
- `history`
  - 5分ごとの5H・7D使用率と各reset日時を14日分保持する。
  - `current_week_model`があるsampleは`week_model_used_percent`、
    `week_model_resets_at`、`week_model_label`の3つを**揃えて**持つ。欠けた
    sampleからはこの3つを落とす。使用率だけではwindowへ置けず、labelが無いと
    別modelの週次と見分けられない。
  - **historyは1本の系列にlabelの異なるsampleが混ざりうる。** helperはlabelが
    変わってもそこで系列を切らない。14日分の有効なデータを改名だけで捨てないため
    である。**描画側がlabelで区切る。**混ざったまま1本の線として描くと、別々の
    windowの消費が連続した推移に見える。
  - Claude側がlast-known値を返した場合は新しい履歴点として追加しない。

Codex UIが必要とする主なfield:

- `generated_at`
- `rate_limits.primary`
- `rate_limits.secondary`
- 各windowの`usedPercent`、`windowDurationMins`、`resetsAt`
- `history`
  - 5分ごとに、その時点で報告された全windowの使用率、時間幅、reset時刻を保持する。
  - 14日分を保持し、描画時は**時間幅だけで**選ぶ (reset時刻は見ない)。retentionが
    保持する全windowを残すためで、reset時刻まで一致させると進行中のwindowしか
    残らない。

## Widgetが実行するcommand

widgetはdistribution名・user名・home directoryを埋め込まず、既定のWSL
distributionを既定のuserで起動する。

```text
wsl.exe -- sh -c '$HOME/bin/<helper> --cached-only'
```

統合パネルは`claude-cost-json`も同じ形で読む。main barのchipは読まないので、
`zpack.json`の許可も`ai-usage-details`にだけ足す。

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

**先に`packages/ui`をbuildする。** 各widgetは`packages/ui/dist/index.js`を
解決するため、共有componentやutilを追加した状態でwidgetだけbuildすると
`"selectCurrentWindow" is not exported by "../../packages/ui/dist/index.js"`
のようなrollupのexportエラーで落ちる。

main barとクリックで開く統合パネルは別widgetなので、両方buildする。

```sh
CI=1 corepack pnpm --filter @overline-zebar/ui build
CI=1 corepack pnpm --filter @overline-zebar/main build
CI=1 corepack pnpm --filter @overline-zebar/ai-usage-details build
```

`CI=1`はWSLでは必須である。各widgetのvite configはbuild後に`postbuild` hookで
`taskkill /IM zebar.exe`と`start zebar.exe`を実行する。WSLにはどちらのcommandも
無いため`start`の失敗が`closeBundle`から例外として上がり、**widgetによっては
distが書かれる前にbuildが中断する**。`CI`が設定されているとこのhookはskipされる
(Zebarの再起動は手順4で行う)。

`ENOENT: pnpm install` / `spawnSync pnpm ENOENT`でbuildが始まる前に落ちる場合は、
pnpmがscript実行前のdeps checkで`node_modules`をlockfileとout of syncと判定し、
自動で`pnpm install`を実行しようとしている。このとき起動するのは`pnpm`という
**bareなcommand**なので、corepack経由でしかpnpmを持たない環境では解決できず
ENOENTになる。`pnpm`をPATHへ通してある環境ではこの症状は出ない。

判定理由は`--config.verify-deps-before-run=warn`で確認できる。warnではcheckは
警告だけになりscriptはそのまま走るため、切り分けと回避を兼ねられる。

```sh
CI=1 corepack pnpm --config.verify-deps-before-run=warn \
  --filter @overline-zebar/ui build
# [WARN] Your node_modules are out of sync with your lockfile. ...
```

out of syncの理由が`node_modules`の作られ方 (pnpmのversionやvirtual storeの設定の
変化) にある場合、`corepack pnpm install`は「Already up to date」を返すだけで
解消しない。deps checkを外して進めるなら
`--config.verify-deps-before-run=false`を付ける。

なお`corepack pnpm install`を実行すると、pnpm 11は`esbuild`のbuild script未承認を
`ERR_PNPM_IGNORED_BUILDS`で報告し、**`pnpm-workspace.yaml`へ`allowBuilds`の
placeholder (`esbuild: set this to true or false`) を書き込む。** 値を埋めるまで
installは非0で終わる。`esbuild: false`でもwidgetのbuildは通る (viteはplatform別
packageのbinaryを使う)。placeholderを残したままcommitしないよう注意する。

### 3. Zebarの実行packへ同期する

`dist`だけでなく、新しいwidget定義とshell command権限を含む`zpack.json`も
必ず同期する。`ZEBAR_PACK_DIR`は自分の環境の実行packへ読み替える。

```sh
ZEBAR_PACK_DIR="/mnt/c/Users/<windows-user>/.glzr/zebar/<pack>@<version>"

for w in main ai-usage-details; do
  rsync -rt --delete --no-perms --no-owner --no-group \
    "widgets/$w/dist/" "$ZEBAR_PACK_DIR/widgets/$w/dist/"
done
install -m644 zpack.json "$ZEBAR_PACK_DIR/zpack.json"
```

`dist`はすべて生成物なので`--delete`で同期する。asset名はcontent hashを含むため、
上書きコピーだけでは古いhashのfileがpack側へ残り続ける。`-rt`と
`--no-perms --no-owner --no-group`は、NTFS (drvfs) 側でpermissionやownerを
再現できないことによる失敗を避けるためである。

**`cp -a`で同期する場合は`cp`のaliasに注意する。** shellが`cp -i`をaliasして
いると、既存fileごとに確認待ちになる。非interactiveな実行では応答が無いまま
全fileがskipされ、しかも`cp`は終了code 0を返すため、`set -e`でも成功したように
見える。この経路を使うなら`command cp -a`のようにaliasを外す。

同期後は、少なくとも各entry pointがbuild元と一致することを確認する。
次の`cmp`がすべて終了code 0なら、Zebarが次回読む`index.html`は最新である。

```sh
cmp widgets/main/dist/index.html \
  "$ZEBAR_PACK_DIR/widgets/main/dist/index.html"
cmp widgets/ai-usage-details/dist/index.html \
  "$ZEBAR_PACK_DIR/widgets/ai-usage-details/dist/index.html"
```

**削除したwidgetのdirectoryはpack側に残る。**`zpack.json`から定義が消えても
Zebarは既存のdirectoryを消さない。`codex-usage-details`から移行する場合は
`$ZEBAR_PACK_DIR/widgets/codex-usage-details`を手で削除する。

`index.html`内のasset名はcontent hashを含むため、同期前後でasset名が更新されて
いることも反映確認の目安になる。

### 4. Zebarを再起動して確認する

Zebarのtray menuから終了して再起動する。WSLから行う場合は次のとおり。exe pathは
自分の環境のものへ読み替える (`(Get-Process zebar).Path`で確認できる)。

```sh
powershell.exe -NoProfile -Command \
  "Stop-Process -Name zebar -Force; Start-Sleep -Seconds 2; \
   Start-Process 'C:\Program Files\glzr.io\Zebar\zebar.exe'"
```

再起動後、`Get-Process zebar`のPIDが変わっていることを確認する。main barの
Claude/Codex chipをクリックし、次を確認する。

- Claude chipとCodex chipのどちらからも同じ`ai-usage-details`が、
  main bar直下の同じ位置に開く。
- 左にClaude、右にCodexが並び、左右で各段の高さが揃っている。
- 5H・7Dの現在値とreset時刻が表示される。
- 取得済みの履歴がある場合、推移graphが表示される。
- 詳細viewの外をクリックすると閉じる。

開かない場合は、まずZebarが参照しているpackの`zpack.json`に
対象の詳細widget定義があることと、同じpack内に対応する`dist/index.html`が
あることを確認する。ソース側だけを更新しても、インストール済みpackには
自動反映されない。

## Cron環境

cronはinteractive shellの初期化を行わないため、そのPATHは対話シェルのものと異なる。

両helperはCLIを次の順で解決する。helper自身は環境固有のパスを持たない。

1. 環境変数 (`CLAUDE_USAGE_CLAUDE_BIN` / `CODEX_USAGE_CODEX_BIN`)
2. cronから見える`PATH`

どちらでも見つからなければ失敗し、不足している実行ファイル名をstderrへ出す。
CLIをPATH外へ入れている場合は、環境変数で指すか、cronから見える位置へ載せる。
Claude側は`expect`も同様に必要である。例は各`crontab.example`にある。

Codexのrefresh失敗時は、掴んだlauncherのパスをstderrへ出す。
どのCodexを起動したかが分からないと切り分けができない。

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
CI=1 corepack pnpm --filter @overline-zebar/ui build
CI=1 corepack pnpm --filter @overline-zebar/main build
CI=1 corepack pnpm --filter @overline-zebar/ai-usage-details build
```

## windowの挙動を測り直す

「報告されるresetは常にnowを含むwindowの終端」は**providerの挙動なので変わりうる。**
主張を置いたまま古びさせないよう、同じ判定を`history`から測り直せるようにしておく。

```sh
python3 - <<'EOF'
import json, datetime, os

DAY = 24 * 3600

def claude(sample):
    for name, used, reset, span in (
        ('5H', 'session_used_percent', 'session_resets_at', 5 * 3600),
        ('7D', 'week_used_percent', 'week_resets_at', 7 * DAY),
        ('7D model', 'week_model_used_percent', 'week_model_resets_at', 7 * DAY),
    ):
        if sample.get(reset) is None or sample.get(used) is None:
            continue
        yield name, sample[used], datetime.datetime.fromisoformat(
            sample[reset].replace('Z', '+00:00')).timestamp(), span

def codex(sample):
    for window in sample['windows']:
        yield (f"{window['windowDurationMins']}m", window['usedPercent'],
               window['resetsAt'], window['windowDurationMins'] * 60)

broken = []

for label, path, windows in (
    ('claude', '~/.cache/claude-usage-json/usage.json', claude),
    ('codex', '~/.cache/codex-usage-json/usage.json', codex),
):
    history = sorted(json.load(open(os.path.expanduser(path)))['history'],
                     key=lambda s: s['recorded_at'])
    inside, total = {}, {}
    moved, starts, previous = {}, {}, {}
    for sample in history:
        for name, used, reset, span in windows(sample):
            if used == 0:
                total[name] = total.get(name, 0) + 1
                inside[name] = inside.get(name, 0) + (
                    -60 <= reset - sample['recorded_at'] <= span + 60)
            was = previous.get(name)
            if was and was[0] == 0 and used > 0:
                starts[name] = starts.get(name, 0) + 1
                moved[name] = moved.get(name, 0) + (abs(reset - was[1]) > 300)
            previous[name] = (used, reset)
    if not total:
        broken.append(f'{label}: 未使用のwindowが1つも測れていない')
    for name in total:
        print(f'{label} {name}: 未使用sampleのwindowがnowを含む '
              f'{inside[name]}/{total[name]}, 使用開始でresetが動いた '
              f'{moved.get(name, 0)}/{starts.get(name, 0)}')
        if inside[name] < total[name] or moved.get(name, 0):
            broken.append(f'{label} {name}')

if broken:
    raise SystemExit('前提が崩れている: ' + ', '.join(broken))
EOF
```

**panelが描くwindowを1つ残らず見る。**`windows[0]`やsessionだけを見ると、週次だけが
前提を破っていても健全と報告する。**崩れていれば非ゼロで終わる。**目視で5行を
突き合わせる検査は、見落とした時に黙って通る。

「nowを含む」が総数を割り込んだら、軸をresetに合わせる前提が崩れている
(`packages/ui/src/utils/usageSeries.ts`の`windowTrendRange`)。
「使用開始でresetが動いた」が立ったら、Claudeの境界が固定という前提が崩れている。
per-modelの週次を持たないplanではその行が出ないだけで、失敗にはしない。

最後に測った値 (2026-09-13):

```
claude 5H:       997/997,  0/46      codex 300m:   2029/2029, 0/19
claude 7D:        61/61,   0/3       codex 10080m:  127/127,  0/3
claude 7D model:   2/2,    0/1
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
| `required executable not found: <名前>`（exit 70） | Claude helperの依存不足。欠けているものが行に出る。`expect`を導入するか、`CLAUDE_USAGE_CLAUDE_BIN`で`claude`を明示する |
| `Codex executable not usable: <値>`（exit 69） | cronのPATHから`codex`が見えない。`/usr/local/bin`へsymlinkを張るか、`CODEX_USAGE_CODEX_BIN`で明示する。値が出ていればその指定が実行可能でない |
| `timed out waiting for Claude Code input prompt`    | 起動directoryがtrustされていない。workdirで一度手動trustする               |
| 値は出るがstale表示のまま                           | cron停止、またはClaudeが`refresh_status: last_known`を返している           |

`shellExec`はwidgetの`config.ts`と`zpack.json`の`argsRegex`が完全一致した
ときだけ実行される。commandを変えて片方だけ更新すると、helperが正常でも
widgetは`--`のままになる。`env`は`argsRegex`の対象外なので、`WSL_UTF8`を
足しても`zpack.json`の変更は要らない。

exit codeの読み分けは次のとおり。`0`・`64`・`66`・`69`・`70`・`73`はhelperが返したもので、
それ以外は`wsl.exe`が返したものである。widgetはhelperのstderrと`wsl.exe`の
stdoutの両方をerror messageへ載せる。

## Upstream追従

fork固有実装は可能な限り新規directoryへ分離している。それでもupstream所有のfileには
差分が残る。取り込みの前に何が残っているかを測る。下のコマンドが数えるのは、merge
baseに既にあったfileへforkが加えた差分である。upstreamが同じfileを触っているかは
分からないので、出るのは衝突の候補であって衝突ではない。forkが新しく足したfileも
数えない。upstreamが同名で足せばそこも衝突しうる。

比較先は`upstream/main`の先端ではなくmerge baseにする。先端と比べると、forkの差分と
「まだ取り込んでいないupstreamの変更」が同じ一覧に混ざって区別できない。比較元も
`HEAD`ではなく`origin/feat/ai-usage`と名指しする。`HEAD`は今いるブランチで変わり、
本線以外にいるとそのブランチの差分を数える (`main`にいれば0と出る)。

```sh
git remote get-url upstream 2>/dev/null ||
  git remote add upstream https://github.com/mushfikurr/overline-zebar.git
git fetch --multiple origin upstream
base=$(git merge-base origin/feat/ai-usage upstream/main)
git diff --name-only "$base" origin/feat/ai-usage | while read f; do
  git cat-file -e "$base:$f" 2>/dev/null &&
    printf '%6s  %s\n' "$(git diff "$base" origin/feat/ai-usage -- "$f" | grep -cE '^[+-][^+-]')" "$f"
done | sort -rn
```

出てきたfileのうち、扱いが決まっているものが3つある。`pnpm-lock.yaml`は衝突しても
upstream側を採って`corepack pnpm install`で作り直せる。`zpack.json`はfork widgetの
定義と`wsl.exe`権限を持つので、衝突したらfork側を残す。`widgets/main/src/App.tsx`の
`AiUsage`のimportと配置は、barへwidgetを載せる以上消せない。

共有の`packages/tailwind/tailwind.config.ts`には、forkの差分が2つの形で入りやすい。
1箇所でしか使わないtokenと、upstreamも同じ修正を持つ箇所に付けたコメントである。
前者は参照側のcomponentが、後者は規則を守るテストが持てば、共有configの差分は0に
なる。`ServiceIcon`のfont-familyはcomponent内の定数にしてある。

### mergeで取り込む。rebaseしない

forkの本線は`feat/ai-usage`で、取り込みもここへ入れる。起点を`origin/feat/ai-usage`に
するのは、ローカルの`feat/ai-usage`は無いことも古いこともあるためである。

```sh
git fetch --multiple origin upstream &&
  git switch -c chore/merge-upstream-$(date +%Y%m%d) origin/feat/ai-usage &&
  git merge upstream/main
```

3行を`&&`でつなぐのは、ブランチの作成に失敗したときにmergeを走らせないためである。
つながないと、mergeは今いるブランチへ入る。

rebaseはforkの全commitを書き換える。公開済みのブランチにはforce pushが要り、そこから
派生したブランチも作り直しになる。衝突はcommitごとに解決するため、同じ箇所を複数の
commitが触っていればその数だけ繰り返す。merge commitは既定では失われる
(`--rebase-merges`で保つことはできる)。mergeはこのいずれも伴わない。

この判断が効かないのは、forkのcommitをまだ公開しておらず、派生ブランチも無い場合で
ある。force pushのコストが消えるため、その時は両方式を測り直す。

### 取り込んだ後に確認するもの

1. `App.tsx`内の表示順が`StatProviders → AiUsage`になっていること
2. `zpack.json`のcommand・正規表現が各`config.ts`と一致していること
3. 「検証項目」を上から順に通すこと
4. 「配置・更新手順」で実機へ反映し、barと統合パネルを目視すること

## 検証項目

変更時は最低限、次を確認する。

`packages/ui`が先頭にあるのは、widget側のbuildが`packages/ui/dist/index.js`を
解決するためである。後ろに回すと、clean checkoutではwidgetのbuildがrollupのexport
エラーで落ち、古い`dist`が残った環境では**古いUIを束ねたまま成功する。**

```sh
CI=1 corepack pnpm install
CI=1 corepack pnpm --filter @overline-zebar/ui test
CI=1 corepack pnpm exec eslint \
  packages/ui/src/components/usage-trend \
  packages/ui/src/components/usage-history \
  packages/ui/src/utils/usageSeries.ts \
  widgets/main/src/components/aiUsage \
  widgets/main/src/components/claudeUsage \
  widgets/main/src/components/codexUsage
CI=1 corepack pnpm exec tsc --noEmit -p widgets/main/tsconfig.json
CI=1 corepack pnpm --filter @overline-zebar/main build
CI=1 corepack pnpm --filter @overline-zebar/ai-usage-details build
CI=1 corepack pnpm exec tsc --noEmit -p widgets/ai-usage-details/tsconfig.json
python3 -m py_compile scripts/claude-usage/claude-usage-json
bash -n scripts/codex-usage/codex-usage-json
python3 scripts/codex-usage/test-codex-usage-json
python3 scripts/claude-usage/test-claude-usage-json
python3 scripts/claude-cost/test-claude-cost-json
python3 scripts/claude-sessions/test-claude-session-info-prom
```

`CI=1`はwidgetのbuild後のZebar再起動hookをskipする (「配置・更新手順」の2)。
先頭の`install`は`node_modules`をlockfileに合わせる。新しいcheckoutには`node_modules`が
無く、upstreamの取り込みはlockfileを変えることがある。

`packages/ui`のテストは個別に並べず`test` scriptで回す。ここに一覧を置くと、テストが
増えても追随せず漏れる。この scriptは`tsc`とtailwindのbuildを兼ねるため、
`packages/ui`のbuildを別に行う必要はない。

軸の選び方は、間違っていても「それらしいgraph」が出るため目視で気付きにくい。

`test-usage-status.mjs`は鮮度判定を持つ。年齢とClaudeの`last_known`という
一致しない2つの根拠を1つのlabelへ畳むため、パネルごとに書くと食い違う。

`test-claude-usage-json`はAPIと画面のwindow対応、reset時刻、cache、raw response、
collector出力、stale readingを同じ実装moduleに対して検証する。

実機反映を伴うUI変更の完了条件は次のとおり。

- 対象widgetのlint・型check・buildが成功している。
- buildした全widgetの`dist`を、Zebarが実際に参照するpackへ同期している。
- ソース側とpack側の各`dist/index.html`が`cmp`で一致している。
- 同期後にZebarをreloadまたは再起動し、対象表示を確認している。

**クォータの按分を触った時は、合計が実測に一致することを実データで引き直す。**
テストは固定したreadingに対して規則を確かめるもので、**gaugeの側の形が変わった
ことは捕まえない** (窓の中でresetが起きる、片方のhostだけが報告する等)。
コマンドは`scripts/claude-cost/README.md`の「How far to trust it」にある。

加えて、Windows側（PowerShellなど）からZebarと同じcommandを実行し、既定の
distributionでJSONが返ることを確認する。

```powershell
wsl.exe -- sh -c '$HOME/bin/claude-usage-json --cached-only'
wsl.exe -- sh -c '$HOME/bin/codex-usage-json --cached-only'
```
