// 导入配置和数据解析工具（基于PDF中股票池构建逻辑，整合开源免API数据源）
import { CONFIG } from "./config.js";
const cheerio = require("cheerio"); // HTML解析工具（处理开源数据源的HTML格式）

// 缓存当前股票池，减少重复计算（PDF1-3节性能优化建议）
let currentPool = [];

// 符合"开源免API"的数据源列表（无需注册、无密钥，参考PDF附录A数据来源规范）
const OPEN_SOURCE_DATA_SOURCES = [
  { 
    name: "eastmoney", 
    url: "https://quote.eastmoney.com/center/list.html#ETF_all", 
    type: "html",
    requiresApi: false,
    desc: "东方财富网ETF列表（数据全面，HTML格式稳定，PDF推荐的公开数据源）"
  },
  { 
    name: "10jqka", 
    url: "https://etf.10jqka.com.cn/", 
    type: "html",
    requiresApi: false,
    desc: "同花顺ETF行情（实时性强，表格结构清晰，适合快速解析，PDF1-206节量能数据来源）"
  },
  { 
    name: "sinafinance", 
    url: "https://finance.sina.com.cn/fund/etf/", 
    type: "html",
    requiresApi: false,
    desc: "新浪财经ETF汇总（分类明确，无需认证，PDF1-4节趋势数据来源）"
  }
];

/**
 * 获取股票池（自动判断是否需要更新，PDF1-3节更新规则）
 * @param {boolean} forceUpdate - 是否强制更新（测试场景使用）
 * @returns {Array} 股票池数据（副本，避免外部修改）
 */
export async function getPool(forceUpdate = false) {
  // 检查是否需要更新（强制更新或达到更新时间）
  if (forceUpdate || shouldUpdatePool()) {
    try {
      currentPool = await updatePool();
      console.log(`股票池更新完成，共${currentPool.length}只ETF（符合PDF1-48节10只配置）`);
    } catch (e) {
      console.error("股票池更新失败，使用旧池：", e.message);
      // 若更新失败，保留旧股票池（容错机制，参考PDF5-3节风险控制）
    }
  }
  return [...currentPool]; // 返回副本，避免外部直接修改缓存
}

/**
 * 判断是否需要更新股票池（每周五16点后，PDF1-3节更新机制）
 * @returns {boolean} 是否需要更新
 */
function shouldUpdatePool() {
  // 转换为北京时间（PDF1-10节时区处理规范）
  const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
  const weekday = now.getDay() || 7; // 周日转为7，方便判断周五（5）
  
  // 仅周五且时间≥16点（严格匹配PDF1-3节"周五16点更新"规则）
  return weekday === CONFIG.POOL.UPDATE_TIME.weekday && 
         now.getHours() >= CONFIG.POOL.UPDATE_TIME.hour;
}

/**
 * 更新股票池（宽基5只+行业5只，PDF中"核心-卫星"配置，1-48节）
 * @returns {Array} 新股票池（符合配置要求的10只ETF）
 */
async function updatePool() {
  try {
    // 从开源免API数据源获取并合并ETF数据（多源验证，PDF2-1节数据可靠性要求）
    const allEtfs = await fetchAndMergeETFData();
    
    // 过滤无效数据（价格为NaN或非正数，成交量为0，PDF1-25节数据清洗规则）
    const validEtfs = allEtfs.filter(etf => {
      return !isNaN(etf.price) && etf.price > 0 && 
             !isNaN(etf.change) && 
             !isNaN(etf.volume) && etf.volume > 0;
    });
    
    if (validEtfs.length === 0) {
      throw new Error("无有效ETF数据（过滤后数量为0，参考PDF2-3节数据有效性校验）");
    }
    
    // 评分并排序（结合PDF中流动性和趋势筛选标准，1-25节+1-4节）
    const scoredEtfs = validEtfs
      .map(etf => ({
        ...etf,
        score: calculateScore(etf) // 计算评分（100分制）
      }))
      .sort((a, b) => b.score - a.score); // 降序排序（高分优先入选）
    
    // 筛选宽基前5和行业前5（PDF1-48节核心-卫星策略：5宽基+5行业）
    const wideBase = scoredEtfs.filter(etf => etf.type === "宽基").slice(0, 5);
    const industry = scoredEtfs.filter(etf => etf.type === "行业").slice(0, 5);
    
    // 合并为10只ETF的股票池
    const newPool = [...wideBase, ...industry];
    
    // 验证股票池有效性（确保数量达标，PDF3-1节组合完整性要求）
    if (newPool.length < CONFIG.POOL.SIZE) {
      throw new Error(`股票池数量不足（实际${newPool.length}只，需${CONFIG.POOL.SIZE}只，参考PDF3-1节）`);
    }
    
    return newPool;
  } catch (e) {
    throw new Error(`更新股票池失败：${e.message}`);
  }
}

/**
 * 从多开源数据源获取并合并ETF数据（容错机制，PDF5-2节多源备份策略）
 * @returns {Array} 合并去重后的ETF数据
 */
async function fetchAndMergeETFData() {
  // 筛选无需API的数据源（严格遵守"开源免API"要求，用户明确规范）
  const validSources = OPEN_SOURCE_DATA_SOURCES.filter(source => !source.requiresApi);
  if (validSources.length === 0) {
    throw new Error("无可用的开源免API数据源（违反用户要求的数据源规范）");
  }

  const allData = [];
  // 遍历数据源获取数据（最多尝试3个，平衡效率与可靠性，PDF5-2节资源控制）
  for (const source of validSources.slice(0, 3)) {
    try {
      const etfData = await fetchFromSource(source);
      allData.push(...etfData);
      console.log(`成功从[${source.name}]获取${etfData.length}条ETF数据`);
    } catch (e) {
      console.warn(`数据源[${source.name}]获取失败，继续尝试下一个：${e.message}`);
      continue; // 单个数据源失败不中断，尝试下一个（容错机制）
    }
  }

  if (allData.length === 0) {
    throw new Error("所有开源数据源均获取失败（需检查网络或数据源是否可访问）");
  }

  // 去重处理（同一ETF可能在多数据源出现，PDF2-4节数据一致性处理）
  const uniqueData = [];
  const seenCodes = new Set();
  allData.forEach(etf => {
    if (!seenCodes.has(etf.code)) {
      seenCodes.add(etf.code);
      uniqueData.push(etf);
    }
  });

  console.log(`多数据源合并完成，去重后共${uniqueData.length}条ETF数据`);
  return uniqueData;
}

/**
 * 从单个开源数据源获取ETF数据（适配HTML结构，PDF2-2节数据解析规范）
 * @param {Object} source - 数据源配置
 * @returns {Array} 解析后的ETF数据（含代码、名称、类型、价格等字段）
 */
async function fetchFromSource(source) {
  try {
    // 模拟浏览器请求头（避免被反爬拦截，PDF5-4节反爬适配）
    const response = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.google.com/" // 模拟从搜索引擎跳转，降低拦截概率
      },
      timeout: 8000 // 8秒超时（避免长期阻塞，PDF5-3节超时控制）
    });

    if (!response.ok) {
      throw new Error(`HTTP错误：${response.status}（${response.statusText}）`);
    }

    const rawHtml = await response.text();
    // 简单校验：有效页面通常大于1000字符（识别反爬页面，PDF5-4节异常处理）
    if (rawHtml.length < 1000) {
      throw new Error("返回数据过短，可能被反爬拦截");
    }

    // 解析HTML获取ETF数据（适配不同数据源结构，PDF2-2节解析规则）
    return parseETFHtml(source.name, rawHtml);

  } catch (e) {
    throw new Error(`${e.message}（数据源：${source.name}）`);
  }
}

/**
 * 解析不同数据源的HTML，提取ETF数据（针对性适配，PDF2-2节格式适配）
 * @param {string} sourceName - 数据源名称
 * @param {string} rawHtml - 原始HTML内容
 * @returns {Array} 结构化的ETF数据
 */
function parseETFHtml(sourceName, rawHtml) {
  const $ = cheerio.load(rawHtml);
  const etfList = [];

  // 根据不同数据源的HTML结构解析（严格匹配页面DOM，避免解析失败）
  switch (sourceName) {
    case "eastmoney": // 东方财富网（PDF2-2节示例数据源）
      $("div.listview > table > tbody > tr:nth-child(n+2)").each((i, el) => {
        // 提取字段（代码、名称、价格、涨跌幅、成交量，PDF1-25节核心字段）
        const code = $(el).find("td:nth-child(2)").text().trim();
        const name = $(el).find("td:nth-child(3)").text().trim();
        const price = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
        const change = parseFloat($(el).find("td:nth-child(5)").text().trim()) || 0;
        const volume = parseFloat($(el).find("td:nth-child(9)").text().trim()) || 0;
        // 判断类型（宽基/行业，根据名称关键字，PDF1-48节分类规则）
        const type = name.includes("宽基") || ["上证50", "沪深300", "中证500"].some(key => name.includes(key)) 
          ? "宽基" 
          : "行业";

        if (code && name && code.length === 6) { // A股ETF代码为6位数字
          etfList.push({ code, name, type, price, change, volume, source: sourceName });
        }
      });
      break;

    case "10jqka": // 同花顺（PDF2-2节备选数据源）
      $("div.etf_table > table > tbody > tr").each((i, el) => {
        const code = $(el).find("td:nth-child(2) a").text().trim();
        const name = $(el).find("td:nth-child(3) a").text().trim();
        const price = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
        const change = parseFloat($(el).find("td:nth-child(5)").text().trim()) || 0;
        const volume = parseFloat($(el).find("td:nth-child(8)").text().trim()) || 0;
        const type = name.includes("行业") ? "行业" : "宽基"; // 简化分类

        if (code && name) {
          etfList.push({ code, name, type, price, change, volume, source: sourceName });
        }
      });
      break;

    case "sinafinance": // 新浪财经（PDF2-2节补充数据源）
      $("div#divEtf > table > tbody > tr").each((i, el) => {
        const code = $(el).find("td:nth-child(1)").text().trim().replace(/[^\d]/g, ""); // 提取数字代码
        const name = $(el).find("td:nth-child(2)").text().trim();
        const price = parseFloat($(el).find("td:nth-child(3)").text().trim()) || 0;
        const change = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
        const volume = parseFloat($(el).find("td:nth-child(6)").text().trim()) || 0;
        const type = name.includes("ETF") && !name.includes("行业") ? "宽基" : "行业";

        if (code && name && code.length === 6) {
          etfList.push({ code, name, type, price, change, volume, source: sourceName });
        }
      });
      break;

    default:
      throw new Error(`未实现的数据源解析：${sourceName}（需补充HTML解析规则）`);
  }

  return etfList;
}

/**
 * 计算ETF评分（100分制，基于PDF筛选标准，1-25节+1-4节）
 * @param {Object} etf - ETF数据（含价格、涨跌幅、成交量、类型等）
 * @returns {number} 评分（越高越优先入选股票池）
 */
function calculateScore(etf) {
  let score = 0;
  
  // 1. 流动性评分（30分，PDF1-25节流动性优先原则：成交量越大得分越高）
  // 每100万成交量得1分，最高30分（适应多数ETF成交量范围）
  score += Math.min(30, etf.volume / 1000000); 
  
  // 2. 趋势评分（30分，PDF1-4节强者恒强：涨跌幅越稳定得分越高）
  // 涨跌幅绝对值越小得分越高，最低0.1分避免除零
  score += Math.min(30, 10 / (Math.abs(etf.change) + 0.1)); 
  
  // 3. 价格合理性（20分，PDF实战案例：价格在0.5-5元区间更优）
  const priceScore = etf.price > 0.5 && etf.price < 5 ? 20 : 
                     etf.price <= 0.5 ? 10 : 15; // 过高/过低价格适当减分
  score += priceScore;
  
  // 4. 类型适配性（20分，PDF1-48节核心-卫星策略：宽基权重略高）
  score += etf.type === "宽基" ? 20 : 18; 
  
  return Math.round(score); // 四舍五入为整数评分
}
