// 导入测试所需模块
import { fetchETFData } from "./dataFetcher.js";
import { getPool } from "./poolManager.js";
import { executeStrategy, resetAllHoldings } from "./strategy.js";
import { sendMessage } from "./messageSender.js";

/**
 * 测试数据源获取功能
 */
export async function testDataFetch() {
  try {
    const data = await fetchETFData();
    console.log(`测试数据获取：成功获取${data.length}条数据`);
    return data;
  } catch (e) {
    console.error("测试数据获取失败：", e.message);
    throw e;
  }
}

/**
 * 测试股票池更新功能
 */
export async function testPoolUpdate() {
  try {
    const pool = await getPool(true); // 强制更新
    console.log(`测试股票池：成功生成${pool.length}只ETF的股票池`);
    return pool;
  } catch (e) {
    console.error("测试股票池失败：", e.message);
    throw e;
  }
}

/**
 * 测试策略执行功能
 */
export async function testStrategy() {
  try {
    resetAllHoldings(); // 重置持仓
    const results = await executeStrategy();
    console.log(`测试策略：生成${results.length}条操作建议`);
    return results;
  } catch (e) {
    console.error("测试策略失败：", e.message);
    throw e;
  }
}

/**
 * 测试消息推送功能
 */
export async function testMessage() {
  try {
    const success = await sendMessage("这是一条测试消息，用于验证部署是否成功");
    if (success) {
      console.log("测试消息推送成功");
    } else {
      console.error("测试消息推送失败");
    }
  } catch (e) {
    console.error("测试消息推送异常：", e.message);
    throw e;
  }
}