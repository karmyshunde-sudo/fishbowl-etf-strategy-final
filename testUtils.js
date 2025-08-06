// 模拟交易流水记录（实际项目可对接数据库）
let tradeHistory = [];

/**
 * 记录交易流水（在strategy.js的买卖操作中调用）
 * @param {Object} trade - 交易信息
 */
export function recordTrade(trade) {
  tradeHistory.push({
    id: Date.now(), // 唯一ID
    time: new Date().toLocaleString(), // 时间
    ...trade // 包含类型、操作、代码、金额等信息
  });
  // 保留最近100条记录
  if (tradeHistory.length > 100) tradeHistory.shift();
}

/**
 * 打印交易流水
 * @returns {Array} 交易流水列表
 */
export function printTradeHistory() {
  return tradeHistory;
}

/**
 * 获取当前股票池（供手动推送测试）
 * @returns {Promise<Array>} 股票池数据
 */
export async function getCurrentPool() {
  const { getPool } = await import("./poolManager.js");
  return getPool();
}