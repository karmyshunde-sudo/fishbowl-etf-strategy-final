// 导入配置和数据获取函数（PDF中股票池构建逻辑）
import { CONFIG } from "./config.js";
import { fetchETFData } from "./dataFetcher.js";

// 缓存当前股票池，减少重复计算
let currentPool = [];

/**
 * 获取股票池（自动判断是否需要更新，PDF1-3节更新规则）
 * @param {boolean} forceUpdate - 是否强制更新
 * @returns {Array} 股票池数据
 */
export async function getPool(forceUpdate = false) {
  // 检查是否需要更新（强制更新或达到更新时间）
  if (forceUpdate || shouldUpdatePool()) {
    try {
      currentPool = await updatePool();
      console.log(`股票池更新完成，共${currentPool.length}只ETF`);
    } catch (e) {
      console.error("股票池更新失败，使用旧池：", e.message);
      // 若更新失败，保留旧股票池（容错机制）
    }
  }
  return [...currentPool]; // 返回副本，避免外部修改
}

/**
 * 判断是否需要更新股票池（每周五16点后，PDF1-3节）
 * @returns {boolean} 是否需要更新
 */
function shouldUpdatePool() {
  // 转换为北京时间
  const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
  const weekday = now.getDay() || 7; // 周日转为7，方便判断周五（5）
  
  // 仅周五且时间≥16点
  return weekday === CONFIG.POOL.UPDATE_TIME.weekday && 
         now.getHours() >= CONFIG.POOL.UPDATE_TIME.hour;
}

/**
 * 更新股票池（宽基5只+行业5只，PDF中"核心-卫星"配置）
 * @returns {Array} 新股票池
 */
async function updatePool() {
  try {
    // 获取所有ETF数据
    const allEtfs = await fetchETFData();
    
    // 过滤无效数据（价格为NaN或非正数，成交量为0）
    const validEtfs = allEtfs.filter(etf => {
      return !isNaN(etf.price) && etf.price > 0 && 
             !isNaN(etf.change) && 
             !isNaN(etf.volume) && etf.volume > 0;
    });
    
    if (validEtfs.length === 0) {
      throw new Error("无有效ETF数据（过滤后数量为0）");
    }
    
    // 评分并排序（结合PDF中流动性和趋势筛选标准）
    const scoredEtfs = validEtfs
      .map(etf => ({
        ...etf,
        score: calculateScore(etf) // 计算评分
      }))
      .sort((a, b) => b.score - a.score); // 降序排序
    
    // 筛选宽基前5和行业前5（PDF1-48节核心-卫星策略）
    const wideBase = scoredEtfs.filter(etf => etf.type === "宽基").slice(0, 5);
    const industry = scoredEtfs.filter(etf => etf.type === "行业").slice(0, 5);
    
    // 合并为10只ETF的股票池
    const newPool = [...wideBase, ...industry];
    
    // 验证股票池有效性
    if (newPool.length < CONFIG.POOL.SIZE) {
      throw new Error(`股票池数量不足（实际${newPool.length}只，需${CONFIG.POOL.SIZE}只）`);
    }
    
    return newPool;
  } catch (e) {
    throw new Error(`更新股票池失败：${e.message}`);
  }
}

/**
 * 计算ETF评分（100分制，基于PDF筛选标准）
 * @param {Object} etf - ETF数据
 * @returns {number} 评分
 */
function calculateScore(etf) {
  let score = 0;
  
  // 1. 流动性评分（30分，PDF1-25节流动性优先）
  score += Math.min(30, etf.volume / 1000000); // 每100万成交量得1分
  
  // 2. 趋势评分（30分，PDF1-4节强者恒强）
  score += Math.min(30, 10 / (Math.abs(etf.change) + 0.1)); // 涨跌幅越小得分越高
  
  // 3. 价格合理性（20分，PDF实战案例价格范围）
  const priceScore = etf.price > 0.5 && etf.price < 5 ? 20 : 
                     etf.price <= 0.5 ? 10 : 15;
  score += priceScore;
  
  // 4. 类型适配性（20分，PDF1-48节类型配置）
  score += etf.type === "宽基" ? 20 : 18; // 宽基权重略高
  
  return Math.round(score);
}