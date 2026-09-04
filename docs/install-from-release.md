# Releaseから導入する

fork の release ([`ai-usage-v1`](https://github.com/ks-yuzu/overline-zebar/releases/tag/ai-usage-v1)
以降) を使って、ソースをbuildせずに導入する手順。

リポジトリで開発しながら実機へ反映する手順は
[設計・運用記録](./ai-usage-integration.md)の「配置・更新手順」にある。こちらは
**配られた成果物から入れる**場合の手順である。

## ダウンロードする2つ

| asset | 中身 | 要否 |
| --- | --- | --- |
| `overline-zebar.zip` | Zebarのwidget pack (`zpack.json`と各widgetの`dist`) | 必須 |
| `ai-usage-helpers.zip` | WSL側のhelper、cronの例、設計・運用記録 | **AI usageを使うなら必須** |

**pack だけではClaude/Codexのchipは`--`しか表示しない。** 使用率はWSL側のhelperが
5分ごとに書くcacheから読んでおり、widgetは自分で取得しない。

## 1. Zebar packを置く

Zebarは`~/.glzr/zebar`の**直下1階層**を走査し、`zpack.json`を持つdirectoryをpackとして
扱う。`%USERPROFILE%\.glzr\zebar`に展開する。

### 新規に入れる場合

zipの`overline-zebar/`をそのまま置き、`~/.glzr/zebar/overline-zebar/zpack.json`
となるようにする。

```powershell
Expand-Archive overline-zebar.zip -DestinationPath "$env:USERPROFILE\.glzr\zebar"
```

**directory名は`overline-zebar`のままにする。** Zebarはdirectory名をpack idとして扱う
一方、`settings.json`の`startupConfigs[].pack`は`zpack.json`の`name`とも一致する。
両者が同じ`overline-zebar`になる名前にしておけば、どちらの規則で解決されても当たる。

`settings.json`に起動設定を書く。

```json
{
  "startupConfigs": [
    { "pack": "overline-zebar", "widget": "main", "preset": "default" }
  ]
}
```

### 既にmarketplace版が入っている場合

**新しいdirectoryを足さず、既存のpack directoryの中身を上書きする。**
`overline-zebar`という同じ名前のpackが2つになると、起動設定がどちらを指すか
決まらない。

```powershell
$pack = "$env:USERPROFILE\.glzr\zebar\mushfikurr.overline-zebar@1.0.5"
Expand-Archive overline-zebar.zip -DestinationPath $env:TEMP\ozr -Force
Copy-Item "$env:TEMP\ozr\overline-zebar\*" $pack -Recurse -Force
```

directory名 (`<packId>@<version>`) はそのままでよい。`settings.json`は
`zpack.json`の`name`で引いているため、変更は要らない。

## 2. WSL helperを置く

**既定のWSL distributionの、既定userとして**行う。widgetは
`wsl.exe -- sh -c '$HOME/bin/<helper> --cached-only'`を実行するため、この2つが
前提になる。

前提コマンド: Claude側は`expect` `perl` `flock`、Codex側は`jq` `flock`。
加えて各CLI (`claude` / `codex`) が認証済みであること。

```sh
unzip ai-usage-helpers.zip
install -m755 ai-usage-helpers/claude-usage/claude-usage-json "$HOME/bin/"
install -m755 ai-usage-helpers/codex-usage/codex-usage-json "$HOME/bin/"
```

### Claudeは一度だけ手でtrustする

helperは専用の作業directoryでClaude Codeを起動する。Claude Codeは起動directoryの
trustを一度尋ね、応答するまでpromptを出さない。**cronからは応答できない**ので、
先に一度手で通しておく。

```sh
mkdir -p ~/.cache/claude-usage-json/workdir
cd ~/.cache/claude-usage-json/workdir && claude
```

trustに答えて終了する。これを飛ばすと
`timed out waiting for Claude Code input prompt`で止まり続ける。

### cronを入れる

`crontab.example`を`crontab -e`へ写す。`claude`のパスは自分の環境に合わせる
(cronはinteractive shellを読まないため、PATHに載っていない)。

```
@reboot     CLAUDE_USAGE_CLAUDE_BIN="$HOME/.local/bin/claude" /usr/bin/timeout 60s "$HOME/bin/claude-usage-json" --force 2>&1 >/dev/null | /usr/bin/logger -t claude-usage.cron
*/5 * * * * CLAUDE_USAGE_CLAUDE_BIN="$HOME/.local/bin/claude" /usr/bin/timeout 60s "$HOME/bin/claude-usage-json" --force 2>&1 >/dev/null | /usr/bin/logger -t claude-usage.cron
@reboot     /usr/bin/timeout 30s "$HOME/bin/codex-usage-json" --force 2>&1 >/dev/null | /usr/bin/logger -t codex-usage.cron
*/5 * * * * /usr/bin/timeout 30s "$HOME/bin/codex-usage-json" --force 2>&1 >/dev/null | /usr/bin/logger -t codex-usage.cron
```

## 3. 確認する

WSL側でcacheが書けているか。

```sh
"$HOME/bin/claude-usage-json" --force | head -c 200
"$HOME/bin/codex-usage-json" --force | head -c 200
```

Windows側から、widgetと同じcommandが通るか。

```powershell
wsl.exe -- sh -c '$HOME/bin/claude-usage-json --cached-only'
wsl.exe -- sh -c '$HOME/bin/codex-usage-json --cached-only'
```

Zebarを再起動し、main barのClaude/Codex chipに数値が出ること、clickで詳細viewが
開くことを確認する。

## うまくいかない時

症状ごとの原因は[設計・運用記録](./ai-usage-integration.md)のTroubleshootingにある。
最初に見るべきはこの2つ。

- **chipが`--`のまま** — helperが`$HOME/bin`にない、または既定のdistribution/userが
  違う。Windows側から上の`wsl.exe`のcommandを実行して切り分ける
- **値が更新されない** — cronが動いていない。`journalctl -t claude-usage.cron`
  (または`/var/log/syslog`) を見る

## 検証状況

既存のpack directoryを上書きする経路は、この構成で繰り返し動作を確認している。
**新規directoryとして置く経路は未検証。** Zebarのpack探索の仕様に沿ってはいるが、
最初に試す際は上記のdirectory名の注意を守ること。
