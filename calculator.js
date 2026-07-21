// ===================================================================
// calculator.js — 計算機：基本四則運算＋稅率互算（稅率固定 5%）
//
// 載入順序：跟其他拆出模組一樣排在 admin.js 之前（統一規則，見 10-project-map.md §2）。
// 本模組完全自足：不讀 admin.js 的任何全域；切到計算機分頁純粹是顯示 DOM，
// switchView 不會呼叫本檔函式。最外層只有宣告、DOM 事件掛載、
// 以及一個只碰自身 DOM 的 bindTaxCalcInputs IIFE。
// ===================================================================

// ===== 【新】計算機：基本四則運算 + 稅率互算（稅率固定 5%） =====

let calcDisplayValue = '0';
let calcPrevValue = null;
let calcOperator = null;
let calcWaitingForOperand = false;

function calcRenderDisplay() {
  const el = document.getElementById('calcDisplay');
  if (el) el.textContent = calcDisplayValue;
}

function calcFormatNumber(n) {
  if (!isFinite(n)) return '錯誤';
  // 避免浮點數運算誤差跑出一長串小數（例如 0.1+0.2 變成 0.30000000000000004）
  const rounded = Math.round(n * 1e8) / 1e8;
  return String(rounded);
}

function calcInputDigit(d) {
  if (calcWaitingForOperand) {
    calcDisplayValue = d;
    calcWaitingForOperand = false;
  } else {
    calcDisplayValue = calcDisplayValue === '0' ? d : calcDisplayValue + d;
  }
  calcRenderDisplay();
}

function calcInputDecimal() {
  if (calcWaitingForOperand) {
    calcDisplayValue = '0.';
    calcWaitingForOperand = false;
    calcRenderDisplay();
    return;
  }
  if (calcDisplayValue.indexOf('.') === -1) {
    calcDisplayValue += '.';
    calcRenderDisplay();
  }
}

function calcClear() {
  calcDisplayValue = '0';
  calcPrevValue = null;
  calcOperator = null;
  calcWaitingForOperand = false;
  calcRenderDisplay();
}

function calcBackspace() {
  if (calcWaitingForOperand) return;
  calcDisplayValue = calcDisplayValue.length > 1 ? calcDisplayValue.slice(0, -1) : '0';
  calcRenderDisplay();
}

function calcInputPercent() {
  const val = parseFloat(calcDisplayValue);
  if (isNaN(val)) return;
  calcDisplayValue = calcFormatNumber(val / 100);
  calcRenderDisplay();
}

function calcCompute(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function calcPerformOperation(nextOperator) {
  const inputValue = parseFloat(calcDisplayValue);
  if (isNaN(inputValue)) return;

  if (calcPrevValue === null) {
    calcPrevValue = inputValue;
  } else if (calcOperator) {
    const result = calcCompute(calcPrevValue, inputValue, calcOperator);
    calcDisplayValue = calcFormatNumber(result);
    calcPrevValue = result;
    calcRenderDisplay();
  }

  calcWaitingForOperand = true;
  calcOperator = nextOperator === '=' ? null : nextOperator;
}

// ---- 稅率互算：未稅金額／稅額／含稅金額，輸入任一欄自動算另外兩欄（四捨五入到整數元） ----
const TAX_RATE = 0.05;

function taxRound(n) {
  return Math.round(n);
}

(function bindTaxCalcInputs() {
  const preEl = document.getElementById('taxPreInput');
  const amtEl = document.getElementById('taxAmtInput');
  const incEl = document.getElementById('taxIncInput');
  if (!preEl || !amtEl || !incEl) return;

  preEl.addEventListener('input', () => {
    const pre = parseFloat(preEl.value);
    if (isNaN(pre)) { amtEl.value = ''; incEl.value = ''; return; }
    const amt = taxRound(pre * TAX_RATE);
    amtEl.value = amt;
    incEl.value = taxRound(pre + amt);
  });

  amtEl.addEventListener('input', () => {
    const amt = parseFloat(amtEl.value);
    if (isNaN(amt)) { preEl.value = ''; incEl.value = ''; return; }
    const pre = taxRound(amt / TAX_RATE);
    preEl.value = pre;
    incEl.value = taxRound(pre + amt);
  });

  incEl.addEventListener('input', () => {
    const inc = parseFloat(incEl.value);
    if (isNaN(inc)) { preEl.value = ''; amtEl.value = ''; return; }
    const pre = taxRound(inc / (1 + TAX_RATE));
    const amt = taxRound(inc - pre);
    preEl.value = pre;
    amtEl.value = amt;
  });
})();
