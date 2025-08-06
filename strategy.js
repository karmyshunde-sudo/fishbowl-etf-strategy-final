// 导入配置和工具函数（PDF中鱼盆模型实战策略）
import { CONFIG } from "./config.js";
import { getPool } from "./poolManager.js";
import { calculateMA, isBuySignal, isAddSignal, isSellSignal } from "./indicator.js";

// 当前持仓结构（记录持仓信息和技术指标，PDF1-56节仓位管理）
let holdings = {
  稳健型: { // 宽基ETF，PDF1-48节核心资产
    position: null, // 持仓信息（code/name/price等）
    priceHistory: [], // 价格历史（用于计算均线）
    volumeHistory: [], // 成交量历史
    buySteps: 0, // 已加仓次数（0:未持仓，1:首次建仓，2:加1次，3:加2次）
    totalShares: 0 // 总持仓数量
  },
  激进型: { // 行业ETF，PDF1-49节卫星资产
    position: null,
    priceHistory: [],
    volumeHistory: [],
    buySteps: 0,
    totalShares: 0
  }
};

/**
 * 执行鱼盆模型策略（含买入、卖出、加仓、调仓，PDF核心策略）
 * @returns {Array} 操作建议
 */
export async function executeStrategy() {
  try {
    // 获取当前股票池
    const pool = await getPool();
    if (pool.length === 0) {
      throw new Error("股票池为空，无法执行策略");
    }
    
    const suggestions = [];
    
    // 处理稳健型（宽基ETF）和激进型（行业ETF）
    suggestions.push(...handleType("稳健型", pool.filter(e => e.type === "宽基")));
    suggestions.push(...handleType("激进型", pool.filter(e => e.type === "行业")));
    
    return suggestions;
  } catch (e) {
    console.error("策略执行失败：", e.message);
    return []; // 返回空建议，避免中断流程
  }
}

/**
 * 处理单类型持仓（稳健型/激进型，PDF1-56节仓位管理）
 * @param {string} type - 持仓类型
 * @param {Array} candidates - 候选ETF列表
 * @returns {Array} 操作建议
 */
function handleType(type, candidates) {
  const suggestions = [];
  const holding = holdings[type];
  // 验证候选列表有效性
  if (candidates.length === 0) {
    console.warn(`【${type}】候选ETF为空，跳过处理`);
    return suggestions;
  }
  const bestCandidate = candidates[0]; // 最高分候选ETF
  
  // 更新价格和成交量历史（保留最近30条数据，用于计算均线）
  updateHistory(holding, bestCandidate);
  
  // 情况1：无持仓，且出现买入信号（突破20日均线，PDF1-53节）
  if (!holding.position && isBuySignal({
    price: bestCandidate.price,
    volume: bestCandidate.volume,
    priceHistory: holding.priceHistory,
    volumeHistory: holding.volumeHistory
  })) {
    const initialRatio = CONFIG.POSITION.INITIAL_RATIO;
    const shares = calculateShares(type, initialRatio, bestCandidate.price);
    
    suggestions.push({
      type,
      operation: "买入",
      code: bestCandidate.code,
      name: bestCandidate.name,
      price: bestCandidate.price,
      shares,
      amount: (shares * bestCandidate.price).toFixed(2),
      reason: "突破20日均线，符合鱼盆模型买入信号（PDF1-53节）"
    });
    
    // 更新持仓信息
    holding.position = { ...bestCandidate };
    holding.buySteps = 1;
    holding.totalShares = shares;
  }
  
  // 情况2：已有持仓，且满足加仓条件（回调至短期均线，PDF1-78节）
  else if (holding.position && holding.buySteps > 0 && 
           holding.buySteps <= CONFIG.POSITION.ADD_STEPS.length) {
    // 当前加仓步骤（0-based索引）
    const currentStep = holding.buySteps - 1;
    
    // 检查是否满足加仓信号
    if (isAddSignal({
      price: bestCandidate.price,
      volume: bestCandidate.volume,
      priceHistory: holding.priceHistory,
      volumeHistory: holding.volumeHistory
    }, currentStep)) {
      const addRatio = CONFIG.POSITION.ADD_STEPS[currentStep];
      const shares = calculateShares(type, addRatio, bestCandidate.price);
      
      suggestions.push({
        type,
        operation: "加仓",
        code: bestCandidate.code,
        name: bestCandidate.name,
        price: bestCandidate.price,
        shares,
        amount: (shares * bestCandidate.price).toFixed(2),
        reason: `回调至${CONFIG.POSITION.RETRACE_LEVELS[currentStep]}日均线缩量，符合加仓条件（PDF1-78节）`
      });
      
      // 更新持仓信息
      holding.buySteps += 1;
      holding.totalShares += shares;
    }
  }
  
  // 情况3：持仓ETF跌破20日均线（卖出信号，PDF1-54节）
  else if (holding.position && isSellSignal({
    price: bestCandidate.price,
    priceHistory: holding.priceHistory
  })) {
    // 全部卖出
    suggestions.push({
      type,
      operation: "卖出",
      code: holding.position.code,
      name: holding.position.name,
      price: bestCandidate.price,
      shares: holding.totalShares,
      amount: (holding.totalShares * bestCandidate.price).toFixed(2),
      reason: "跌破20日均线，符合鱼盆模型卖出信号（PDF1-54节）"
    });
    
    // 清空持仓
    resetHolding(type);
  }
  
  // 情况4：调仓逻辑（有持仓但非最优候选，PDF1-148节触发式调仓）
  else if (holding.position && holding.position.code !== bestCandidate.code) {
    // 调仓条件1：原持仓触发卖出信号
    const shouldSellOld = isSellSignal({
      price: holding.position.price,
      priceHistory: holding.priceHistory
    });
    
    // 调仓条件2：新候选触发买入信号
    // 合并历史数据（确保均线计算准确）
    const newPriceHistory = [bestCandidate.price, ...holding.priceHistory.slice(0, 29)];
    const newVolumeHistory = [bestCandidate.volume, ...holding.volumeHistory.slice(0, 29)];
    const shouldBuyNew = isBuySignal({
      price: bestCandidate.price,
      volume: bestCandidate.volume,
      priceHistory: newPriceHistory,
      volumeHistory: newVolumeHistory
    });
    
    // 同时满足两个条件则调仓（先卖后买，PDF1-148节）
    if (shouldSellOld && shouldBuyNew) {
      // 先卖旧持仓
      suggestions.push({
        type,
        operation: "卖出",
        code: holding.position.code,
        name: holding.position.name,
        price: holding.position.price,
        shares: holding.totalShares,
        amount: (holding.totalShares * holding.position.price).toFixed(2),
        reason: "原持仓跌破20日均线，触发调仓卖出（PDF1-148节）"
      });
      
      // 再买新候选（按初始比例建仓）
      const initialRatio = CONFIG.POSITION.INITIAL_RATIO;
      const shares = calculateShares(type, initialRatio, bestCandidate.price);
      suggestions.push({
        type,
        operation: "买入",
        code: bestCandidate.code,
        name: bestCandidate.name,
        price: bestCandidate.price,
        shares,
        amount: (shares * bestCandidate.price).toFixed(2),
        reason: "新候选突破20日均线，触发调仓买入（PDF1-148节）"
      });
      
      // 更新持仓为新候选
      holding.position = { ...bestCandidate };
      holding.priceHistory = newPriceHistory;
      holding.volumeHistory = newVolumeHistory;
      holding.buySteps = 1;
      holding.totalShares = shares;
    }
  }
  
  return suggestions;
}

/**
 * 更新价格和成交量历史（用于均线计算）
 * @param {Object} holding - 持仓对象
 * @param {Object} etf - 最新ETF数据
 */
function updateHistory(holding, etf) {
  // 插入最新价格（保持数组长度不超过30）
  holding.priceHistory.unshift(etf.price);
  if (holding.priceHistory.length > 30) holding.priceHistory.pop();
  
  // 插入最新成交量
  holding.volumeHistory.unshift(etf.volume);
  if (holding.volumeHistory.length > 30) holding.volumeHistory.pop();
}

/**
 * 计算买入数量（按资金比例，PDF1-61节分批建仓）
 * @param {string} type - 持仓类型
 * @param {number} ratio - 资金比例
 * @param {number} price - 买入价格
 * @returns {number} 买入数量（100的倍数，ETF最小交易单位）
 */
function calculateShares(type, ratio, price) {
  // 计算该类型的总分配资金
  const totalCapital = CONFIG.CAPITAL.INITIAL * CONFIG.CAPITAL.ALLOCATION[type];
  // 按比例计算本次买入金额
  const buyAmount = totalCapital * ratio;
  // 计算数量（100的倍数，ETF最小交易单位为100份）
  const shares = Math.floor(buyAmount / price / 100) * 100;
  // 确保数量为正数
  return Math.max(100, shares); // 至少买入100份
}

/**
 * 重置持仓信息
 * @param {string} type - 持仓类型
 */
function resetHolding(type) {
  holdings[type] = {
    position: null,
    priceHistory: [],
    volumeHistory: [],
    buySteps: 0,
    totalShares: 0
  };
}

/**
 * 重置所有持仓（测试用）
 */
export function resetAllHoldings() {
  resetHolding("稳健型");
  resetHolding("激进型");
}