// 导入核心模块
import { CONFIG } from "./config.js";
import { getPool } from "./poolManager.js";
import { executeStrategy } from "./strategy.js";
import { pushPool, pushStrategyResults } from "./messageSender.js";

/**
 * Cloudflare Workers入口函数
 * @param {Request} request - 触发请求
 * @returns {Response} 响应
 */
export default {
  async fetch(request) {
    try {
      // 计算当前北京时间的小时数（0-23）
      const beijingHour = new Date(
        Date.now() + CONFIG.TIMEZONE_OFFSET
      ).getHours();
      
      // 11点推送股票池
      if (beijingHour === CONFIG.STRATEGY_TIMES.PUSH_POOL) {
        const pool = await getPool();
        await pushPool(pool);
        return new Response("股票池推送完成");
      }
      
      // 14点执行策略并推送结果
      if (beijingHour === CONFIG.STRATEGY_TIMES.CHECK_STRATEGY) {
        const results = await executeStrategy();
        await pushStrategyResults(results);
        return new Response("策略执行及推送完成");
      }
      
      // 非执行时间返回提示
      return new Response("未到指定执行时间", { status: 200 });
    } catch (e) {
      // 捕获所有错误，避免程序中断
      console.error("主程序错误：", e.message);
      return new Response(`执行错误：${e.message}`, { status: 500 });
    }
  }
};