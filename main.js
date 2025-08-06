import { CONFIG, RESPONSE_HEADERS } from "./config.js";
import { getPool } from "./poolManager.js";
import { executeStrategy, resetAllHoldings } from "./strategy.js";
import { pushPool, pushStrategyResults, sendMessage } from "./messageSender.js";

// 原始测试函数（保留原test.js核心逻辑，整合至main.js测试接口）
async function testMessage() {
  try {
    await sendMessage("测试消息推送：部署验证成功");
    return "测试消息已发送至企业微信";
  } catch (e) {
    return `消息测试失败：${e.message}`;
  }
}

async function testStrategy() {
  try {
    const results = await executeStrategy();
    return `策略测试结果：\n${JSON.stringify(results, null, 2)}`;
  } catch (e) {
    return `策略测试失败：${e.message}`;
  }
}

export default {
  async fetch(request) {
    // 初始化响应对象（应用全局编码配置）
    const response = new Response();
    Object.entries(RESPONSE_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    try {
      const url = new URL(request.url);
      const testType = url.searchParams.get("test");

      // 原始测试场景（保留原test.js调用方式）
      if (testType === "message") {
        response.body = await testMessage();
        return response;
      }
      if (testType === "strategy") {
        response.body = await testStrategy();
        return response;
      }

      // 新增扩展测试场景（兼容之前的优化需求）
      if (testType === "print流水") {
        const { printTradeHistory } = await import("./testUtils.js");
        const history = printTradeHistory();
        response.body = `交易流水:\n${JSON.stringify(history, null, 2)}`;
        return response;
      }
      if (testType === "push股票池") {
        const pool = await getPool();
        await pushPool(pool);
        response.body = "股票池已手动推送至企业微信";
        return response;
      }
      if (testType === "run策略") {
        const results = await executeStrategy();
        await pushStrategyResults(results);
        response.body = "策略已执行，结果已推送";
        return response;
      }
      if (testType === "重置持仓") {
        resetAllHoldings();
        response.body = "所有持仓已重置";
        return response;
      }

      // 原始定时任务逻辑（严格遵循CONFIG中的时间配置）
      const now = new Date();
      const beijingTime = new Date(now.getTime() + CONFIG.TIMEZONE_OFFSET);
      const beijingHour = beijingTime.getHours();
      const beijingWeekday = beijingTime.getDay() || 7; // 转换为1-7（1=周一，7=周日）

      // 股票池推送（匹配原始POOL.UPDATE_TIME配置）
      if (beijingHour === CONFIG.STRATEGY_TIMES.PUSH_POOL) {
        const pool = await getPool();
        await pushPool(pool);
        response.body = `股票池推送完成（${beijingTime.toLocaleString()}）`;
        return response;
      }

      // 策略执行（匹配原始STRATEGY_TIMES配置）
      if (beijingHour === CONFIG.STRATEGY_TIMES.CHECK_STRATEGY) {
        const results = await executeStrategy();
        await pushStrategyResults(results);
        response.body = `策略执行完成（${beijingTime.toLocaleString()}）`;
        return response;
      }

      // 股票池更新（每周五16点，匹配原始POOL.UPDATE_TIME）
      if (beijingWeekday === CONFIG.POOL.UPDATE_TIME.weekday && 
          beijingHour === CONFIG.POOL.UPDATE_TIME.hour) {
        await getPool(true); // 强制更新股票池
        response.body = `股票池更新完成（${beijingTime.toLocaleString()}）`;
        return response;
      }

      response.body = "未到指定执行时间";
      response.status = 200;
      return response;

    } catch (e) {
      console.error("执行错误：", e.message);
      response.body = `系统错误：${e.message}`;
      response.status = 500;
      return response;
    }
  }
};
