// 导入配置（包含企业微信Webhook地址及时区设置，PDF附录B配置规范）
import { CONFIG } from "./config.js";

// 每日推送状态（避免重复推送，PDF4-2节执行控制机制）
let dailyStatus = {
  poolPushed: false,      // ETF池是否已推送（每日仅推1次）
  strategyPushed: false   // 策略结果是否已推送（每日仅推1次）
};

/**
 * 重置每日推送状态（北京时间0点自动重置，PDF4-3节周期控制）
 * 确保每日状态不跨天累积，符合"每日一次"的业务规则
 */
function resetDailyStatus() {
  const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
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
  return new TextEncoder().encode(str).length;
}

/**
 * 截断超长消息（保留核心信息，PDF4-5节消息长度控制）
 * 企业微信单条文本消息最大长度为2048字符
 * @param {string} content - 原始消息内容
 * @returns {string} 截断后的安全内容（含截断提示）
 */
function truncateMessage(content) {
  const MAX_LENGTH = 2048;
  if (getMessageLength(content) <= MAX_LENGTH) {
    return content;
  }

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

  const safeContent = content.slice(0, start);
  const truncatedContent = `${safeContent}\n\n【内容已截断，完整信息见后续消息】`;
  console.log(`消息超长处理：原始${getMessageLength(content)}字节 → 截断后${getMessageLength(truncatedContent)}字节`);
  return truncatedContent;
}

/**
 * 发送单条消息到企业微信（基础通信函数，PDF4-1节消息通道）
 * @param {string} content - 消息内容（自动处理超长情况）
 * @returns {boolean} 发送是否成功
 */
export async function sendMessage(content) {
  resetDailyStatus();
  
  const beijingTime = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET)
    .toLocaleString("zh-CN", { 
      year: "numeric", month: "2-digit", day: "2-digit", 
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false 
    });
  
  let fullContent = `CF系统时间：${beijingTime}\n${content}`;
  fullContent = truncateMessage(fullContent);
  
  console.log(`准备发送消息（长度${getMessageLength(fullContent)}字节）：${fullContent.substring(0, 100)}...`);
  
  try {
    const response = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: fullContent }
      }),
      timeout: 10000
    });
    
    const result = await response.json();
    console.log(`企业微信接口返回：${JSON.stringify(result)}`);
    
    if (result.errcode !== 0) {
      throw new Error(`微信接口错误（${result.errcode}）：${result.errmsg}`);
    }
    
    console.log("单条消息发送成功（内容长度：" + getMessageLength(fullContent) + "）");
    return true;
  } catch (e) {
    console.error("单条消息发送失败：" + e.message + "（完整内容前100字符：" + fullContent.substring(0, 100) + "）");
    return false;
  }
}

/**
 * 推送ETF池消息（单条ETF对应一条消息，严格1分钟间隔）
 * @param {Array} pool - ETF池数据
 * @returns {Object} 推送结果（{success: boolean, total: number, successCount: number, failedCount: number}）
 */
export async function pushPool(pool) {
  // 结果对象新增明确统计字段，便于清晰反馈推送情况
  const result = {
    success: false,
    total: pool.length,
    successCount: 0,
    failedCount: 0,
    reason: ""
  };
  
  // 检查是否已推送（避免重复执行）
  if (dailyStatus.poolPushed) {
    result.reason = "今日ETF池已完成推送，本次跳过";
    console.log(`pushPool：${result.reason}`);
    return result;
  }
  
  // 验证ETF池数据有效性
  if (!Array.isArray(pool) || pool.length === 0) {
    result.reason = "ETF池数据无效（非数组或为空）";
    console.error(`pushPool：${result.reason}`);
    return result;
  }
  
  try {
    // 前置提示消息（告知用户单条推送规则）
    const prefixContent = `【ETF池推送通知】\n本次共${pool.length}只ETF，将按单条消息推送，每条间隔1分钟，请留意接收。`;
    const prefixSuccess = await sendMessage(prefixContent);
    if (!prefixSuccess) {
      result.reason = "前置提示消息发送失败（不影响后续ETF推送）";
      console.warn(`pushPool：${result.reason}`);
    } else {
      console.log("pushPool：前置提示消息发送成功");
      // 前置消息后也间隔1分钟，避免与第一条ETF消息连续发送
      console.log("pushPool：等待1分钟后开始推送第一条ETF");
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    
    // 逐条推送ETF（单条消息对应一只ETF，严格1分钟间隔）
    for (const [index, etf] of pool.entries()) {
      // 跳过无效数据，不占用推送间隔
      if (!etf.code || !etf.name || isNaN(etf.price) || isNaN(etf.change)) {
        result.failedCount++;
        console.warn(`pushPool：第${index + 1}条ETF数据不完整（code: ${etf.code || '空'}），已跳过`);
        continue;
      }
      
      // 构建单条ETF消息内容（保持信息完整且简洁）
      const content = `【ETF详情 ${index + 1}/${pool.length}】\n` +
        `代码：${etf.code}\n` +
        `名称：${etf.name}\n` +
        `净值：${etf.price.toFixed(2)}元\n` +
        `波动幅度：${etf.change.toFixed(2)}%\n` +
        `类别：${etf.type || "综合"}`;
      
      // 发送当前ETF消息
      const success = await sendMessage(content);
      if (success) {
        result.successCount++;
        console.log(`pushPool：第${index + 1}条ETF推送成功（${etf.code}）`);
      } else {
        result.failedCount++;
        console.warn(`pushPool：第${index + 1}条ETF推送失败（${etf.code}）`);
      }
      
      // 非最后一条ETF则等待1分钟（严格执行间隔）
      if (index < pool.length - 1) {
        const nextIndex = index + 2;
        console.log(`pushPool：等待1分钟后推送第${nextIndex}条ETF（当前进度：${index + 1}/${pool.length}）`);
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
    
    // 推送完成后更新状态
    dailyStatus.poolPushed = true;
    result.success = result.successCount > 0; // 只要有成功就视为整体推送有效
    result.reason = `推送完成（总${result.total}条，成功${result.successCount}条，失败${result.failedCount}条）`;
    console.log(`pushPool：${result.reason}`);
    return result;
  } catch (e) {
    result.reason = `推送过程异常中断：${e.message}`;
    console.error(`pushPool：${result.reason}`);
    return result;
  }
}

/**
 * 推送策略结果消息（保持单条推送与间隔逻辑）
 * @param {Array} results - 策略建议数组
 * @returns {Object} 推送结果
 */
export async function pushStrategyResults(results) {
  const result = {
    success: false,
    total: results.length,
    successCount: 0,
    failedCount: 0,
    reason: ""
  };
  
  if (dailyStatus.strategyPushed) {
    result.reason = "今日策略结果已推送，本次跳过";
    console.log(`pushStrategyResults：${result.reason}`);
    return result;
  }
  
  try {
    if (!Array.isArray(results) || results.length === 0) {
      const success = await sendMessage("【策略执行结果】\n当前市场条件下，暂未生成调整建议");
      result.success = success;
      result.successCount = success ? 1 : 0;
      result.failedCount = success ? 0 : 1;
      dailyStatus.strategyPushed = success;
      console.log(`pushStrategyResults：无调整建议推送${success ? "成功" : "失败"}`);
      return result;
    }
    
    // 策略结果也按单条推送，保持1分钟间隔
    for (const [index, res] of results.entries()) {
      if (!res.operation || !res.code || !res.name || isNaN(res.price)) {
        result.failedCount++;
        console.warn(`pushStrategyResults：第${index + 1}条数据不完整，已跳过`);
        continue;
      }
      
      const content = `【${res.type || "配置"}调整 ${index + 1}/${results.length}】\n` +
        `${res.operation === "买入" ? "纳入" : "调出"} ${res.code} ${res.name}\n` +
        `净值：${res.price.toFixed(2)}元\n` +
        `份额：${res.shares || "适量"}\n` +
        `规模：${res.amount || "适中"}\n` +
        `依据：${res.reason || "市场趋势分析"}`;
      
      const success = await sendMessage(content);
      if (success) {
        result.successCount++;
      } else {
        result.failedCount++;
      }
      
      if (index < results.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
    
    dailyStatus.strategyPushed = true;
    result.success = result.successCount > 0;
    result.reason = `推送完成（总${result.total}条，成功${result.successCount}条）`;
    console.log(`pushStrategyResults：${result.reason}`);
    return result;
  } catch (e) {
    result.reason = `执行异常：${e.message}`;
    console.error(`pushStrategyResults：${result.reason}`);
    return result;
  }
}
