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
 * 获取ETF池（自动判断是否需要更新，PDF1-3节更新规则）
 * @param {boolean} forceUpdate - 是否强制更新（测试场景使用）
 * @returns {Array} ETF池数据（副本，避免外部修改）
 */
export async function getPool(forceUpdate = false) {
  try {
    // 步骤1：检查是否需要更新（强制更新或达到更新时间）
    console.log("【步骤1/5】检查是否需要更新ETF池...");
    if (forceUpdate || shouldUpdatePool()) {
      console.log("【步骤1/5】需要更新，开始执行更新流程");
      currentPool = await updatePool();
      console.log(`【步骤1/5】ETF池更新完成，共${currentPool.length}只ETF（符合PDF1-48节10只配置）`);
    } else {
      console.log("【步骤1/5】无需更新，使用缓存的ETF池");
    }
    return [...currentPool]; // 返回副本，避免外部直接修改缓存
  } catch (e) {
    console.error(`【步骤1/5】获取ETF池失败：${e.message}`);
    throw new Error(`获取ETF池失败：${e.message}`); // 抛出错误供上层捕获
  }
}

/**
 * 判断是否需要更新ETF池（每周五16点后，PDF1-3节更新机制）
 * @returns {boolean} 是否需要更新
 */
function shouldUpdatePool() {
  try {
    // 转换为北京时间（PDF1-10节时区处理规范）
    const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
    const weekday = now.getDay() || 7; // 周日转为7，方便判断周五（5）
    const isFriday = weekday === CONFIG.POOL.UPDATE_TIME.weekday;
    const isAfter16 = now.getHours() >= CONFIG.POOL.UPDATE_TIME.hour;
    
    console.log(`【步骤1.1/5】当前时间：${now.toLocaleString()}，是否周五：${isFriday}，是否16点后：${isAfter16}`);
    return isFriday && isAfter16;
  } catch (e) {
    console.error(`【步骤1.1/5】判断更新时机失败：${e.message}`);
    throw new Error(`判断更新时机失败：${e.message}`);
  }
}

/**
 * 更新ETF池（宽基5只+行业5只，PDF中"核心-卫星"配置，1-48节）
 * @returns {Array} 新ETF池（符合配置要求的10只ETF）
 */
async function updatePool() {
  try {
    // 步骤2：获取并合并多数据源的ETF数据
    console.log("【步骤2/5】开始获取并合并多数据源的ETF数据...");
    const allEtfs = await fetchAndMergeETFData();
    console.log(`【步骤2/5】多数据源合并完成，共${allEtfs.length}条原始数据`);
    
    // 步骤3：过滤无效数据（价格为NaN或非正数，成交量为0，PDF1-25节数据清洗规则）
    console.log("【步骤3/5】过滤无效ETF数据...");
    const validEtfs = allEtfs.filter(etf => {
      const isValid = !isNaN(etf.price) && etf.price > 0 && 
                     !isNaN(etf.change) && 
                     !isNaN(etf.volume) && etf.volume > 0;
      if (!isValid) {
        console.log(`【步骤3/5】过滤无效数据：${JSON.stringify(etf)}`);
      }
      return isValid;
    });
    
    if (validEtfs.length === 0) {
      throw new Error("【步骤3/5】无有效ETF数据（过滤后数量为0，参考PDF2-3节数据有效性校验）");
    }
    console.log(`【步骤3/5】过滤完成，有效数据共${validEtfs.length}条`);
    
    // 步骤4：评分并排序（结合PDF中流动性和趋势筛选标准，1-25节+1-4节）
    console.log("【步骤4/5】对有效ETF进行评分排序...");
    const scoredEtfs = validEtfs
      .map(etf => ({
        ...etf,
        score: calculateScore(etf) // 计算评分（100分制）
      }))
      .sort((a, b) => b.score - a.score); // 降序排序（高分优先入选）
    console.log(`【步骤4/5】评分完成，最高分为${scoredEtfs[0]?.score || 0}分`);
    
    // 步骤5：筛选宽基前5和行业前5（PDF1-48节核心-卫星策略：5宽基+5行业）
    console.log("【步骤5/5】筛选宽基和行业ETF各5只...");
    const wideBase = scoredEtfs.filter(etf => etf.type === "宽基").slice(0, 5);
    const industry = scoredEtfs.filter(etf => etf.type === "行业").slice(0, 5);
    
    console.log(`【步骤5/5】宽基筛选结果：${wideBase.length}只，行业筛选结果：${industry.length}只`);
    
    // 合并为10只ETF的股票池
    const newPool = [...wideBase, ...industry];
    
    // 验证ETF池有效性（确保数量达标，PDF3-1节组合完整性要求）
    if (newPool.length < CONFIG.POOL.SIZE) {
      throw new Error(`【步骤5/5】ETF池数量不足（实际${newPool.length}只，需${CONFIG.POOL.SIZE}只，参考PDF3-1节）`);
    }
    
    return newPool;
  } catch (e) {
    throw new Error(`更新ETF池失败：${e.message}`);
  }
}

/**
 * 从多开源数据源获取并合并ETF数据（容错机制，PDF5-2节多源备份策略）
 * @returns {Array} 合并去重后的ETF数据
 */
async function fetchAndMergeETFData() {
  try {
    // 步骤2.1：筛选无需API的数据源（严格遵守"开源免API"要求）
    console.log("【步骤2.1/5】筛选可用的开源免API数据源...");
    const validSources = OPEN_SOURCE_DATA_SOURCES.filter(source => !source.requiresApi);
    
    if (validSources.length === 0) {
      throw new Error("【步骤2.1/5】无可用的开源免API数据源（违反用户要求的数据源规范）");
    }
    console.log(`【步骤2.1/5】筛选完成，可用数据源：${validSources.map(s => s.name).join(",")}`);

    const allData = [];
    // 步骤2.2：遍历数据源获取数据（最多尝试3个，平衡效率与可靠性）
    console.log("【步骤2.2/5】开始从数据源获取数据...");
    for (const [index, source] of validSources.entries()) {
      console.log(`【步骤2.2/5】正在获取第${index + 1}个数据源（${source.name}）...`);
      try {
        const etfData = await fetchFromSource(source);
        allData.push(...etfData);
        console.log(`【步骤2.2/5】数据源${source.name}获取成功，返回${etfData.length}条数据`);
      } catch (e) {
        console.error(`【步骤2.2/5】数据源${source.name}获取失败（继续尝试下一个）：${e.message}`);
        // 单个数据源失败不中断，尝试下一个（容错机制）
        continue;
      }
      
      // 若已获取2个有效数据源，可提前退出（平衡稳定性与效率）
      if (allData.length > 0 && index >= 1) {
        console.log("【步骤2.2/5】已获取2个有效数据源，提前结束获取");
        break;
      }
    }

    // 步骤2.3：检查是否获取到数据
    if (allData.length === 0) {
      throw new Error("【步骤2.3/5】所有开源数据源均获取失败（需检查网络或数据源是否可访问）");
    }

    // 步骤2.4：去重处理（同一ETF可能在多数据源出现，PDF2-4节数据一致性处理）
    console.log("【步骤2.4/5】对获取的ETF数据进行去重处理...");
    const uniqueData = [];
    const seenCodes = new Set();
    allData.forEach(etf => {
      if (!seenCodes.has(etf.code)) {
        seenCodes.add(etf.code);
        uniqueData.push(etf);
      } else {
        console.log(`【步骤2.4/5】去重重复数据：${etf.code} ${etf.name}`);
      }
    });

    console.log(`【步骤2.4/5】去重完成，原始${allData.length}条 → 去重后${uniqueData.length}条`);
    return uniqueData;
  } catch (e) {
    throw new Error(`多数据源处理失败：${e.message}`);
  }
}

/**
 * 从单个开源数据源获取ETF数据（适配HTML结构，PDF2-2节数据解析规范）
 * @param {Object} source - 数据源配置
 * @returns {Array} 解析后的ETF数据（含代码、名称、类型、价格等字段）
 */
async function fetchFromSource(source) {
  try {
    // 步骤2.2.1：发送HTTP请求获取HTML
    console.log(`【步骤2.2.1/5】发送请求到${source.name}（URL：${source.url}）`);
    const response = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.google.com/" // 模拟从搜索引擎跳转，降低拦截概率
      },
      timeout: 8000 // 8秒超时（避免长期阻塞，PDF5-3节超时控制）
    });

    // 步骤2.2.2：检查HTTP响应状态
    if (!response.ok) {
      throw new Error(`HTTP请求失败（状态码：${response.status}，状态文本：${response.statusText}）`);
    }
    console.log(`【步骤2.2.2/5】${source.name}请求成功，状态码：${response.status}`);

    // 步骤2.2.3：获取并验证HTML内容
    const rawHtml = await response.text();
    if (rawHtml.length < 1000) {
      throw new Error(`返回数据异常（长度：${rawHtml.length}字符），可能被反爬拦截`);
    }
    console.log(`【步骤2.2.3/5】${source.name}数据获取成功，HTML长度：${rawHtml.length}字符`);

    // 步骤2.2.4：解析HTML获取ETF数据
    const etfList = parseETFHtml(source.name, rawHtml);
    if (etfList.length === 0) {
      throw new Error("HTML解析成功，但未提取到任何ETF数据（可能页面结构变更）");
    }
    console.log(`【步骤2.2.4/5】${source.name}解析完成，提取${etfList.length}条ETF数据`);

    return etfList;
  } catch (e) {
    throw new Error(`${source.name}处理失败：${e.message}`);
  }
}

/**
 * 解析不同数据源的HTML，提取ETF数据（针对性适配，PDF2-2节格式适配）
 * @param {string} sourceName - 数据源名称
 * @param {string} rawHtml - 原始HTML内容
 * @returns {Array} 结构化的ETF数据
 */
function parseETFHtml(sourceName, rawHtml) {
  try {
    const $ = cheerio.load(rawHtml);
    const etfList = [];
    console.log(`【解析】开始解析${sourceName}的HTML内容...`);

    switch (sourceName) {
      case "eastmoney": // 东方财富网（PDF2-2节示例数据源）
        $("div.listview > table > tbody > tr:nth-child(n+2)").each((i, el) => {
          const code = $(el).find("td:nth-child(2)").text().trim();
          const name = $(el).find("td:nth-child(3)").text().trim();
          const price = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
          const change = parseFloat($(el).find("td:nth-child(5)").text().trim()) || 0;
          const volume = parseFloat($(el).find("td:nth-child(9)").text().trim()) || 0;
          const type = name.includes("宽基") || ["上证50", "沪深300", "中证500"].some(key => name.includes(key)) 
            ? "宽基" 
            : "行业";

          if (code && name && code.length === 6) {
            etfList.push({ code, name, type, price, change, volume, source: sourceName });
          } else {
            console.log(`【解析-${sourceName}】跳过无效数据：code=${code}, name=${name}`);
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
          const type = name.includes("行业") ? "行业" : "宽基";

          if (code && name) {
            etfList.push({ code, name, type, price, change, volume, source: sourceName });
          } else {
            console.log(`【解析-${sourceName}】跳过无效数据：code=${code}, name=${name}`);
          }
        });
        break;

      case "sinafinance": // 新浪财经（PDF2-2节补充数据源）
        $("div#divEtf > table > tbody > tr").each((i, el) => {
          const code = $(el).find("td:nth-child(1)").text().trim().replace(/[^\d]/g, "");
          const name = $(el).find("td:nth-child(2)").text().trim();
          const price = parseFloat($(el).find("td:nth-child(3)").text().trim()) || 0;
          const change = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
          const volume = parseFloat($(el).find("td:nth-child(6)").text().trim()) || 0;
          const type = name.includes("ETF") && !name.includes("行业") ? "宽基" : "行业";

          if (code && name && code.length === 6) {
            etfList.push({ code, name, type, price, change, volume, source: sourceName });
          } else {
            console.log(`【解析-${sourceName}】跳过无效数据：code=${code}, name=${name}`);
          }
        });
        break;

      default:
        throw new Error(`未实现的数据源解析：${sourceName}（需补充HTML解析规则）`);
    }

    return etfList;
  } catch (e) {
    throw new Error(`${sourceName}解析失败：${e.message}`);
  }
}

/**
 * 计算ETF评分（100分制，基于PDF筛选标准，1-25节+1-4节）
 * @param {Object} etf - ETF数据（含价格、涨跌幅、成交量、类型等）
 * @returns {number} 评分（越高越优先入选ETF池）
 */
function calculateScore(etf) {
  try {
    let score = 0;
    
    // 1. 流动性评分（30分，PDF1-25节流动性优先原则：成交量越大得分越高）
    const liquidityScore = Math.min(30, etf.volume / 1000000);
    score += liquidityScore;
    console.log(`【评分】${etf.code} ${etf.name} - 流动性得分：${liquidityScore.toFixed(1)}`);
    
    // 2. 趋势评分（30分，PDF1-4节强者恒强：涨跌幅越稳定得分越高）
    const trendScore = Math.min(30, 10 / (Math.abs(etf.change) + 0.1));
    score += trendScore;
    console.log(`【评分】${etf.code} ${etf.name} - 趋势得分：${trendScore.toFixed(1)}`);
    
    // 3. 价格合理性（20分，PDF实战案例：价格在0.5-5元区间更优）
    const priceScore = etf.price > 0.5 && etf.price < 5 ? 20 : 
                     etf.price <= 0.5 ? 10 : 15;
    score += priceScore;
    console.log(`【评分】${etf.code} ${etf.name} - 价格得分：${priceScore}`);
    
    // 4. 类型适配性（20分，PDF1-48节核心-卫星策略：宽基权重略高）
    const typeScore = etf.type === "宽基" ? 20 : 18;
    score += typeScore;
    console.log(`【评分】${etf.code} ${etf.name} - 类型得分：${typeScore}`);
    
    const totalScore = Math.round(score);
    console.log(`【评分】${etf.code} ${etf.name} - 总分：${totalScore}`);
    return totalScore;
  } catch (e) {
    console.error(`【评分】${etf?.code || '未知'}评分失败：${e.message}`);
    return 0; // 评分失败时给予最低分
  }
}
