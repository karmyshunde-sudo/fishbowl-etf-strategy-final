// 导入配置
import { CONFIG } from "./config.js";

// 每日推送状态（避免重复推送）
let dailyStatus = {
  poolPushed: false,      // 股票池是否已推送
  strategyPushed: false   // 策略结果是否已推送
};

/**
 * 重置每日推送状态（北京时间0点）
 */
function resetDailyStatus() {
  const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
  if (now.getHours() === 0) { // 每天0点重置
    dailyStatus = { poolPushed: false, strategyPushed: false };
    console.log("每日推送状态已重置");
  }
}

/**
 * 发送单条消息到企业微信
 * @param {string} content - 消息内容
 * @returns {boolean} 是否成功
 */
export async function sendMessage(content) {
  resetDailyStatus(); // 先检查是否需要重置状态
  
  // 生成北京时间字符串
  const beijingTime = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET)
    .toLocaleString("zh-CN", { 
      year: "numeric", 
      month: "2-digit", 
      day: "2-digit", 
      hour: "2-digit", 
      minute: "2-digit", 
      second: "2-digit",
      hour12: false 
    });
  
  // 拼接完整消息（带系统时间）
  const fullContent = `CF系统时间：${beijingTime}\n${content}`;
  
  try {
    // 发送POST请求到企业微信机器人
    const res = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: fullContent }
      })
    });
    
    // 检查响应状态
    if (!res.ok) {
      throw new Error(`响应状态码：${res.status}`);
    }
    
    console.log("消息发送成功");
    return true;
  } catch (e) {
    console.error("消息发送失败：", e.message);
    return false;
  }
}

/**
 * 推送股票池消息（每条间隔1分钟）
 * @param {Array} pool - 股票池数据
 */
export async function pushPool(pool) {
  if (dailyStatus.poolPushed) {
    console.log("今日股票池已推送，跳过");
    return;
  }
  
  try {
    // 逐条推送
    for (const [index, etf] of pool.entries()) {
      const content = `【股票池${index + 1}/${pool.length}】\n` +
        `代码：${etf.code}\n` +
        `名称：${etf.name}\n` +
        `价格：${etf.price.toFixed(2)}元\n` +
        `涨跌幅：${etf.change.toFixed(2)}%\n` +
        `类型：${etf.type}`;
      
      // 发送消息
      const success = await sendMessage(content);
      if (!success) {
        console.warn(`第${index + 1}条股票池消息发送失败，继续下一条`);
      }
      
      // 间隔1分钟（60000毫秒）
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    
    dailyStatus.poolPushed = true;
    console.log("股票池推送完成");
  } catch (e) {
    console.error("股票池推送异常：", e.message);
  }
}

/**
 * 推送策略结果消息（每条间隔1分钟）
 * @param {Array} results - 策略建议
 */
export async function pushStrategyResults(results) {
  if (dailyStatus.strategyPushed) {
    console.log("今日策略结果已推送，跳过");
    return;
  }
  
  try {
    if (results.length === 0) {
      // 无操作建议也需推送
      await sendMessage("策略执行完成，无操作建议");
      dailyStatus.strategyPushed = true;
      return;
    }
    
    // 逐条推送
    for (const res of results) {
      const content = `【${res.type}操作】\n` +
        `${res.operation} ${res.code} ${res.name}\n` +
        `价格：${res.price.toFixed(2)}元\n` +
        `数量：${res.shares}份\n` +
        `金额：${res.amount}元\n` +
        `原因：${res.reason}`;
      
      const success = await sendMessage(content);
      if (!success) {
        console.warn(`${res.code}的${res.operation}消息发送失败，继续下一条`);
      }
      
      // 间隔1分钟
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    
    dailyStatus.strategyPushed = true;
    console.log("策略结果推送完成");
  } catch (e) {
    console.error("策略结果推送异常：", e.message);
  }
}