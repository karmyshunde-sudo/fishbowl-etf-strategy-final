// 导入配置和数据解析工具（基于PDF中ETF池构建逻辑，整合AkShare数据源）
import { CONFIG } from "./config.js";
const cheerio = require("cheerio"); // HTML解析工具（处理开源数据源的HTML格式）

// 缓存当前ETF池 & 最后更新时间（核心状态管理，PDF1-3节性能优化）
let currentPool = [];
let lastUpdateTime = 0; // 毫秒级时间戳，用于缓存有效性判断

// 符合"开源免API"的数据源列表（保持4个数据源，优先AkShare，PDF附录A规范）
const OPEN_SOURCE_DATA_SOURCES = [
  { 
    name: "akshare",  
    url: "https://akshare.akfamily.xyz/data/etf/etf_basic_info.csv", 
    type: "csv",      
    requiresApi: false,
    desc: "AkShare ETF基础信息（用户验证可用，数据规范，PDF2-1节推荐数据源）"
  },
  { 
    name: "eastmoney", 
    url: "https://quote.eastmoney.com/center/list.html#ETF_all", 
    type: "html",
    requiresApi: false,
    desc: "东方财富网ETF列表（主备份源，PDF推荐的公开数据源）"
  },
  { 
    name: "cfi", 
    url: "http://etf.cfi.cn/", 
    type: "html",
    requiresApi: false,
    desc: "中金在线ETF大全（备用源2，历史数据完整）"
  },
  { 
    name: "sinafinance",  // 新增新浪财经作为第4个数据源
    url: "https://finance.sina.com.cn/fund/etf/", 
    type: "html",
    requiresApi: false,
    desc: "新浪财经ETF汇总（备用源3，分类明确，PDF1-4节趋势数据来源）"
  }
];

/**
 * 获取ETF池（优化缓存逻辑，避免一周内频繁更新，PDF1-3节更新规则）
 * @param {boolean} forceUpdate - 是否强制更新（测试场景使用）
 * @returns {Array} ETF池数据（副本，避免外部修改缓存）
 * @throws {Error} 若所有数据源失败且无缓存时抛出
 */
export async function getPool(forceUpdate = false) {
  try {
    console.log("【步骤1/5】检查是否需要更新ETF池...");
    
    // 核心更新条件（严格遵循每周五更新为主，兼顾初始化与测试）
    // 1. 强制更新 2. 周五16点后（定时窗口）+ 缓存过期/为空 3. 非周五但缓存为空（首次部署）
    const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
    const isFridayWindow = shouldUpdatePool(); // 是否处于周五16点后定时窗口
    const cacheExpired = Date.now() - lastUpdateTime > 86400000; // 缓存是否过期（24小时）
    
    const needUpdate = forceUpdate 
      || (isFridayWindow && (cacheExpired || currentPool.length === 0)) // 周五窗口内更新条件
      || (!isFridayWindow && currentPool.length === 0); // 非周五仅空缓存时更新（初始化）
    
    if (needUpdate) {
      console.log("【步骤1/5】需要更新（满足强制更新/周五窗口+过期/首次部署空缓存），开始执行更新流程");
      currentPool = await updatePool();
      lastUpdateTime = Date.now(); // 记录最新更新时间
      console.log(`【步骤1/5】ETF池更新完成，共${currentPool.length}只ETF（符合PDF1-48节10只配置）`);
    } else {
      console.log(`【步骤1/5】无需更新，使用缓存的ETF池（${currentPool.length}条，最后更新于${new Date(lastUpdateTime).toLocaleString()}）`);
    }
    return [...currentPool]; // 返回副本，避免外部直接修改缓存
  } catch (e) {
    console.error(`【步骤1/5】获取ETF池失败：${e.message}`);
    throw new Error(`获取ETF池失败：${e.message}`);
  }
}

/**
 * 判断是否需要定时更新ETF池（每周五16点后，PDF1-3节更新机制）
 * @returns {boolean} 是否处于周五16点后的更新窗口
 */
function shouldUpdatePool() {
  try {
    const now = new Date(Date.now() + CONFIG.TIMEZONE_OFFSET);
    const weekday = now.getDay() || 7; // 周日转为7（0=周日，1=周一...6=周六）
    const isFriday = weekday === CONFIG.POOL.UPDATE_TIME.weekday; // 周五=5（需与CONFIG一致）
    const isAfter16 = now.getHours() >= CONFIG.POOL.UPDATE_TIME.hour; // 16点后
    
    console.log(`【步骤1.1/5】当前时间：${now.toLocaleString()}，是否周五：${isFriday}，是否16点后：${isAfter16}`);
    return isFriday && isAfter16;
  } catch (e) {
    console.error(`【步骤1.1/5】判断定时更新时机失败：${e.message}`);
    return false; // 异常时不触发定时更新，避免流程阻断
  }
}

/**
 * 更新ETF池（宽基5只+行业5只，PDF中"核心-卫星"配置，1-48节）
 * @returns {Array} 新ETF池（符合配置要求的10只ETF）
 * @throws {Error} 若所有数据源失败且无缓存时抛出
 */
async function updatePool() {
  try {
    console.log("【步骤2/5】开始获取并合并多数据源的ETF数据...");
    const allEtfs = await fetchAndMergeETFData();
    console.log(`【步骤2/5】多数据源合并完成，共${allEtfs.length}条原始数据`);
    
    console.log("【步骤3/5】过滤无效ETF数据...");
    const validEtfs = allEtfs.filter(etf => {
      const isValid = !isNaN(etf.price) && etf.price > 0 
                     && !isNaN(etf.change) 
                     && !isNaN(etf.volume) && etf.volume > 0;
      if (!isValid) {
        console.log(`【步骤3/5】过滤无效数据：${JSON.stringify(etf)}`);
      }
      return isValid;
    });
    
    if (validEtfs.length === 0) {
      throw new Error("【步骤3/5】无有效ETF数据（过滤后数量为0，参考PDF2-3节数据有效性校验）");
    }
    console.log(`【步骤3/5】过滤完成，有效数据共${validEtfs.length}条`);
    
    console.log("【步骤4/5】对有效ETF进行评分排序...");
    const scoredEtfs = validEtfs
      .map(etf => ({ ...etf, score: calculateScore(etf) }))
      .sort((a, b) => b.score - a.score);
    console.log(`【步骤4/5】评分完成，最高分为${scoredEtfs[0]?.score || 0}分`);
    
    console.log("【步骤5/5】筛选宽基和行业ETF各5只...");
    const wideBase = scoredEtfs.filter(etf => etf.type === "宽基").slice(0, 5);
    const industry = scoredEtfs.filter(etf => etf.type === "行业").slice(0, 5);
    
    console.log(`【步骤5/5】宽基筛选结果：${wideBase.length}只，行业筛选结果：${industry.length}只`);
    
    const newPool = [...wideBase, ...industry];
    if (newPool.length < CONFIG.POOL.SIZE) {
      throw new Error(`【步骤5/5】ETF池数量不足（实际${newPool.length}只，需${CONFIG.POOL.SIZE}只，参考PDF3-1节）`);
    }
    
    return newPool;
  } catch (e) {
    // 容灾机制：更新失败时回退到缓存（PDF5-2节风险控制）
    if (currentPool.length > 0) {
      console.warn(`【容灾触发】更新失败，使用上次缓存的ETF池（原因：${e.message}）`);
      return currentPool;
    }
    throw new Error(`更新ETF池失败（无缓存可用）：${e.message}`);
  }
}

/**
 * 从多开源数据源获取并合并ETF数据（优先AkShare，PDF5-2节多源备份策略）
 * @returns {Array} 合并去重后的ETF数据
 * @throws {Error} 若所有数据源失败时抛出
 */
async function fetchAndMergeETFData() {
  try {
    console.log("【步骤2.1/5】筛选可用的开源免API数据源...");
    const validSources = OPEN_SOURCE_DATA_SOURCES.filter(source => !source.requiresApi);
    
    if (validSources.length === 0) {
      throw new Error("【步骤2.1/5】无可用的开源免API数据源（违反用户要求的数据源规范）");
    }
    console.log(`【步骤2.1/5】筛选完成，可用数据源：${validSources.map(s => s.name).join(",")}（优先AkShare）`);

    const allData = [];
    let successfulSources = 0; // 记录成功获取数据的数据源数量
    
    // 遍历所有数据源（优先处理AkShare，确保用户验证的数据源优先使用）
    for (const [index, source] of validSources.entries()) {
      console.log(`【步骤2.2/5】正在获取第${index + 1}个数据源（${source.name}）...`);
      try {
        // 根据数据源类型调用不同解析方法
        const etfData = source.type === "csv" 
          ? await parseCsvData(await fetchCsvSource(source)) 
          : await parseETFHtml(source.name, await fetchHtmlSource(source));
        
        allData.push(...etfData);
        successfulSources++;
        console.log(`【步骤2.2/5】数据源${source.name}获取成功，返回${etfData.length}条数据`);
        
        // 已获取2个有效数据源且数据量足够时提前退出
        if (successfulSources >= 2 && allData.length >= 50) {
          console.log("【步骤2.2/5】已获取2个有效数据源且数据充足，提前结束获取");
          break;
        }
      } catch (e) {
        console.error(`【步骤2.2/5】数据源${source.name}获取失败（继续尝试下一个）：${e.message}`);
        continue;
      }
    }

    if (allData.length === 0) {
      throw new Error("【步骤2.3/5】所有开源数据源均获取失败（需检查网络或数据源是否可访问）");
    }

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
 * 从CSV类型数据源获取原始数据（适配AkShare，新增超时与日志）
 * @param {Object} source - 数据源配置
 * @returns {string} CSV原始文本
 * @throws {Error} 若请求超时、HTTP错误或数据异常时抛出
 */
async function fetchCsvSource(source) {
  try {
    console.log(`【网络诊断】发送请求到${source.url}（超时10秒，CSV格式）`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // AkShare数据稍大，超时设为10秒

    const response = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "text/csv,application/vnd.ms-excel,*/*"
      },
      signal: controller.signal,
      cf: { tls: "tls1.3" } // 强制TLS1.3，优化Cloudflare兼容性
    });

    clearTimeout(timeoutId);
    console.log(`【网络诊断】${source.name}返回状态码：${response.status}`);

    if (!response.ok) {
      throw new Error(`HTTP请求失败（状态码：${response.status}，状态文本：${response.statusText}）`);
    }

    const rawCsv = await response.text();
    console.log(`【网络诊断】${source.name}返回CSV长度：${rawCsv.length}字符`);
    
    if (rawCsv.length < 1000) {
      throw new Error(`返回数据异常（长度：${rawCsv.length}字符），可能被反爬拦截`);
    }

    return rawCsv;
  } catch (e) {
    const errorType = e.name === "AbortError" ? "请求超时" : 
                     e.message.includes("HTTP请求失败") ? "HTTP错误" : "数据异常";
    throw new Error(`${errorType}：${e.message}`);
  }
}

/**
 * 从HTML类型数据源获取原始数据（拆分后逻辑更清晰）
 * @param {Object} source - 数据源配置
 * @returns {string} HTML原始文本
 * @throws {Error} 若请求超时或网络错误时抛出
 */
async function fetchHtmlSource(source) {
  try {
    console.log(`【网络诊断】发送请求到${source.url}（超时8秒，HTML格式）`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.google.com/"
      },
      signal: controller.signal,
      cf: { tls: "tls1.3" }
    });

    clearTimeout(timeoutId);
    return await response.text();
  } catch (e) {
    const errorType = e.name === "AbortError" ? "请求超时" : "网络错误";
    throw new Error(`${errorType}：${e.message}`);
  }
}

/**
 * 解析CSV格式数据（适配AkShare，严格校验字段）
 * @param {string} rawCsv - CSV原始文本
 * @returns {Array} 结构化的ETF数据
 * @throws {Error} 若格式异常或字段缺失时抛出
 */
function parseCsvData(rawCsv) {
  try {
    console.log(`【解析-akshare】开始解析CSV数据...`);
    const lines = rawCsv.split("\n").filter(line => line.trim() !== "");
    if (lines.length < 2) { // 至少需要表头+1条数据
      throw new Error("CSV数据格式异常，无有效内容");
    }

    // 解析表头（适配AkShare的ETF数据字段）
    const headers = lines[0].split(",").map(h => h.trim());
    const codeIndex = headers.indexOf("代码");
    const nameIndex = headers.indexOf("名称");
    const priceIndex = headers.indexOf("最新价");
    const changeIndex = headers.indexOf("涨跌幅");
    const volumeIndex = headers.indexOf("成交量");

    // 校验必要字段是否存在
    if (codeIndex === -1 || nameIndex === -1 || priceIndex === -1) {
      throw new Error(`CSV缺少必要字段（表头：${headers.join(",")}）`);
    }

    const etfList = [];
    // 从第2行开始解析数据
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(",");
      const code = fields[codeIndex]?.trim() || "";
      const name = fields[nameIndex]?.trim() || "";
      const price = parseFloat(fields[priceIndex]?.trim() || "0");
      const change = parseFloat(fields[changeIndex]?.trim() || "0");
      const volume = parseFloat(fields[volumeIndex]?.trim() || "0");
      // 判断类型（宽基/行业，根据名称关键字）
      const type = name.includes("宽基") || ["上证50", "沪深300", "中证500"].some(key => name.includes(key)) 
        ? "宽基" : "行业";

      if (code && name && code.length === 6) {
        etfList.push({ code, name, type, price, change, volume, source: "akshare" });
      } else {
        console.log(`【解析-akshare】跳过无效数据：code=${code}, name=${name}`);
      }
    }

    console.log(`【解析-akshare】解析完成，提取${etfList.length}条有效数据`);
    return etfList;
  } catch (e) {
    throw new Error(`akshare CSV解析失败：${e.message}`);
  }
}

/**
 * 解析不同HTML数据源的内容，提取ETF数据（新增新浪财经解析逻辑）
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
      case "eastmoney": 
        $("div.listview > table > tbody > tr:nth-child(n+2)").each((i, el) => {
          const code = $(el).find("td:nth-child(2)").text().trim();
          const name = $(el).find("td:nth-child(3)").text().trim();
          const price = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
          const change = parseFloat($(el).find("td:nth-child(5)").text().trim()) || 0;
          const volume = parseFloat($(el).find("td:nth-child(9)").text().trim()) || 0;
          const type = name.includes("宽基") ? "宽基" : "行业";

          if (code && name && code.length === 6) {
            etfList.push({ code, name, type, price, change, volume, source: sourceName });
          }
        });
        break;

      case "cfi": 
        $("div.ETF_list > table > tbody > tr").each((i, el) => {
          const code = $(el).find("td:nth-child(1)").text().trim();
          const name = $(el).find("td:nth-child(2)").text().trim();
          const price = parseFloat($(el).find("td:nth-child(3)").text().trim()) || 0;
          const change = parseFloat($(el).find("td:nth-child(4)").text().trim()) || 0;
          const volume = parseFloat($(el).find("td:nth-child(6)").text().trim()) || 0;
          const type = name.includes("宽基") ? "宽基" : "行业";

          if (code && name && code.length === 6) {
            etfList.push({ code, name, type, price, change, volume, source: sourceName });
          }
        });
        break;

      case "sinafinance": // 新浪财经解析逻辑
        $("div#divEtf > table > tbody > tr").each((i, el) => {
          const code = $(el).find("td:nth-child(1)").text().trim().replace(/[^\d]/g, ""); // 提取数字代码
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
        throw new Error(`未实现的数据源解析：${sourceName}`);
    }

    console.log(`【解析-${sourceName}】解析完成，提取${etfList.length}条有效数据`);
    return etfList;
  } catch (e) {
    throw new Error(`${sourceName}解析失败：${e.message}`);
  }
}

/**
 * 计算ETF评分（100分制，基于PDF筛选标准，1-25节+1-4节）
 * @param {Object} etf - ETF数据
 * @returns {number} 评分
 */
function calculateScore(etf) {
  try {
    let score = 0;
    
    // 1. 流动性评分（30分）
    const liquidityScore = Math.min(30, etf.volume / 1000000);
    score += liquidityScore;
    
    // 2. 趋势评分（30分）
    const trendScore = Math.min(30, 10 / (Math.abs(etf.change) + 0.1));
    score += trendScore;
    
    // 3. 价格合理性（20分）
    const priceScore = etf.price > 0.5 && etf.price < 5 ? 20 : 
                     etf.price <= 0.5 ? 10 : 15;
    score += priceScore;
    
    // 4. 类型适配性（20分）
    const typeScore = etf.type === "宽基" ? 20 : 18;
    score += typeScore;
    
    return Math.round(score);
  } catch (e) {
    console.error(`【评分】${etf?.code || '未知'}评分失败：${e.message}`);
    return 0;
  }
}
