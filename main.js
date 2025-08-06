import { CONFIG, RESPONSE_HEADERS } from "./config.js";

async function importDependencies() {
  try {
    const [
      poolModule,
      strategyModule,
      messageModule,
      testUtilsModule
    ] = await Promise.all([
      import("./poolManager.js").catch(e => {
        throw new Error(`poolManager.js导入失败：${e.message}`);
      }),
      import("./strategy.js").catch(e => {
        throw new Error(`strategy.js导入失败：${e.message}`);
      }),
      import("./messageSender.js").catch(e => {
        throw new Error(`messageSender.js导入失败：${e.message}`);
      }),
      import("./testUtils.js").catch(() => ({ printTradeHistory: () => [] }))
    ]);
    return {
      getPool: poolModule.getPool || (() => Promise.resolve([])),
      executeStrategy: strategyModule.executeStrategy || (() => Promise.resolve([])),
      resetAllHoldings: strategyModule.resetAllHoldings || (() => {}),
      pushPool: messageModule.pushPool || (() => Promise.resolve()),
      pushStrategyResults: messageModule.pushStrategyResults || (() => Promise.resolve()),
      sendMessage: messageModule.sendMessage || (() => Promise.resolve()),
      printTradeHistory: testUtilsModule.printTradeHistory || (() => [])
    };
  } catch (e) {
    throw new Error(`依赖导入失败：${e.message}（文件缺失或语法错误）`);
  }
}

// 测试函数保持不变
async function testMessage(deps) {
  try {
    await deps.sendMessage("测试消息推送：部署验证成功");
    return "测试消息已发送至企业微信";
  } catch (e) {
    return `消息测试失败：${e.message}\n（检查企业微信Webhook地址）`;
  }
}

async function testStrategy(deps) {
  try {
    const results = await deps.executeStrategy();
    return `策略测试结果：\n${JSON.stringify(results, null, 2)}`;
  } catch (e) {
    return `策略测试失败：${e.message}\n（检查strategy.js逻辑）`;
  }
}

export default {
  async fetch(request) {
    const init = { headers: { ...RESPONSE_HEADERS } };

    try {
      const deps = await importDependencies();
      const url = new URL(request.url);
      const testType = url.searchParams.get("test");

      // 测试参数改为英文（核心调整点）
      if (testType) {
        let body;
        switch (testType) {
          case "message":          // 原"message"保持不变
            body = await testMessage(deps);
            break;
          case "strategy":         // 原"strategy"保持不变
            body = await testStrategy(deps);
            break;
          case "printHistory":     // 原"print流水"
            body = `交易流水:\n${JSON.stringify(deps.printTradeHistory(), null, 2)}`;
            break;
          case "pushPool":         // 原"push股票池"
            await deps.pushPool(await deps.getPool());
            body = "股票池已手动推送至企业微信";
            break;
          case "runStrategy":      // 原"run策略"
            await deps.pushStrategyResults(await deps.executeStrategy());
            body = "策略已执行，结果已推送";
            break;
          case "resetHoldings":    // 原"重置持仓"
            deps.resetAllHoldings();
            body = "所有持仓已重置";
            break;
          default:
            body = `未知测试类型：${testType}\n可用类型：message/strategy/printHistory/pushPool/runStrategy/resetHoldings`;
            return new Response(body, { ...init, status: 400 });
        }
        return new Response(body, init);
      }

      // 无参数链接逻辑保持不变
      const beijingTime = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
      const beijingHour = beijingTime.getHours();

      if (beijingHour === CONFIG.STRATEGY_TIMES.PUSH_POOL) {
        await deps.pushPool(await deps.getPool());
        return new Response(`[定时任务] 股票池推送完成（${beijingTime.toLocaleTimeString()}）`, init);
      }
      if (beijingHour === CONFIG.STRATEGY_TIMES.CHECK_STRATEGY) {
        await deps.pushStrategyResults(await deps.executeStrategy());
        return new Response(`[定时任务] 策略执行完成（${beijingTime.toLocaleTimeString()}）`, init);
      }

      return new Response(
        `未到指定执行时间（当前北京时间：${beijingTime.toLocaleString()}）\n每日${CONFIG.STRATEGY_TIMES.PUSH_POOL}点推送股票池，${CONFIG.STRATEGY_TIMES.CHECK_STRATEGY}点执行策略`,
        init
      );

    } catch (e) {
      return new Response(
        [
          "系统执行错误：",
          `原因：${e.message}`,
          "排查方向：",
          "- 所有依赖文件是否存在（poolManager.js等）",
          "- 文件是否有语法错误（括号/逗号缺失）",
          "- 测试参数是否正确（英文参数）"
        ].join("\n"),
        { ...init, status: 500 }
      );
    }
  }
};
