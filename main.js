//强制触发部署？超时？
// 导入配置（包含时区、响应头、策略执行时间等核心参数，PDF附录B配置规范）
import { CONFIG, RESPONSE_HEADERS } from "./config.js";

/**
 * 动态导入依赖模块（确保所有核心功能模块加载正常，PDF5-1节模块管理规范）
 * @returns {Object} 包含所有模块方法的依赖对象
 * @throws {Error} 若任何模块导入失败则抛出详细错误
 */
async function importDependencies() {
  try {
    console.log("【main.js】开始导入依赖模块...");
    
    // 并行导入所有依赖，单独捕获每个模块的错误
    const [
      poolModule,
      strategyModule,
      messageModule,
      testUtilsModule
    ] = await Promise.all([
      import("./poolManager.js").catch(e => {
        throw new Error(`poolManager.js导入失败：${e.message}（可能文件缺失或语法错误）`);
      }),
      import("./strategy.js").catch(e => {
        throw new Error(`strategy.js导入失败：${e.message}（可能策略逻辑有误）`);
      }),
      import("./messageSender.js").catch(e => {
        throw new Error(`messageSender.js导入失败：${e.message}（可能消息推送逻辑有误）`);
      }),
      // testUtils.js为可选依赖，导入失败时使用默认空实现
      import("./testUtils.js").catch(() => {
        console.warn("【main.js】testUtils.js导入失败，使用默认实现");
        return { printTradeHistory: () => [] };
      })
    ]);
    
    // 验证核心方法是否存在（避免模块导出不完整）
    const requiredMethods = [
      { name: "getPool", module: poolModule, required: true },
      { name: "executeStrategy", module: strategyModule, required: true },
      { name: "pushPool", module: messageModule, required: true },
      { name: "pushStrategyResults", module: messageModule, required: true },
      { name: "sendMessage", module: messageModule, required: true },
      { name: "resetAllHoldings", module: strategyModule, required: false },
      { name: "printTradeHistory", module: testUtilsModule, required: false }
    ];
    
    for (const { name, module, required } of requiredMethods) {
      if (required && typeof module[name] !== "function") {
        throw new Error(`${name}方法不存在于模块中（可能导出格式错误）`);
      }
    }
    
    console.log("【main.js】所有依赖模块导入成功");
    return {
      getPool: poolModule.getPool,
      executeStrategy: strategyModule.executeStrategy,
      resetAllHoldings: strategyModule.resetAllHoldings || (() => {}),
      pushPool: messageModule.pushPool,
      pushStrategyResults: messageModule.pushStrategyResults,
      sendMessage: messageModule.sendMessage,
      printTradeHistory: testUtilsModule.printTradeHistory || (() => [])
    };
  } catch (e) {
    console.error(`【main.js】依赖导入总错误：${e.message}`);
    throw new Error(`依赖导入失败：${e.message}`);
  }
}

/**
 * 测试企业微信消息推送功能（验证通道是否畅通，PDF4-1节消息通道测试）
 * @param {Object} deps - 依赖对象
 * @returns {string} 测试结果消息
 */
async function testMessage(deps) {
  try {
    console.log("【main.js】开始测试消息推送...");
    const testContent = "测试消息推送：部署验证成功（来自main.js测试）";
    const success = await deps.sendMessage(testContent);
    if (success) {
      console.log("【main.js】消息测试推送成功");
      return "测试消息已发送至企业微信（可在聊天记录中查看）";
    } else {
      console.warn("【main.js】消息测试推送返回失败");
      return "消息测试发送失败（消息模块返回false，未抛出错误）";
    }
  } catch (e) {
    console.error(`【main.js】消息测试失败：${e.message}`);
    return `消息测试失败：${e.message}\n排查方向：企业微信Webhook地址是否正确、网络是否通畅`;
  }
}

/**
 * 测试策略执行逻辑（验证策略计算是否正常，PDF3-5节策略测试规范）
 * @param {Object} deps - 依赖对象
 * @returns {string} 策略测试结果
 */
async function testStrategy(deps) {
  try {
    console.log("【main.js】开始测试策略执行...");
    const results = await deps.executeStrategy();
    console.log(`【main.js】策略测试完成，返回${results.length}条结果`);
    return `策略测试结果：\n${JSON.stringify(results, null, 2)}\n（结果说明：参考PDF3-5节策略输出规范）`;
  } catch (e) {
    console.error(`【main.js】策略测试失败：${e.message}`);
    return `策略测试失败：${e.message}\n排查方向：strategy.js中的评分逻辑、持仓计算是否有误`;
  }
}

/**
 * 主函数：处理所有请求与定时任务（PDF5-2节主流程控制）
 * @param {Request} request - 传入的HTTP请求
 * @returns {Response} 处理后的HTTP响应
 */
export default {
  async fetch(request) {
    // 基础响应配置（统一响应头，避免跨域问题）
    const init = { headers: { ...RESPONSE_HEADERS } };

    try {
      // 步骤1：导入所有依赖模块
      const deps = await importDependencies();
      
      // 步骤2：解析请求参数，判断是否为测试请求
      const url = new URL(request.url);
      const testType = url.searchParams.get("test");
      console.log(`【main.js】收到请求，测试类型：${testType || "定时任务/默认"}`);

      // 步骤3：处理测试请求（按不同测试类型执行对应逻辑）
      if (testType) {
        let body;
        switch (testType) {
          case "message":          // 测试消息推送功能
            body = await testMessage(deps);
            break;
          case "strategy":         // 测试策略执行逻辑
            body = await testStrategy(deps);
            break;
          case "printHistory":     // 打印交易流水
            const history = deps.printTradeHistory();
            body = `交易流水（共${history.length}条）:\n${JSON.stringify(history, null, 2)}`;
            break;
          case "pushPool":         // 手动推送ETF池
            console.log("【main.js】开始手动推送ETF池...");
            const pool = await deps.getPool(true); // 强制更新ETF池（测试场景）
            console.log(`【main.js】获取到ETF池数据（${pool.length}条），开始推送`);
            const pushResult = await deps.pushPool(pool);
            if (pushResult.success) {
              body = `ETF池已手动推送至企业微信（共${pool.length}条，成功${pushResult.successCount}条）`;
            } else {
              body = `ETF池推送部分失败：${pushResult.reason}（成功${pushResult.successCount}条，失败${pushResult.failedCount}条）`;
            }
            break;
          case "runStrategy":      // 手动执行策略并推送结果
            console.log("【main.js】开始手动执行策略...");
            const strategyResults = await deps.executeStrategy();
            console.log(`【main.js】策略执行完成（${strategyResults.length}条结果），开始推送`);
            await deps.pushStrategyResults(strategyResults);
            body = `策略已执行，结果已推送（共${strategyResults.length}条建议）`;
            break;
          case "resetHoldings":    // 重置所有持仓数据
            deps.resetAllHoldings();
            body = "所有持仓已重置（参考PDF3-3节持仓管理规范）";
            break;
          default:
            body = `未知测试类型：${testType}\n可用类型：message/strategy/printHistory/pushPool/runStrategy/resetHoldings`;
            return new Response(body, { ...init, status: 400 });
        }
        return new Response(body, init);
      }

      // 步骤4：处理定时任务（非测试请求时执行）
      const beijingTime = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
      const beijingHour = beijingTime.getHours();
      console.log(`【main.js】当前北京时间：${beijingTime.toLocaleString()}，小时：${beijingHour}`);

      // 推送ETF池（匹配配置的推送小时）
      if (beijingHour === CONFIG.STRATEGY_TIMES.PUSH_POOL) {
        console.log(`【main.js】触发定时任务：推送ETF池（${CONFIG.STRATEGY_TIMES.PUSH_POOL}点）`);
        const pool = await deps.getPool();
        await deps.pushPool(pool);
        return new Response(`[定时任务] ETF池推送完成（${beijingTime.toLocaleTimeString()}，共${pool.length}条）`, init);
      }

      // 执行策略并推送结果（匹配配置的策略小时）
      if (beijingHour === CONFIG.STRATEGY_TIMES.CHECK_STRATEGY) {
        console.log(`【main.js】触发定时任务：执行策略（${CONFIG.STRATEGY_TIMES.CHECK_STRATEGY}点）`);
        const results = await deps.executeStrategy();
        await deps.pushStrategyResults(results);
        return new Response(`[定时任务] 策略执行完成（${beijingTime.toLocaleTimeString()}，共${results.length}条建议）`, init);
      }

      // 步骤5：非测试且非定时任务时间，返回提示信息
      return new Response(
        `未到指定执行时间（当前北京时间：${beijingTime.toLocaleString()}）\n` +
        `每日${CONFIG.STRATEGY_TIMES.PUSH_POOL}点推送ETF池，${CONFIG.STRATEGY_TIMES.CHECK_STRATEGY}点执行策略`,
        init
      );

    } catch (e) {
      // 全局错误处理（捕获所有环节的异常）
      console.error(`【main.js】系统执行错误：${e.message}`);
      return new Response(
        [
          "系统执行错误：",
          `原因：${e.message}`,
          "排查步骤（按优先级）：",
          "1. 检查依赖文件是否存在（poolManager.js/messageSender.js等）",
          "2. 查看Cloudflare日志，搜索【main.js】定位具体错误环节",
          "3. 验证测试参数是否正确（应为英文：pushPool/strategy等）",
          "4. 检查各模块是否有语法错误（如括号不匹配、逗号缺失）"
        ].join("\n"),
        { ...init, status: 500 }
      );
    }
  }
};


