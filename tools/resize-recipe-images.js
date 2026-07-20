/**
 * 食譜圖片批次轉檔：把手機拍的 jpeg 轉成網站用的 webp，並統一尺寸。
 *
 * 使用者的流程是「手機拍照（jpeg，約 2880x2160）→ 交給 Claude → 轉好放進 images/」，
 * 這支腳本就是中間那一步。
 *
 * 尺寸依據版面實際顯示大小（recipes.html）：
 *   成品圖 .rc-hero-img  → 4:3，版面寬 380px  → 輸出 1200x900
 *   步驟圖 .step-photo   → 1:1，單格僅 108px → 輸出 500x500
 * 版面用 object-fit: cover，所以這裡先置中裁到相同比例，等於把瀏覽器
 * 本來就會做的裁切固定進檔案，畫面不變但省掉多餘的下載量。
 *
 * 用法（sharp 裝在 scratchpad，不要裝進本 repo，避免多出 node_modules）：
 *   npm install sharp            # 在 scratchpad 目錄
 *   node resize-recipe-images.js <來源資料夾> --type=main|step [--dry]
 *
 * 輸出會放在來源資料夾底下的 out/，副檔名一律換成 .webp，不覆蓋來源。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PRESET = {
  main: { w: 1200, h: 900, label: '成品圖 4:3' },
  step: { w: 500, h: 500, label: '步驟圖 1:1' },
};
const QUALITY = 82;

const args = process.argv.slice(2);
const srcDir = args.find(a => !a.startsWith('--'));
const type = (args.find(a => a.startsWith('--type=')) || '').split('=')[1];
const dry = args.includes('--dry');

if (!srcDir || !PRESET[type]) {
  console.error('用法: node resize-recipe-images.js <來源資料夾> --type=main|step [--dry]');
  process.exit(1);
}

const { w, h, label } = PRESET[type];
const outDir = path.join(srcDir, 'out');

(async () => {
  const files = fs.readdirSync(srcDir)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .filter(f => fs.statSync(path.join(srcDir, f)).isFile());

  if (!files.length) return console.log('來源資料夾沒有圖片檔。');
  if (!dry) fs.mkdirSync(outDir, { recursive: true });
  console.log(`${label} → ${w}x${h}${dry ? '（試跑，不寫檔）' : ''}\n`);

  for (const f of files) {
    // 先讀進記憶體再交給 sharp：Windows 下讓 sharp 直接讀檔會持有 handle，
    // 之後寫回同路徑會 EBUSY。
    const input = fs.readFileSync(path.join(srcDir, f));
    const meta = await sharp(input).metadata();
    const buf = await sharp(input)
      .resize(w, h, { fit: 'cover', position: 'center' })
      .webp({ quality: QUALITY })
      .toBuffer();

    const outName = f.replace(/\.(jpe?g|png|webp)$/i, '.webp');
    if (!dry) fs.writeFileSync(path.join(outDir, outName), buf);

    // 被裁掉的比例，用來提醒哪幾張構圖風險高
    const srcAR = meta.width / meta.height, dstAR = w / h;
    const pct = Math.round((1 - Math.min(srcAR, dstAR) / Math.max(srcAR, dstAR)) * 100);
    const axis = srcAR > dstAR ? '左右' : '上下';
    console.log(
      `${outName.padEnd(44)} ${meta.width}x${meta.height} → ${w}x${h}  ` +
      `${Math.round(input.length / 1024)}KB → ${Math.round(buf.length / 1024)}KB  ` +
      (pct > 0 ? `裁${axis} ${pct}%` : '無裁切')
    );
  }

  if (!dry) console.log(`\n完成，輸出於 ${outDir}`);
  console.log('裁切比例高的（>30%）建議人工看過，置中裁可能切到重點食材。');
})();
