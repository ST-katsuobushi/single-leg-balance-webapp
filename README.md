# single-leg-balance-webapp

スマートフォンで使う、片脚バランストレーニング Web アプリです。
DeviceOrientation を使って揺れを簡易表示し、セッションログを localStorage に保存します。

## 使用前提（更新仕様）

- **スマートフォンの画面回転ロックを ON** にして使用する
- スマートフォン本体は**横向き**で持つ
- 画面は**天井向き**にする
- **両手**で保持する
- **肩関節90°屈曲・肘伸展**を基本姿勢とする
- 上肢はできるだけ動かさない
- アプリは**縦長画面（portrait）を正常状態**として扱う
- 画面内容はアプリ側で **90 度回転表示** する
- 画面が横長（landscape）の場合は **「画面回転ロックをONにしてください」** を表示し開始できない

## UI と表示仕様（今回の整理）

- 白枠・文字・ボタン・点・余白など、**サイズ系は画面サイズ基準**で統一
- ターゲットは **短辺 70% 基準**で算出し、`width === height` の**正円**を常時維持
- ポインタ表示は **0°で中心 / 45°で円の端** になる割合ベース
- センサー角度が 45°を超えても、**表示だけ端で頭打ち**（読み取りは継続）
- ポインタ最大移動量は **円半径基準**（`表示位置 = 正規化割合 × 円半径`）

## セットアップ

```bash
npm install
npm run dev
```

- 開発サーバー起動後、表示された URL をスマートフォンブラウザで開いてください。
- iOS Safari はセンサー許可ダイアログが出るため、許可が必要です。

## GitHub Pages での公開

このリポジトリは GitHub Actions で Pages にデプロイする設定です（`.github/workflows/deploy.yml`）。

1. `main` ブランチに変更を push します。
2. GitHub リポジトリの **Settings > Pages** を開きます。
3. **Source** を **GitHub Actions** に設定します。
4. Actions の `Deploy to GitHub Pages` ワークフロー完了後に公開されます。

公開 URL 例:
- `https://st-katsuobushi.github.io/single-leg-balance-webapp/`

## 実装済み画面フロー

1. 開始画面（脚・時間の選択、開始、前回設定保持）
2. 準備確認画面（姿勢案内、校正ボタン、未校正時は進行不可）
3. 3秒カウントダウン画面
4. 練習画面（ターゲット円、現在位置点、残り時間、停止）
5. 終了画面（再実行、反対脚、ホーム）

## 練習画面の点の挙動

- 軸と符号の定義: `src/sensor.ts`
  - `AXIS_MAPPING`（左右傾き→左右移動、前後傾き→上下移動）
  - `AXIS_SIGNS`（前後方向の直感と一致するよう Y 軸符号を調整）
- `EDGE_TILT_DEG = 45` を境界に正規化し、`-1..+1` で表示位置を決定
- スマホを**横向き・画面天井向き**で保持した基準角を校正値として扱う
- 前後方向（Y）は deadzone・step-limit・平滑化を強め、飛びや不安定さを抑制

## ログ保存

localStorage キー: `balance_app_logs_v1`

保存項目:
- session_id
- date
- leg
- target_duration_sec
- actual_duration_sec
- completed
- calibration_done
- mean_sway_index
- sd_sway_index
- max_sway_index
- time_in_target_ratio
