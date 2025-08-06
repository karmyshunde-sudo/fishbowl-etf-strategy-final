// 导入核心依赖（新增child_process用于Python桥接，PDF5-4节跨语言调用方案）
import { CONFIG } from "./config.js";
const cheerio = require("cheerio");
const { execSync } = require("child_process"); // 关键新增：执行Python脚本

// 全局状态管理（PDF1-3节性能优化要求：减少重复计算）
let currentPool = [];          // 当前ETF池缓存
let lastUpdateTime = 0;        // 最后更新时间戳（毫秒）
let isUpdating = false;        // 避免并发更新的锁机制

/**
 * 生成简单唯一ID（替代uuid，避免依赖缺失）
 * @returns {string} 8位随机字符串
 */
function generateRequestId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * 数据源配置中心（PDF附录A数据来源规范：主备结合，全市场覆盖）
 * 优先级：AkShare Python桥接 > 东方财富网（HTML）
 * 关键修改：将AkShare数据源类型改为script，关联Python脚本
 */
const DATA_SOURCES = [
  {
    id: "akshare-api",
    name: "AkShare全市场API（Python桥接）",
    type: "script",             // 改为脚本类型
    scriptPath: "akshare_etf_fetcher.py", // 关联Python脚本路径
    timeout: 20000,             // 全市场数据量较大，超时设为20秒
    retries: 3,                 // 最多重试3次（含首次）
    parser: parseAkShareApiData, // 专用解析函数
    desc: "通过Python脚本调用AkShare（解决跨语言依赖，PDF2-1节推荐）"
  },
  {
    id: "eastmoney",
    name: "东方财富网",
    url: "https://quote.eastmoney.com/center/list.html#ETF_all",
    type: "html",
    timeout: 10000,             // HTML页面超时设为10秒
    retries: 2,                 // 备份源重试2次
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
      "Referer": "https://quote.eastmoney.com/",
      "Cookie": `device_id=${generateRequestId()};` // 使用自定义ID规避反爬
    },
    parser: parseEastMoneyHtml,
    desc: "东方财富全市场ETF列表（备份源，HTML格式，PDF1-206节量能数据来源）"
  }
];

/**
 * 获取ETF池（核心入口函数，PDF1-3节更新机制实现）
 * 逻辑不变：保留缓存机制与更新触发条件
 */
export async function getPool(forceUpdate = false) {
  // 避免并发更新（PDF5-3节并发控制要求）
  if (isUpdating) {
    console.log("【getPool】已有更新任务在执行，等待完成...");
    while (isUpdating) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  try {
    const now = Date.now();
    console.log(`【getPool】当前时间：${new Date(now).toLocaleString()}`);

    // 更新条件判断（PDF1-3节核心规则：周五更新+缓存过期+空池+强制更新）
    const needUpdate = forceUpdate
      || currentPool.length === 0                  // 缓存为空（首次部署）
      || (now - lastUpdateTime > CONFIG.POOL.MAX_AGE)  // 缓存过期（默认7天）
      || (isFridayAfter16(now) && (now - lastUpdateTime > 86400000)); // 周五16点后每日更新

    if (needUpdate) {
      console.log("【getPool】满足更新条件，开始执行更新流程...");
      isUpdating = true;
      currentPool = await updatePool();
      lastUpdateTime = now;
      console.log(`【getPool】更新完成，当前ETF池共${currentPool.length}只`);
    } else {
      console.log(`【getPool】使用缓存（最后更新：${new Date(lastUpdateTime).toLocaleString()}，剩余有效期：${Math.round((CONFIG.POOL.MAX_AGE - (now - lastUpdateTime)) / 3600000)}小时）`);
    }

    return [...currentPool]; // 返回副本，防止外部直接修改缓存
  } catch (e) {
    console.error(`【getPool】获取ETF池失败：${e.message}`);
    // 若缓存存在，返回缓存（PDF5-2节容灾机制）
    if (currentPool.length > 0) {
      console.warn("【getPool】更新失败，返回历史缓存");
      return [...currentPool];
    }
    throw new Error(`获取ETF池失败且无缓存可用：${e.message}`);
  } finally {
    isUpdating = false; // 释放更新锁
  }
}

/**
 * 判断是否为周五16点后（PDF1-3节更新时间规则）
 * 逻辑不变：保持时间判断准确性
 */
function isFridayAfter16(timestamp) {
  const date = new Date(timestamp + CONFIG.TIMEZONE_OFFSET);
  const weekday = date.getDay(); // 0=周日，1=周一...5=周五...6=周六
  const hour = date.getHours();
  const result = weekday === 5 && hour >= 16; // 周五且16点后
  console.log(`【isFridayAfter16】当前时间：${date.toLocaleString()}，判断结果：${result}`);
  return result;
}

/**
 * 更新ETF池（核心逻辑，策略驱动全市场筛选）
 * 逻辑不变：保持策略筛选流程完整性
 */
async function updatePool() {
  try {
    console.log("【updatePool】开始全市场ETF筛选流程...");
    const allEtfs = await fetchAndMergeETFData();
    
    if (allEtfs.length === 0) {
      throw new Error("全市场筛选后无有效ETF数据（参考PDF2-3节数据有效性校验）");
    }

    // 应用最终筛选策略（PDF3-1节配置要求：10只ETF）
    const finalPool = applySelectionStrategy(allEtfs);
    console.log(`【updatePool】策略筛选完成，最终ETF池共${finalPool.length}只（宽基${finalPool.filter(e => e.type === "宽基").length}只，行业${finalPool.filter(e => e.type === "行业").length}只）`);

    return finalPool;
  } catch (e) {
    console.error(`【updatePool】更新失败：${e.message}`);
    throw e;
  }
}

/**
 * 获取并合并多数据源数据（PDF5-2节多源备份策略）
 * 关键修改：新增脚本类型数据源处理逻辑
 */
async function fetchAndMergeETFData() {
  const allData = [];
  let primarySourceSuccess = false;

  for (const source of DATA_SOURCES) {
    try {
      console.log(`【fetchAndMergeETFData】开始获取${source.name}数据...`);
      let rawData;

      // 区分数据源类型处理（关键修改：支持脚本类型）
      if (source.type === "script") {
        // 调用Python脚本获取数据（PDF5-4节跨语言调用实现）
        rawData = execSync(
          `python3 ${source.scriptPath}`, // 执行Python脚本
          { timeout: source.timeout, encoding: "utf8" } // 设置超时与编码
        );
      } else {
        // HTML类型数据源处理（逻辑不变）
        rawData = await fetchSourceData(source);
      }

      const parsedData = source.parser(rawData, source.id);
      
      // 验证解析结果有效性
      if (parsedData.length === 0) {
        throw new Error(`解析后无有效数据（可能页面结构变更）`);
      }
      
      allData.push(...parsedData);
      console.log(`【fetchAndMergeETFData】${source.name}获取成功（${parsedData.length}条）`);
      
      // 主数据源成功则终止遍历（PDF5-2节主备切换逻辑）
      if (source.id === "akshare-api") {
        primarySourceSuccess = true;
        break;
      }
    } catch (e) {
      console.error(`【fetchAndMergeETFData】${source.name}处理失败：${e.message}`);
      // 主数据源失败才尝试备份源
      if (source.id === "akshare-api") {
        console.warn(`【fetchAndMergeETFData】主数据源失败，切换至备份源`);
        continue;
      }
      // 所有源失败才抛出
      if (allData.length === 0) {
        throw new Error(`所有数据源均失败：${e.message}`);
      }
    }
  }

  // 去重处理（基于代码，保留优先级高的数据源记录）
  const uniqueData = [];
  const seenCodes = new Set();
  allData.forEach(etf => {
    if (!seenCodes.has(etf.code)) {
      seenCodes.add(etf.code);
      uniqueData.push(etf);
    } else {
      console.log(`【fetchAndMergeETFData】去重重复代码：${etf.code}（${etf.name}）`);
    }
  });

  console.log(`【fetchAndMergeETFData】数据合并完成（原始${allData.length}条 → 去重后${uniqueData.length}条）`);
  return uniqueData;
}

/**
 * 统一HTML数据源请求函数（所有数据源共用，PDF5-1节模块化要求）
 * 逻辑不变：保持HTML请求与反爬处理
 */
async function fetchSourceData(source) {
  const requestId = generateRequestId(); // 使用自定义ID替代uuid
  console.log(`【fetchSourceData-${requestId}】开始请求${source.name}（第1次尝试）`);

  for (let attempt = 1; attempt <= source.retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), source.timeout);

    try {
      // HTML类型数据源请求
      const response = await fetch(source.url, {
        method: "GET",
        headers: source.headers,
        signal: controller.signal,
        cf: { 
          tls: "tls1.3",        // 强制TLS1.3，优化兼容性
          cacheTtl: 300         // 5分钟缓存，减轻源站压力
        }
      });

      clearTimeout(timeoutId);
      console.log(`【fetchSourceData-${requestId}】${source.name}第${attempt}次尝试，状态码：${response.status}`);

      if (!response.ok) {
        // 403反爬时动态更新Cookie
        if (response.status === 403 && attempt < source.retries) {
          source.headers.Cookie = `device_id=${generateRequestId()};`; // 更新设备ID
          console.log(`【fetchSourceData-${requestId}】触发反爬，更新Cookie后重试`);
          continue;
        }
        throw new Error(`HTTP错误 ${response.status}（${response.statusText}）`);
      }

      const data = await response.text();
      // 验证数据量（全市场ETF页面应>5000字符）
      if (data.length < 5000) {
        throw new Error(`数据量异常（${data.length}字符，可能为反爬页面）`);
      }

      return data;
    } catch (e) {
      clearTimeout(timeoutId);
      const errorType = e.name === "AbortError" ? "超时" : "请求失败";
      console.warn(`【fetchSourceData-${requestId}】${source.name}第${attempt}次${errorType}：${e.message}`);

      if (attempt === source.retries) {
        throw new Error(`${source.name}达到最大重试次数（${source.retries}次）`);
      }

      // 指数退避重试（1s→2s→4s）
      const waitTime = 1000 * Math.pow(2, attempt - 1);
      console.log(`【fetchSourceData-${requestId}】等待${waitTime}ms后重试...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * 应用最终筛选策略（PDF3-1节配置：宽基5+行业5，共10只）
 * 逻辑不变：保持策略评分与筛选逻辑
 */
function applySelectionStrategy(etfData) {
  // 1. 计算每只ETF的策略评分
  const scoredEtfs = etfData.map(etf => ({
    ...etf,
    score: calculateStrategyScore(etf)
  }));

  // 2. 按评分降序排序
  const sortedEtfs = scoredEtfs.sort((a, b) => b.score - a.score);
  console.log(`【applySelectionStrategy】策略评分完成，最高分为${sortedEtfs[0]?.score || 0}分`);

  // 3. 分类筛选（宽基5只，行业5只）
  const wideBase = sortedEtfs
    .filter(etf => etf.type === "宽基")
    .slice(0, 5);
  
  const industry = sortedEtfs
    .filter(etf => etf.type === "行业")
    .slice(0, 5);

  // 4. 输出筛选结果日志
  console.log("【applySelectionStrategy】宽基ETF筛选结果：");
  wideBase.forEach((etf, i) => {
    console.log(`  ${i+1}. ${etf.name}(${etf.code}) - 评分：${etf.score}，夏普比率：${etf.sharpe.toFixed(2)}`);
  });

  console.log("【applySelectionStrategy】行业ETF筛选结果：");
  industry.forEach((etf, i) => {
    console.log(`  ${i+1}. ${etf.name}(${etf.code}) - 评分：${etf.score}，夏普比率：${etf.sharpe.toFixed(2)}`);
  });

  return [...wideBase, ...industry];
}

/**
 * 策略评分函数（100分制，PDF3-3节评分标准）
 * 逻辑不变：保持指标权重与计算方式
 */
function calculateStrategyScore(etf) {
  let score = 0;

  // 1. 夏普比率（40分）：越高越好，最高8时得满分
  const sharpeScore = Math.min(40, etf.sharpe * 5);
  score += sharpeScore;

  // 2. 流动性（30分）：成交额1亿得满分
  const liquidityScore = Math.min(30, etf.turnover / 10000 * 30); // 1亿=30分
  score += liquidityScore;

  // 3. 近期趋势（20分）：涨跌幅正相关
  const trendScore = Math.min(20, Math.max(0, etf.change * 2)); // 10%涨幅得满分
  score += trendScore;

  // 4. 类型适配性（10分）：宽基额外加分
  const typeScore = etf.type === "宽基" ? 10 : 8;
  score += typeScore;

  return Math.round(score);
}

/**
 * AkShare API数据解析函数（转换为标准格式）
 * 关键修改：适配Python脚本返回的JSON数据
 */
function parseAkShareApiData(rawData, sourceId) {
  try {
    // 解析Python脚本输出的JSON字符串（PDF5-4节数据格式适配）
    const result = JSON.parse(rawData);
    
    // 处理Python脚本执行错误
    if (result.error) {
      throw new Error(`Python脚本执行错误：${result.error}`);
    }
    
    // 转换为项目统一数据格式
    return result.data.map(item => ({
      code: item.symbol,
      name: item.name,
      type: 判断ETF类型(item.name),
      price: parseFloat(item.price),
      change: parseFloat(item.change),
      volume: item.turnover * 10000, // 万元→元
      sharpe: parseFloat(item.sharpe),
      turnover: item.turnover, // 保留万元单位
      source: sourceId,
      timestamp: result.timestamp
    })).filter(etf => etf.price > 0); // 过滤无效价格
  } catch (e) {
    console.error(`【parseAkShareApiData】解析失败：${e.message}`);
    return []; // 解析失败返回空数组，触发备份源
  }
}

/**
 * 东方财富网HTML解析函数（备份源）
 * 逻辑不变：保持HTML解析逻辑
 */
function parseEastMoneyHtml(rawHtml, sourceId) {
  const $ = cheerio.load(rawHtml);
  const etfList = [];

  // 东方财富ETF列表选择器（适配2024年页面结构）
  $("div#table_wrapper-table > table > tbody > tr").each((i, el) => {
    // 提取核心字段
    const code = $(el).find("td:nth-child(2)").text().trim();
    const name = $(el).find("td:nth-child(3)").text().trim();
    const price = parseFloat($(el).find("td:nth-child(4)").text().trim() || 0);
    const change = parseFloat($(el).find("td:nth-child(5)").text().trim() || 0);
    const volume = parseFloat($(el).find("td:nth-child(9)").text().replace(/,/g, "") || 0) * 1000; // 成交额（万元→元）

    // 过滤无效数据
    if (!code || !name || price <= 0 || code.length !== 6) {
      console.log(`【parseEastMoneyHtml】跳过无效数据：${name}(${code})`);
      return;
    }

    etfList.push({
      code,
      name,
      type: 判断ETF类型(name),
      price,
      change,
      volume,
      sharpe: 0, // HTML源无法直接获取，后续策略会忽略
      turnover: volume / 10000, // 转换为万元
      source: sourceId,
      timestamp: new Date().toISOString()
    });
  });

  console.log(`【parseEastMoneyHtml】解析完成，提取${etfList.length}条有效数据`);
  return etfList;
}

/**
 * 判断ETF类型（宽基/行业，PDF3-1节分类标准）
 * 逻辑不变：保持分类规则
 */
function 判断ETF类型(name) {
  const wideBaseKeywords = [
    "沪深300", "中证500", "上证50", "创业板", 
    "科创板", "中证1000", "全指", "宽基", "综指"
  ];
  return wideBaseKeywords.some(key => name.includes(key)) ? "宽基" : "行业";
}

// 初始化：尝试从持久化存储加载缓存（若配置了KV存储）
if (typeof caches !== "undefined") {
  (async () => {
    try {
      const cache = await caches.open(CONFIG.CACHE_NAME);
      const response = await cache.match("/etf-pool-cache");
      if (response) {
        const cachedData = await response.json();
        currentPool = cachedData.pool;
        lastUpdateTime = cachedData.timestamp;
        console.log(`【初始化】从缓存加载ETF池（${currentPool.length}只，最后更新：${new Date(lastUpdateTime).toLocaleString()}）`);
      }
    } catch (e) {
      console.warn(`【初始化】缓存加载失败：${e.message}`);
    }
  })();
}
