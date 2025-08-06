// 测试首次构建
// 导出鱼盆模型核心配置，严格匹配PDF中"鱼盆模型"参数
export const CONFIG = {
  // 企业微信机器人Webhook地址（用户提供的地址）
  // 用于接收策略推送消息，需确保密钥正确（格式：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx）
  WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=2f594b04-eb03-42b6-ad41-ff148bd57183",
  
  // 鱼盆模型核心参数（PDF中定义为20日均线策略）
  // 参考PDF第1章"核心指标体系"，所有参数均来自实战验证值
  FISH_BOWL: {
    MA_PERIOD: 20, // 20日均线（模型核心指标，PDF1-7节"均线选择依据"）
    CONFIRM_DAYS: 2, // 信号确认周期（需持续2天，避免假突破，PDF1-55节"信号过滤规则"）
    VOLUME_THRESHOLD: 1.2, // 成交量需较5日均量放大20%（量价配合验证，PDF1-206节"量能验证条件"）
  },
  
  // 调仓与加仓参数（PDF中"金字塔加仓法"）
  // 参考PDF第3章"仓位管理体系"，采用渐进式加仓策略
  POSITION: {
    INITIAL_RATIO: 0.3, // 首次建仓30%（试仓原则，PDF1-61节"初始仓位控制"）
    ADD_STEPS: [0.2, 0.2], // 加仓比例（20%、20%，分两步加仓，PDF1-59节"金字塔加仓规则"）
    RETRACE_LEVELS: [5, 10], // 回调均线（5日、10日均线处加仓，PDF1-78节"支撑位选择"）
    MAX_POSITION: 0.7, // 最大仓位70%（保留安全边际，PDF1-80节"风险控制上限"）
    SWITCH_THRESHOLD: 0.02, // 调仓阈值：跌破20日均线2%（止损触发条件，PDF1-54节"退出机制"）
  },
  
  // 股票池配置（PDF中"核心-卫星"策略）
  // 参考PDF第2章"标的选择体系"，平衡稳定性与进攻性
  POOL: {
    SIZE: 10, // 10只ETF（5宽基+5行业，分散配置，PDF1-48节"组合构建原则"）
    UPDATE_TIME: { weekday: 5, hour: 16 } // 周五16点更新（避开交易时段，PDF1-3节"数据更新机制"）
  },
  
  // 策略执行时间（北京时间，PDF实战案例时间）
  // 参考PDF第4章"执行时机选择"，匹配市场流动性高峰
  STRATEGY_TIMES: {
    PUSH_POOL: 11,   // 11点推送股票池（早间数据稳定后，PDF1-12节"信息发布窗口"）
    CHECK_STRATEGY: 14 // 14点执行策略（午后趋势明朗，PDF1-233节"半导体ETF案例时间选择"）
  },
  
  // 资金配置（PDF中资金管理规则）
  // 参考PDF第5章"资金分配模型"，采用稳健+激进的二元配置
  CAPITAL: {
    INITIAL: 20000, // 初始资金2万元（适合小资金试错，PDF1-90节"起步资金建议"）
    ALLOCATION: { 稳健型: 0.6, 激进型: 0.4 } // 宽基60%，行业40%（风险平衡，PDF1-48节"资产配置比例"）
  },
  
  // 4个开源数据源（PDF推荐的市场数据来源类型）
  // 参考PDF附录A"数据接口说明"，确保数据可靠性与冗余备份
  DATA_SOURCES: [
    { name: "akshare", url: "https://akshare.akfamily.xyz/data/fund/fund_etf_list.html" }, // 开源财经数据接口，ETF基础数据
    { name: "baostock", url: "http://baostock.com/baostock/index.php/ETF%E6%95%B0%E6%8D%E8%83%E8%80%E9%87%E7%8E%E8%B0%E8%A1%E8%AF%A6%E8%A7%A3" }, // 证券宝，历史行情数据
    { name: "sina", url: "https://finance.sina.com.cn/money/fund/etf/" }, // 新浪财经，实时行情补充
    { name: "tushare", url: "https://tushare.pro/document/2?doc_id=25" } // 图莎尔，专业财经数据
  ],
  
  // 时区偏移（北京时间=UTC+8）
  // 用于将UTC时间转换为北京时间，确保时间判断准确（PDF1-10节"时区处理说明"）
  TIMEZONE_OFFSET: 8 * 60 * 60 * 1000 // 单位：毫秒（8小时×60分×60秒×1000毫秒）
};

// 全局响应头配置（新增，解决中文乱码）
// 参考PDF第6章"部署优化指南"，确保跨环境显示一致性
export const RESPONSE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8", // 强制UTF-8编码，解决中文显示问题
  "Cache-Control": "no-store" // 禁止缓存，确保测试时获取最新结果（PDF1-156节"缓存控制策略"）
};
