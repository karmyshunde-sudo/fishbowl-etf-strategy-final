import { CONFIG } from "./config.js";

/**
 * 计算移动平均线（MA），PDF1-7节核心指标
 * @param {Array} prices - 价格数组（最新价格在前）
 * @param {number} period - 周期（如5、10、20）
 * @returns {number|null} 均线值（数据不足时返回null）
 */
export function calculateMA(prices, period) {
  // 过滤无效价格并取最近N个数据
  const validPrices = prices.filter(p => !isNaN(p) && p > 0).slice(0, period);
  // 数据量不足时返回null（避免计算错误）
  if (validPrices.length < period) return null;
  // 计算平均值
  const sum = validPrices.reduce((acc, price) => acc + price, 0);
  return sum / validPrices.length;
}

/**
 * 计算成交量均值（用于验证放量信号，PDF1-206节）
 * @param {Array} volumes - 成交量数组
 * @param {number} period - 周期（默认5）
 * @returns {number|null} 成交量均值
 */
export function calculateVolumeMA(volumes, period = 5) {
  const validVolumes = volumes.filter(v => !isNaN(v) && v > 0).slice(0, period);
  if (validVolumes.length < period) return null;
  const sum = validVolumes.reduce((acc, vol) => acc + vol, 0);
  return sum / validVolumes.length;
}

/**
 * 判断买入信号（突破20日均线，PDF1-53节）
 * @param {Object} etf - ETF数据（含价格、成交量历史）
 * @returns {boolean} 是否满足买入条件
 */
export function isBuySignal(etf) {
  // 计算20日均线
  const ma20 = calculateMA(etf.priceHistory, CONFIG.FISH_BOWL.MA_PERIOD);
  if (!ma20) return false; // 均线数据不足
  
  // 条件1：当前价格突破20日均线
  const priceAboveMA = etf.price > ma20;
  
  // 条件2：20日均线呈上升趋势（近3日递增，PDF1-53节）
  const ma20Day3 = calculateMA(etf.priceHistory.slice(3), CONFIG.FISH_BOWL.MA_PERIOD);
  const ma20Day2 = calculateMA(etf.priceHistory.slice(2), CONFIG.FISH_BOWL.MA_PERIOD);
  const ma20Day1 = calculateMA(etf.priceHistory.slice(1), CONFIG.FISH_BOWL.MA_PERIOD);
  const maUpTrend = ma20Day3 && ma20Day2 && ma20Day1 
    ? (ma20Day3 < ma20Day2 && ma20Day2 < ma20Day1) 
    : false;
  
  // 条件3：成交量放大（较5日均量放大20%以上，PDF1-206节）
  const volumeMA5 = calculateVolumeMA(etf.volumeHistory);
  const volumeQualified = volumeMA5 
    ? etf.volume >= volumeMA5 * CONFIG.FISH_BOWL.VOLUME_THRESHOLD 
    : false;
  
  // 所有条件满足则返回true
  return priceAboveMA && maUpTrend && volumeQualified;
}

/**
 * 判断加仓信号（回调至短期均线且缩量，PDF1-78节）
 * @param {Object} etf - ETF数据
 * @param {number} step - 加仓步骤（0:5日线，1:10日线）
 * @returns {boolean} 是否满足加仓条件
 */
export function isAddSignal(etf, step) {
  // 计算目标均线（5日或10日）
  const maPeriod = CONFIG.POSITION.RETRACE_LEVELS[step];
  const ma = calculateMA(etf.priceHistory, maPeriod);
  if (!ma) return false;
  
  // 条件1：处于上升趋势（价格在20日均线上方，PDF1-53节）
  const ma20 = calculateMA(etf.priceHistory, CONFIG.FISH_BOWL.MA_PERIOD);
  const inUptrend = ma20 ? etf.price > ma20 : false;
  
  // 条件2：回调至目标均线附近（偏离度<1%）
  const priceNearMA = Math.abs(etf.price - ma) / ma < 0.01;
  
  // 条件3：缩量回调（成交量较5日均量缩小50%以上，PDF1-78节）
  const volumeMA5 = calculateVolumeMA(etf.volumeHistory);
  const volumeShrink = volumeMA5 ? etf.volume <= volumeMA5 * 0.5 : false;
  
  return inUptrend && priceNearMA && volumeShrink;
}

/**
 * 判断卖出信号（跌破20日均线，PDF1-54节）
 * @param {Object} etf - ETF数据
 * @returns {boolean} 是否满足卖出条件
 */
export function isSellSignal(etf) {
  const ma20 = calculateMA(etf.priceHistory, CONFIG.FISH_BOWL.MA_PERIOD);
  if (!ma20) return false;
  
  // 价格跌破20日均线且偏离度>2%（PDF1-54节止损规则）
  return etf.price < ma20 * (1 - CONFIG.POSITION.SWITCH_THRESHOLD);
}