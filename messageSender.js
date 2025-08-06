// 导入配置（包含企业微信Webhook地址及时区设置，PDF附录B配置规范）
import { CONFIG } from "./config.js";

// 每日推送状态（避免重复推送，PDF4-2节执行控制机制）
let dailyStatus = {
  poolPushed: false,      // 股票池是否已推送（每日仅推1次）
  strategyPushed: false   // 策略结果是否已推送（每日仅推1次）
};

/**
 * 重置每日推送状态（北京时间0点自动重置，PDF4-3节周期控制）
 * 确保每日状态不跨天累积，符合"每日一次"的业务规则
 */
function resetDailyStatus() {
  const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
  // 每天0点整重置状态（精确到小时，避免频繁判断）
  if (now.getHours() === 0) { 
    dailyStatus = { poolPushed: false, strategyPushed: false };
    console.log("每日推送状态已重置（符合PDF4-3节周期控制要求）");
  }
}

/**
 * 计算消息实际长度（适配企业微信限制，PDF4-5节消息规范）
 * 中文/英文/数字均按企业微信计数规则（1字符=1长度）
 * @param {string} str - 待计算的消息内容
 * @returns {number} 消息长度（字节数）
 */
function getMessageLength(str) {
  // 使用TextEncoder计算UTF-8字节长度，与企业微信计数一致
  return new TextEncoder().encode(str).length;
}

/**
 * 截断超长消息（保留核心信息，PDF4-5节消息长度控制）
 * 企业微信单条文本消息最大长度为2048字符
 * @param {string} content - 原始消息内容
 * @returns {string} 截断后的安全内容（含截断提示）
 */
function truncateMessage(content) {
  const MAX_LENGTH = 2048; // 企业微信官方限制
  if (getMessageLength(content) <= MAX_LENGTH) {
    return content; // 未超限直接返回
  }

  // 二分法精准截断（避免暴力截断导致的乱码）
  let start = 0;
  let end = content.length;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    const testStr = content.slice(0, mid);
    if (getMessageLength(testStr) <= MAX_LENGTH) {
      start = mid + 1;
    } else {
      end = mid - 1;
    }
  }

  // 保留核心内容并添加截断提示（提升用户体验）
  const safeContent = content.slice(0, start);
  return `${safeContent}\n\n【内容已截断，完整信息见后续消息】`;
}

/**
 * 发送单条消息到企业微信（基础通信函数，PDF4-1节消息通道）
 * 包含完整错误处理与日志记录，确保可追溯
 * @param {string} content - 消息内容（自动处理超长情况）
 * @returns {boolean} 发送是否成功
 */
export async function sendMessage(content) {
  resetDailyStatus(); // 先检查是否需要重置每日状态（PDF4-3节周期控制）
  
  // 生成标准北京时间字符串（带年月日时分秒，PDF4-4节时间规范）
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
  
  // 拼接完整消息（带系统时间，便于追溯，PDF4-4节日志规范）
  let fullContent = `CF系统时间：${beijingTime}\n${content}`;
  
  // 处理超长消息（自动截断，符合PDF4-5节长度限制）
  fullContent = truncateMessage(fullContent);
  
  try {
    // 发送POST请求到企业微信机器人接口
    const response = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json; charset=utf-8", // 强制UTF-8编码
        "User-Agent": "Mozilla/5.0" // 模拟浏览器请求，避免接口拦截
      },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: fullContent } // 严格匹配企业微信文本消息格式
      }),
      timeout: 10000 // 10秒超时控制（避免长期阻塞，PDF5-3节超时策略）
    });
    
    // 解析响应结果（企业微信返回JSON格式，含错误码）
    const result = await response.json();
    
    // 检查接口返回状态（错误码0为成功，PDF4-6节错误处理）
    if (result.errcode !== 0) {
      throw new Error(`微信接口错误（${result.errcode}）：${result.errmsg}`);
    }
    
    console.log("单条消息发送成功（内容长度：" + getMessageLength(fullContent) + "）");
    return true;
  } catch (e) {
    console.error("单条消息发送失败：" + e.message);
    return false; // 失败时返回false，由调用方决定是否重试
  }
}

/**
 * 推送股票池消息（逐条发送，带间隔控制，PDF1-12节信息发布规范）
 * 每日仅推送1次，每条间隔1分钟避免触发频率限制
 * @param {Array} pool - 股票池数据（含code/name/price/change/type字段）
 */
export async function pushPool(pool) {
  // 检查是否已推送（避免重复，PDF4-2节执行控制）
  if (dailyStatus.poolPushed) {
    console.log("今日股票池已推送，跳过本次执行（符合每日1次规则）");
    return;
  }
  
  // 验证股票池数据有效性（避免空数据推送，PDF2-3节数据校验）
  if (!Array.isArray(pool) || pool.length === 0) {
    console.error("股票池数据无效（空数组或非数组），取消推送");
    return;
  }
  
  try {
    // 逐条推送股票池信息（用户易读，PDF4-1节消息展示规范）
    for (const [index, etf] of pool.entries()) {
      // 验证单条ETF数据完整性（避免字段缺失导致的展示异常）
      if (!etf.code || !etf.name || isNaN(etf.price) || isNaN(etf.change)) {
        console.warn(`第${index + 1}条ETF数据不完整，跳过推送`);
        continue;
      }
      
      // 构建标准化消息内容（突出核心字段，PDF1-12节信息优先级）
      const content = `【股票池 ${index + 1}/${pool.length}】\n` +
        `代码：${etf.code}\n` +
        `名称：${etf.name}\n` +
        `价格：${etf.price.toFixed(2)}元\n` +
        `涨跌幅：${etf.change.toFixed(2)}%\n` +
        `类型：${etf.type || "未知"}`;
      
      // 发送单条消息（自动处理超长情况）
      const success = await sendMessage(content);
      if (!success) {
        console.warn(`第${index + 1}条股票池消息发送失败，继续下一条`);
      }
      
      // 间隔1分钟（60000毫秒），规避企业微信频率限制（PDF4-5节）
      if (index < pool.length - 1) { // 最后一条不间隔
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
    
    // 全部发送完成后标记状态（确保每日仅1次，PDF4-2节）
    dailyStatus.poolPushed = true;
    console.log(`股票池推送完成（共${pool.length}条，符合每日1次规则）`);
  } catch (e) {
    console.error("股票池推送异常中断：" + e.message);
    // 异常时不标记为已推送，允许后续重试（容错机制，PDF5-2节）
  }
}

/**
 * 推送策略结果消息（逐条发送，带间隔控制，PDF3-5节策略输出规范）
 * 每日仅推送1次，支持无操作建议场景
 * @param {Array} results - 策略建议数组（含operation/code/name等字段）
 */
export async function pushStrategyResults(results) {
  // 检查是否已推送（避免重复，PDF4-2节执行控制）
  if (dailyStatus.strategyPushed) {
    console.log("今日策略结果已推送，跳过本次执行（符合每日1次规则）");
    return;
  }
  
  try {
    // 处理无操作建议场景（明确告知用户，PDF3-5节空结果处理）
    if (!Array.isArray(results) || results.length === 0) {
      await sendMessage("【策略执行结果】\n本次无操作建议（市场条件未触发交易信号）");
      dailyStatus.strategyPushed = true;
      console.log("无策略结果，已推送空操作提示");
      return;
    }
    
    // 逐条推送策略建议（用户易读，PDF4-1节消息展示规范）
    for (const [index, res] of results.entries()) {
      // 验证单条策略数据完整性（避免字段缺失）
      if (!res.operation || !res.code || !res.name || isNaN(res.price)) {
        console.warn(`第${index + 1}条策略数据不完整，跳过推送`);
        continue;
      }
      
      // 构建标准化消息内容（突出操作类型和原因，PDF3-5节）
      const content = `【${res.type || "策略"}操作 ${index + 1}/${results.length}】\n` +
        `${res.operation} ${res.code} ${res.name}\n` +
        `价格：${res.price.toFixed(2)}元\n` +
        `数量：${res.shares || "未知"}份\n` +
        `金额：${res.amount || "未知"}元\n` +
        `原因：${res.reason || "无详细原因"}`;
      
      // 发送单条消息（自动处理超长情况）
      const success = await sendMessage(content);
      if (!success) {
        console.warn(`第${index + 1}条策略消息发送失败，继续下一条`);
      }
      
      // 间隔1分钟，规避频率限制（PDF4-5节）
      if (index < results.length - 1) { // 最后一条不间隔
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
    
    // 全部发送完成后标记状态（确保每日仅1次）
    dailyStatus.strategyPushed = true;
    console.log(`策略结果推送完成（共${results.length}条，符合每日1次规则）`);
  } catch (e) {
    console.error("策略结果推送异常中断：" + e.message);
    // 异常时不标记为已推送，允许后续重试（容错机制，PDF5-2节）
  }
}
