# single-leg-balance-webapp

スマートフォンで使う、片脚バランストレーニング Web アプリです。
DeviceOrientation を使って揺れを簡易表示し、セッションログを localStorage に保存します。

## 新しい使用前提

- **スマートフォンの画面回転ロックを ON** にして使用する
- スマートフォン本体は**横向き**で持つ
- 画面は**顔側**に向ける
- アプリは**縦長画面（portrait）を正常状態**として扱う
- 画面内容はアプリ側で 90 度回転表示されるため、端末を横向き保持した状態で自然に読める
- 画面が横長（landscape）になっている場合は、
  **「画面回転ロックをONにしてください」** を表示し開始できない

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

- 軸・感度・安定化は `src/sensor.ts` の定数で調整可能
  - `AXIS_MAPPING`（現在は `x=beta`, `y=gamma`）
  - `AXIS_SIGNS`（必要に応じた符号反転）
  - `SENSOR_SENSITIVITY_DEG`（小さいほど高感度）
  - `SMOOTHING_ALPHA`（0〜1、値が小さいほどなめらか）
  - `RAW_JUMP_REJECT_DEG`（急変値を無視するしきい値）
  - `MAX_RADIUS`（点が到達可能な最大半径）
- 処理は「キャリブレーション差分 → 急変除外 → 平滑化 → 円内制限」の順で行う
- 点は常に円内に収まる

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

## 未解決点 / 今後の改善

- センサ値は端末・ブラウザによって感度差があるため、実地に合わせた微調整が必要
- 現在は DeviceOrientation のみ利用（DeviceMotion 併用やフィルタ処理未実装）
- UI は最小構成のため、アクセシビリティ・多言語対応は未対応
- ログのエクスポート/削除 UI は未実装
- 医療用途を想定した精度検証は未実施
