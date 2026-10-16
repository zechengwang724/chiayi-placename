@echo off
chcp 65001 >nul
rem 雙擊執行：讀取「資料庫」裡的 Excel，重新產生網頁資料（Windows）
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 正在更新網頁資料……
echo.
where py >nul 2>nul && (py -3 系統\build.py & goto done)
where python >nul 2>nul && (python 系統\build.py & goto done)
echo 這台電腦沒有 Python 3。請到 https://www.python.org/downloads/ 下載安裝（安裝時勾選 Add Python to PATH），再雙擊一次本檔案。
goto end
:done
echo.
echo 完成。請重新整理瀏覽器（F5）查看。
echo 檢查結果也存在：系統\檢查報告.txt
:end
echo.
pause
