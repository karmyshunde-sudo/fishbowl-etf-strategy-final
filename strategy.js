import { CONFIG } from "./config.js";
import { getPool } from "./poolManager.js";
import { calculateMA, isBuySignal, isAddSignal, isSellSignal } from "./indicator.js";
import { recordTrade } from "./testUtils.js";

let holdings = {
  稳健型: {
    position: null,
    priceHistory: [],
    volumeHistory: [],
    buySteps: 0,
    totalShares: 0
  },
  激进型: {
    position: null,
    priceHistory: [],
    volumeHistory: [],
    buySteps: 0,
    totalShares: 0
  }
};

export async function executeStrategy() {
  try {
    const pool = await getPool();
    if (pool.length === 0) {
      throw new Error("股票池为空，无法执行策略");
    }
    
    const suggestions = [];
    
    suggestions.push(...handleType("稳健型", pool.filter(e => e.type === "宽基")));
    suggestions.push(...handleType("激进型", pool.filter(e => e.type === "行业")));
    
    return suggestions;
  } catch (e) {
    console.error("策略执行失败：", e.message);
    return [];
  }
}

function handleType(type, candidates) {
  const suggestions = [];
  const holding = holdings[type];
  if (candidates.length === 0) {
    console.warn(`【${type}】候选ETF为空，跳过处理`);
    return suggestions;
  }
  const bestCandidate = candidates[0];
  
  updateHistory(holding, bestCandidate);
  
  // 情况1：无持仓，且出现买入信号
  if (!holding.position && isBuySignal({
    price: bestCandidate.price,
    volume: bestCandidate.volume,
    priceHistory: holding.priceHistory,
    volumeHistory: holding.volumeHistory
  })) {
    const initialRatio = CONFIG.POSITION.INITIAL_RATIO;
    const shares = calculateShares(type, initialRatio, bestCandidate.price);
    
    const buyInfo = {
      type,
      operation: "买入",
      code: bestCandidate.code,
      name: bestCandidate.name,
      price: bestCandidate.price,
      shares,
      amount: (shares * bestCandidate.price).toFixed(2),
      reason: "突破20日均线，符合鱼盆模型买入信号（PDF1-53节）"
    };
    suggestions.push(buyInfo);
    recordTrade({
      type: buyInfo.type,
      operation: buyInfo.operation,
      code: buyInfo.code,
      amount: buyInfo.amount
    });
    
    holding.position = { ...bestCandidate };
    holding.buySteps = 1;
    holding.totalShares = shares;
  }
  
  // 情况2：已有持仓，且满足加仓条件
  else if (holding.position && holding.buySteps > 0 && 
           holding.buySteps <= CONFIG.POSITION.ADD_STEPS.length) {
    const currentStep = holding.buySteps - 1;
    
    if (isAddSignal({
      price: bestCandidate.price,
      volume: bestCandidate.volume,
      priceHistory: holding.priceHistory,
      volumeHistory: holding.volumeHistory
    }, currentStep)) {
      const addRatio = CONFIG.POSITION.ADD_STEPS[currentStep];
      const shares = calculateShares(type, addRatio, bestCandidate.price);
      
      const addInfo = {
        type,
        operation: "加仓",
        code: bestCandidate.code,
        name: bestCandidate.name,
        price: bestCandidate.price,
        shares,
        amount: (shares * bestCandidate.price).toFixed(2),
        reason: `回调至${CONFIG.POSITION.RETRACE_LEVELS[currentStep]}日均线缩量，符合加仓条件（PDF1-78节）`
      };
      suggestions.push(addInfo);
      recordTrade({
        type: addInfo.type,
        operation: addInfo.operation,
        code: addInfo.code,
        amount: addInfo.amount
      });
      
      holding.buySteps += 1;
      holding.totalShares += shares;
    }
  }
  
  // 情况3：持仓ETF跌破20日均线（卖出信号）
  else if (holding.position && isSellSignal({
    price: bestCandidate.price,
    priceHistory: holding.priceHistory
  })) {
    const sellInfo = {
      type,
      operation: "卖出",
      code: holding.position.code,
      name: holding.position.name,
      price: bestCandidate.price,
      shares: holding.totalShares,
      amount: (holding.totalShares * bestCandidate.price).toFixed(2),
      reason: "跌破20日均线，符合鱼盆模型卖出信号（PDF1-54节）"
    };
    suggestions.push(sellInfo);
    recordTrade({
      type: sellInfo.type,
      operation: sellInfo.operation,
      code: sellInfo.code,
      amount: sellInfo.amount
    });
    
    resetHolding(type);
  }
  
  // 情况4：调仓逻辑
  else if (holding.position && holding.position.code !== bestCandidate.code) {
    const shouldSellOld = isSellSignal({
      price: holding.position.price,
      priceHistory: holding.priceHistory
    });
    
    const newPriceHistory = [bestCandidate.price, ...holding.priceHistory.slice(0, 29)];
    const newVolumeHistory = [bestCandidate.volume, ...holding.volumeHistory.slice(0, 29)];
    const shouldBuyNew = isBuySignal({
      price: bestCandidate.price,
      volume: bestCandidate.volume,
      priceHistory: newPriceHistory,
      volumeHistory: newVolumeHistory
    });
    
    if (shouldSellOld && shouldBuyNew) {
      const sellOldInfo = {
        type,
        operation: "卖出",
        code: holding.position.code,
        name: holding.position.name,
        price: holding.position.price,
        shares: holding.totalShares,
        amount: (holding.totalShares * holding.position.price).toFixed(2),
        reason: "原持仓跌破20日均线，触发调仓卖出（PDF1-148节）"
      };
      suggestions.push(sellOldInfo);
      recordTrade({
        type: sellOldInfo.type,
        operation: sellOldInfo.operation,
        code: sellOldInfo.code,
        amount: sellOldInfo.amount
      });
      
      const buyNewInfo = {
        type,
        operation: "买入",
        code: bestCandidate.code,
        name: bestCandidate.name,
        price: bestCandidate.price,
        shares: calculateShares(type, CONFIG.POSITION.INITIAL_RATIO, bestCandidate.price),
        amount: (calculateShares(type, CONFIG.POSITION.INITIAL_RATIO, bestCandidate.price) * bestCandidate.price).toFixed(2),
        reason: "新候选突破20日均线，触发调仓买入（PDF1-148节）"
      };
      suggestions.push(buyNewInfo);
      recordTrade({
        type: buyNewInfo.type,
        operation: buyNewInfo.operation,
        code: buyNewInfo.code,
        amount: buyNewInfo.amount
      });
      
      holding.position = { ...bestCandidate };
      holding.priceHistory = newPriceHistory;
      holding.volumeHistory = newVolumeHistory;
      holding.buySteps = 1;
      holding.totalShares = buyNewInfo.shares;
    }
  }
  
  return suggestions;
}

function updateHistory(holding, etf) {
  holding.priceHistory.unshift(etf.price);
  if (holding.priceHistory.length > 30) holding.priceHistory.pop();
  
  holding.volumeHistory.unshift(etf.volume);
  if (holding.volumeHistory.length > 30) holding.volumeHistory.pop();
}

function calculateShares(type, ratio, price) {
  const totalCapital = CONFIG.CAPITAL.INITIAL * CONFIG.CAPITAL.ALLOCATION[type];
  const buyAmount = totalCapital * ratio;
  const shares = Math.floor(buyAmount / price / 100) * 100;
  return Math.max(100, shares);
}

function resetHolding(type) {
  holdings[type] = {
    position: null,
    priceHistory: [],
    volumeHistory: [],
    buySteps: 0,
    totalShares: 0
  };
}

export function resetAllHoldings() {
  resetHolding("稳健型");
  resetHolding("激进型");
}
