import { CONFIG } from "./config.js";
import { getPool } from "./poolManager.js";
import { executeStrategy, resetAllHoldings } from "./strategy.js";
import { pushPool, pushStrategyResults, sendMessage } from "./messageSender.js";
import { printTradeHistory, getCurrentPool, recordTrade } from "./testUtils.js";

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const testType = url.searchParams.get("test");

      // 测试场景1：打印建议交易流水
      if (testType === "print流水") {
        const history = printTradeHistory();
        return new Response(`交易流水:\n${JSON.stringify(history, null, 2)}`, {
          headers: { "Content-Type": "text/plain" }
        });
      }

      // 测试场景2：手动推送当前股票池
      if (testType === "push股票池") {
        const pool = await getPool();
        await pushPool(pool);
        return new Response("股票池已手动推送至企业微信", {
          headers: { "Content-Type": "text/plain" }
        });
      }

      // 测试场景3：触发一次策略执行并推送结果
      if (testType === "run策略") {
        const results = await executeStrategy();
        await pushStrategyResults(results);
        return new Response("策略已执行，结果已推送", {
          headers: { "Content-Type": "text/plain" }
        });
      }

      // 测试场景4：重置所有持仓（方便重复测试）
      if (testType === "重置持仓") {
        resetAllHoldings();
        return new Response("所有持仓已重置", {
          headers: { "Content-Type": "text/plain" }
        });
      }

      // 原有定时任务逻辑
      const beijingHour = new Date(
        Date.now() + CONFIG.TIMEZONE_OFFSET
      ).getHours();
      
      if (beijingHour === CONFIG.STRATEGY_TIMES.PUSH_POOL) {
        const pool = await getPool();
        await pushPool(pool);
        return new Response("股票池推送完成");
      }
      
      if (beijingHour === CONFIG.STRATEGY_TIMES.CHECK_STRATEGY) {
        const results = await executeStrategy();
        await pushStrategyResults(results);
        return new Response("策略执行及推送完成");
      }
      
      return new Response("未到指定执行时间", { status: 200 });
    } catch (e) {
      console.error("主程序错误：", e.message);
      return new Response(`执行错误：${e.message}`, { status: 500 });
    }
  }
};
