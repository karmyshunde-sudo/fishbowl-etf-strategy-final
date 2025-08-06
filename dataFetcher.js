// 导入配置和HTML解析库（PDF中数据获取逻辑）
import { CONFIG } from "./config.js";
import { load } from "cheerio";

/**
 * 主函数：从数据源获取ETF数据，失败自动切换（PDF多数据源备份思想）
 * @returns {Array} 格式化的ETF数据
 */
export async function fetchETFData() {
  // 遍历所有数据源，按优先级尝试（PDF中分散风险思想）
  for (const source of CONFIG.DATA_SOURCES) {
    try {
      let data; // 存储当前数据源的ETF数据
      
      // 根据数据源名称调用对应的爬取函数
      switch (source.name) {
        case "akshare":
          data = await fetchAkShare(source.url);
          break;
        case "baostock":
          data = await fetchBaostock(source.url);
          break;
        case "sina":
          data = await fetchSina(source.url);
          break;
        case "tushare":
          data = await fetchTushare(source.url);
          break;
      }
      
      // 验证数据有效性（至少10条，且包含必要字段）
      if (data.length >= CONFIG.POOL.SIZE && 
          data.every(item => item.code && item.price && !isNaN(item.price))) {
        console.log(`成功从【${source.name}】获取${data.length}条有效数据`);
        return data;
      } else {
        throw new Error(`数据无效（数量不足或字段缺失）`);
      }
    } catch (e) {
      // 打印错误并继续尝试下一个数据源（容错机制）
      console.error(`【${source.name}】获取失败：${e.message}，尝试下一个数据源`);
    }
  }
  
  // 所有数据源失败时抛出错误（PDF中风险控制要求）
  throw new Error("所有数据源均获取失败，无法生成股票池");
}

/**
 * 爬取AkShare的ETF数据（解析公开数据页）
 * @param {string} url - AkShare的ETF数据页面地址
 * @returns {Array} 解析后的ETF数据
 */
async function fetchAkShare(url) {
  try {
    // 发送带反爬头的请求（带重试机制）
    const res = await fetchWithRetry(url);
    // 验证响应状态
    if (!res.ok) throw new Error(`HTTP状态码：${res.status}`);
    // 解析HTML内容
    const $ = load(await res.text());
    const etfList = [];
    
    // AkShare的ETF表格行在class为"table"的表格中
    $("table.table tr:not(:first-child)").each((i, el) => {
      const cols = $(el).find("td");
      // 只解析有完整数据的行（至少5列）
      if (cols.length >= 5) {
        etfList.push({
          code: $(cols[0]).text().trim(), // 第1列：代码
          name: $(cols[1]).text().trim(), // 第2列：名称
          price: parseFloat($(cols[2]).text()), // 第3列：价格
          change: parseFloat($(cols[3]).text()), // 第4列：涨跌幅
          volume: parseFloat($(cols[4]).text()), // 第5列：成交量
          type: $(cols[1]).text().includes("宽基") ? "宽基" : "行业", // PDF中类型划分
          source: "akshare"
        });
      }
    });
    
    return etfList;
  } catch (e) {
    throw new Error(`AkShare爬取失败：${e.message}`);
  }
}

/**
 * 爬取Baostock的ETF数据（解析公开列表）
 * @param {string} url - Baostock的ETF页面地址
 * @returns {Array} 解析后的ETF数据
 */
async function fetchBaostock(url) {
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP状态码：${res.status}`);
    const $ = load(await res.text());
    const etfList = [];
    
    // Baostock的ETF数据在id为"content"的div下的表格中
    $("#content table tr:not(:first-child)").each((i, el) => {
      const cols = $(el).find("td");
      if (cols.length >= 4) {
        etfList.push({
          code: $(cols[0]).text().trim(),
          name: $(cols[1]).text().trim(),
          price: parseFloat($(cols[2]).text()),
          change: parseFloat($(cols[3]).text()),
          volume: parseFloat($(cols[4]).text() || 0), // 成交量可能在第5列
          type: $(cols[1]).text().includes("指数") ? "宽基" : "行业", // PDF中宽基定义
          source: "baostock"
        });
      }
    });
    
    return etfList;
  } catch (e) {
    throw new Error(`Baostock爬取失败：${e.message}`);
  }
}

/**
 * 爬取新浪财经的ETF数据（稳定解析逻辑）
 * @param {string} url - 新浪财经ETF列表地址
 * @returns {Array} 解析后的ETF数据
 */
async function fetchSina(url) {
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP状态码：${res.status}`);
    const $ = load(await res.text());
    const etfList = [];
    
    // 新浪财经的ETF表格id为"etfList"
    $("table#etfList tr:not(:first-child)").each((i, el) => {
      const cols = $(el).find("td");
      if (cols.length >= 5) {
        etfList.push({
          code: $(cols[1]).text().trim(), // 第2列是代码
          name: $(cols[2]).text().trim(), // 第3列是名称
          price: parseFloat($(cols[3]).text()),
          change: parseFloat($(cols[4]).text()),
          volume: parseFloat($(cols[5]).text().replace(/,/g, "") || 0), // 去除逗号
          type: $(cols[2]).text().includes("宽基") ? "宽基" : "行业",
          source: "sina"
        });
      }
    });
    
    return etfList;
  } catch (e) {
    throw new Error(`新浪财经爬取失败：${e.message}`);
  }
}

/**
 * 爬取Tushare的基础ETF数据（解析公开文档中的示例数据）
 * @param {string} url - Tushare的ETF文档地址
 * @returns {Array} 解析后的ETF数据
 */
async function fetchTushare(url) {
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP状态码：${res.status}`);
    const $ = load(await res.text());
    const etfList = [];
    
    // Tushare的示例数据在class为"table-demo"的表格中
    $("table.table-demo tr:not(:first-child)").each((i, el) => {
      const cols = $(el).find("td");
      if (cols.length >= 4) {
        etfList.push({
          code: $(cols[0]).text().trim(),
          name: $(cols[1]).text().trim(),
          price: parseFloat($(cols[2]).text()),
          change: parseFloat($(cols[3]).text()),
          volume: parseFloat($(cols[4]).text() || 0),
          type: $(cols[1]).text().includes("ETF") ? "宽基" : "行业",
          source: "tushare"
        });
      }
    });
    
    return etfList;
  } catch (e) {
    throw new Error(`Tushare爬取失败：${e.message}`);
  }
}

/**
 * 带反爬和重试的请求函数（增强错误处理，PDF中风险控制思想）
 * @param {string} url - 请求地址
 * @param {number} retries - 重试次数（默认2次）
 * @returns {Response} 响应对象
 */
async function fetchWithRetry(url, retries = 2) {
  // 模拟浏览器请求头，避免被识别为爬虫（反爬措施）
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/116.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.google.com/" // 模拟从谷歌跳转
  };
  
  // 递归重试逻辑（指数退避策略）
  for (let i = 0; i <= retries; i++) {
    try {
      // 设置10秒超时（避免无限等待）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(url, {
        method: "GET",
        headers: headers,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId); // 清除超时器
      
      // 若响应成功，返回响应
      if (res.ok) return res;
      
      // 若失败且未到最大重试次数，等待后重试
      if (i < retries) {
        const delay = 1000 * (i + 1); // 1s, 2s, ...
        console.log(`第${i+1}次重试（延迟${delay}ms）：${url}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // 最后一次尝试失败，抛出错误
      throw new Error(`HTTP状态码错误：${res.status}`);
    } catch (e) {
      // 超时或网络错误，重试
      if (i < retries) {
        const delay = 1000 * (i + 1);
        console.log(`请求异常（${e.message}），第${i+1}次重试（延迟${delay}ms）：${url}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(`请求失败（重试${retries}次后）：${e.message}`);
    }
  }
}