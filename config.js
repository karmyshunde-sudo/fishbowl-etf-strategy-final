// 导出鱼盆模型核心配置，严格匹配PDF中"鱼盆模型"参数
export const CONFIG = {
  // 企业微信机器人Webhook地址（用户提供的地址）
  WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=2f594b04-eb03-42b6-ad41-ff148bd57183",
  
  // 鱼盆模型核心参数（PDF中定义为20日均线策略）
  FISH_BOWL: {
    MA_PERIOD: 20, // 20日均线（模型核心指标，PDF1-7节）
    CONFIRM_DAYS: 2, // 信号确认周期（需持续2天，PDF1-55节）
    VOLUME_THRESHOLD: 1.2, // 成交量需较5日均量放大20%（PDF1-206节）
  },
  
  // 调仓与加仓参数（PDF中"金字塔加仓法"）
  POSITION: {
    INITIAL_RATIO: 0.3, // 首次建仓30%（PDF1-61节）
    ADD_STEPS: [0.2, 0.2], // 加仓比例（20%、20%，PDF1-59节）
    RETRACE_LEVELS: [5, 10], // 回调均线（5日、10日，PDF1-78节）
    MAX_POSITION: 0.7, // 最大仓位70%（PDF1-80节）
    SWITCH_THRESHOLD: 0.02, // 调仓阈值：跌破20日均线2%（PDF1-54节）
  },
  
  // 股票池配置（PDF中"核心-卫星"策略）
  POOL: {
    SIZE: 10, // 10只ETF（5宽基+5行业，PDF1-48节）
    UPDATE_TIME: { weekday: 5, hour: 16 } // 周五16点更新（PDF1-3节）
  },
  
  // 策略执行时间（北京时间，PDF实战案例时间）
  STRATEGY_TIMES: {
    PUSH_POOL: 11,   // 11点推送股票池
    CHECK_STRATEGY: 14 // 14点执行策略（如半导体ETF案例，PDF1-233节）
  },
  
  // 资金配置（PDF中资金管理规则）
  CAPITAL: {
    INITIAL: 20000, // 初始资金2万元
    ALLOCATION: { 稳健型: 0.6, 激进型: 0.4 } // 宽基60%，行业40%（PDF1-48节）
  },
  
  // 4个开源数据源（PDF推荐的市场数据来源类型）
  DATA_SOURCES: [
    { name: "akshare", url: "https://akshare.akfamily.xyz/data/fund/fund_etf_list.html" },
    { name: "baostock", url: "http://baostock.com/baostock/index.php/ETF%E6%95%B0%E6%8D%E8%83%E8%80%E9%87%E7%8E%E8%B0%E8%A1%E8%AF%A6%E8%A7%A3" },
    { name: "sina", url: "https://finance.sina.com.cn/money/fund/etf/" },
    { name: "tushare", url: "https://tushare.pro/document/2?doc_id=25" }
  ],
  
  // 时区偏移（北京时间=UTC+8）
  TIMEZONE_OFFSET: 8 * 60 * 60 * 1000
};
