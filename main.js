import { CONFIG, RESPONSE_HEADERS } from "./config.js";

// 延迟导入依赖（仅在需要时加载，减少初始化错误）
async function importDependencies() {
  try {
    const [
      poolModule,
      strategyModule,
      messageModule,
      testUtilsModule
    ] = await Promise.all([
      import("./poolManager.js"),
      import("./strategy.js"),
      import("./messageSender.js"),
      import("./testUtils.js").catch(() => ({ printTradeHistory: () => [] })) // 容错处理
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
    throw new Error(`依赖导入失败：${e.message}（可能缺少文件或语法错误）`);
  }
}

// 原始测试函数（带详细错误捕获）
async function testMessage(deps) {
  try {
    await deps.sendMessage("测试消息推送：部署验证成功");
    return "测试消息已发送至企业微信";
  } catch (e) {
    return `消息测试失败：${e.message}\n（检查企业微信Webhook地址是否正确）`;
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
    // 初始化响应对象（确保编码正确）
    const response = new Response();
    Object.entries(RESPONSE_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    try {
      // 第一步：尝试导入所有依赖，失败时直接显示错误
      const deps = await importDependencies();
      
      // 第二步：解析请求参数
      const url = new URL(request.url);
      const testType = url.searchParams.get("test");

      // 有测试参数的场景
      if (testType) {
        switch (testType) {
          case "message":
            response.body = await testMessage(deps);
            return response;
          case "strategy":
            response.body = await testStrategy(deps);
            return response;
          case "print流水":
            response.body = `交易流水:\n${JSON.stringify(deps.printTradeHistory(), null, 2)}`;
            return response;
          case "push股票池":
            const pool = await deps.getPool();
            await deps.pushPool(pool);
            response.body = "股票池已手动推送至企业微信";
            return response;
          case "run策略":
            const results = await deps.executeStrategy();
            await deps.pushStrategyResults(results);
            response.body = "策略已执行，结果已推送";
            return response;
          case "重置持仓":
            deps.resetAllHoldings();
            response.body = "所有持仓已重置";
            return response;
          default:
            response.body = `未知测试类型：${testType}\n可用类型：message/strategy/print流水/push股票池/run策略/重置持仓`;
            response.status = 400;
            return response;
        }
      }

      // 无参数链接：定时任务逻辑
      const now = new Date();
      const beijingTime = new Date(now.getTime() + CONFIG.TIMEZONE_OFFSET);
      const beijingHour = beijingTime.getHours();

      if (beijingHour === CONFIG.STRATEGY_TIMES.PUSH_POOL) {
        const pool = await deps.getPool();
        await deps.pushPool(pool);
        response.body = `[定时任务] 股票池推送完成（${beijingTime.toLocaleTimeString()}）`;
        return response;
      }

      if (beijingHour === CONFIG.STRATEGY_TIMES.CHECK_STRATEGY) {
        const results = await deps.executeStrategy();
        await deps.pushStrategyResults(results);
        response.body = `[定时任务] 策略执行完成（${beijingTime.toLocaleTimeString()}）`;
        return response;
      }

      // 非执行时间的正常提示
      response.body = `未到指定执行时间（当前北京时间：${beijingTime.toLocaleString()}）\n每日${CONFIG.STRATEGY_TIMES.PUSH_POOL}点推送股票池，${CONFIG.STRATEGY_TIMES.CHECK_STRATEGY}点执行策略`;
      return response;

    } catch (e) {
      // 终极错误捕获：任何环节出错都显示详细信息
      response.body = [
        "系统执行错误（完整信息）：",
        `错误原因：${e.message}`,
        "可能的问题点：",
        "- 检查是否缺少文件（如poolManager.js、strategy.js）",
        "- 检查文件是否有语法错误（如括号/逗号缺失）",
        "- 检查CONFIG配置是否正确（如时区、时间参数）"
      ].join("\n");
      response.status = 500;
      return response;
    }
  }
};
