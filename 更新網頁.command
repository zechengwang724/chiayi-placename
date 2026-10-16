#!/bin/bash
# 雙擊執行：讀取「資料庫」裡的 Excel，重新產生網頁資料（Mac）
cd "$(dirname "$0")" || exit 1
echo "正在更新網頁資料……"
echo
if ! command -v python3 >/dev/null 2>&1; then
  echo "這台電腦沒有 Python 3。"
  echo "請依畫面指示安裝「命令列開發者工具」，裝好後再雙擊一次本檔案。"
  xcode-select --install 2>/dev/null
else
  python3 系統/build.py
  echo
  echo "完成。請重新整理瀏覽器（⌘R）查看。"
  echo "檢查結果也存在：系統/檢查報告.txt"
fi
echo
read -n 1 -s -r -p "按任意鍵關閉此視窗"
