#!/usr/bin/env python3
"""
行事曆產生器「月份標題圖」批次處理。

來源是手機/修圖 app 匯出的 PNG（1640x2360，四周一大片透明，右邊那張母女合照
會比文字還低），這支腳本把它變成網站可以直接用的檔：

  1. 切掉所有透明邊。
  2. 人物下半身切掉：以「文字最底」為基準線，右邊照片超出的部分一併裁掉，
     所以整張圖底部是齊平的。
  3. 縮到統一高度後存成 title-MM.webp。

     這裡是「對高度」而不是「對寬度」：每個月只有數字不一樣，左邊界會差幾十像素，
     若對齊寬度，12 個月的字會一個比一個大一點點。對齊高度則每個月的
     「團購行事曆」大小完全一致，寬度差那 3% 交給版面靠左/置中即可。

標準版和壓扁長條版是**兩套不同的來源檔**（都是使用者自己排版好的），不是這裡壓出來的。
處理壓扁版時加 `--slim`，檔名會變成 title-MM-slim.webp，高度改用 SLIM_HEIGHT。

用法（Pillow 裝在 scratchpad，不要裝進本 repo）：
    pip install Pillow
    python3 tools/prep-calendar-title-images.py <來源檔>:<月份> [...] \
        [--slim] [--height 300] [--out images/calendar] [--dry]

例：
    python3 tools/prep-calendar-title-images.py IMG_3615.png:1 IMG_3616.png:2
    python3 tools/prep-calendar-title-images.py IMG_3627.png:1 --slim

來源檔不會被覆蓋，輸出一律 .webp（保留透明背景）。
"""
import os
import sys

from PIL import Image

OUT_HEIGHT = 300      # 標準版輸出高度（來源裁切後約 305，等於原尺寸）
SLIM_HEIGHT = 222     # 壓扁版輸出高度（來源裁切後 226，跟標準版同一個縮放比例，字級關係才不會跑掉）
QUALITY = 92          # webp 品質（有文字邊緣，比照片類再高一點）
ALPHA_MIN = 10        # 判斷「這個像素算內容」的 alpha 門檻
PHOTO_BAND = 40       # 底部這個範圍內的欄位視為「照片區」（照片是全圖最低的部分）


def content_box(im):
    """回傳 (left, top, right, bottom)：透明邊切掉、且底部切到文字最底的裁切框。"""
    alpha = im.getchannel('A')
    w, h = im.size
    px = alpha.load()

    # 每一欄最下面的內容像素在哪一列
    bottoms = []
    for x in range(w):
        b = -1
        for y in range(h - 1, -1, -1):
            if px[x, y] > ALPHA_MIN:
                b = y
                break
        bottoms.append(b)

    filled = [x for x, b in enumerate(bottoms) if b >= 0]
    if not filled:
        raise ValueError('整張圖都是透明的')
    overall_bottom = max(bottoms)

    # 照片＝畫面最低的那一塊（右側），文字底線＝照片以外的最低點
    photo_cols = [x for x, b in enumerate(bottoms) if b >= overall_bottom - PHOTO_BAND]
    photo_left = min(photo_cols)
    text_bottom = max(b for x, b in enumerate(bottoms) if 0 <= x < photo_left and b >= 0)

    # 底部先切掉，再重新算左右上的透明邊（照片被裁短後外框可能縮小）
    cropped_top = im.crop((0, 0, w, text_bottom + 1))
    box = cropped_top.getbbox()  # 依 alpha>0 抓，保留反鋸齒邊緣
    return box


def process(src, month, out_dir, height, slim=False, dry=False):
    im = Image.open(src).convert('RGBA')
    box = content_box(im)
    crop = im.crop(box)
    cw, ch = crop.size

    out_w = max(1, round(cw * height / ch))
    out = crop.resize((out_w, height), Image.LANCZOS)

    name = f'title-{month:02d}{"-slim" if slim else ""}.webp'
    dest = os.path.join(out_dir, name)
    print(f'{os.path.basename(src)} → {dest}  {out_w}x{height}'
          + ('  (dry)' if dry else ''))
    if not dry:
        os.makedirs(out_dir, exist_ok=True)
        out.save(dest, 'WEBP', quality=QUALITY, method=6)


def main():
    args = sys.argv[1:]
    dry = '--dry' in args
    slim = '--slim' in args
    args = [a for a in args if a not in ('--dry', '--slim')]
    out_dir = 'images/calendar'
    if '--out' in args:
        i = args.index('--out')
        out_dir = args[i + 1]
        del args[i:i + 2]
    height = (SLIM_HEIGHT or OUT_HEIGHT) if slim else OUT_HEIGHT
    if '--height' in args:
        i = args.index('--height')
        height = int(args[i + 1])
        del args[i:i + 2]

    pairs = []
    for a in args:
        if ':' not in a:
            print(f'參數要寫成 <檔案>:<月份>，收到「{a}」', file=sys.stderr)
            return 1
        path, month = a.rsplit(':', 1)
        pairs.append((path, int(month)))
    if not pairs:
        print(__doc__)
        return 1

    for path, month in pairs:
        process(path, month, out_dir, height, slim, dry)
    return 0


if __name__ == '__main__':
    sys.exit(main())
