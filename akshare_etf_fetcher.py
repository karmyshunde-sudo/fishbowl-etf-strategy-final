import akshare as ak
import json
from datetime import datetime
import pandas as pd

def calculate_sharpe_ratio(history_data):
    """计算夏普比率（无风险利率按0%计算）"""
    # 计算日收益率
    returns = history_data["close"].pct_change().dropna()
    if len(returns) < 10:
        return 0.0  # 数据不足时返回0
    
    # 累计收益率（近1个月）
    cum_return = (1 + returns).prod() - 1
    # 年化波动率（252个交易日）
    volatility = returns.std() * (252 ** 0.5)
    
    return cum_return / volatility if volatility != 0 else 0.0

def fetch_etf_data():
    """生产级AkShare数据获取逻辑（全市场ETF）"""
    try:
        # 步骤1：获取全市场ETF基础列表（PDF2-1节主数据源）
        etf_basic = ak.fund_etf_category_sina()
        if etf_basic.empty:
            raise ValueError("全市场ETF列表为空（AkShare返回空数据）")
        
        # 步骤2：初选（流动性筛选，成交额>1000万，PDF3-2节风险控制）
        valid_etfs = etf_basic[
            (etf_basic["成交额(万元)"] > 1000) & 
            (etf_basic["最新价"] > 0)  # 过滤无效价格
        ]
        
        # 按涨跌幅排序，取前50只进入详细评估（控制计算量）
        candidate_etfs = valid_etfs.sort_values(by="涨跌幅(%)", ascending=False).head(50)
        if candidate_etfs.empty:
            raise ValueError("初选后无符合条件的ETF（流动性不足）")
        
        # 步骤3：获取详细历史数据并计算指标
        result_data = []
        for _, row in candidate_etfs.iterrows():
            symbol = row["代码"].strip()
            name = row["名称"].strip()
            price = float(row["最新价"])
            change = float(row["涨跌幅(%)"])
            turnover = float(row["成交额(万元)"])
            
            # 简单判断交易所（上海：5开头；深圳：159/161开头）
            exchange = "sh" if symbol.startswith("5") else "sz"
            ak_symbol = f"{exchange}{symbol}"
            
            try:
                # 获取近30天历史数据（前复权）
                history = ak.fund_etf_hist_sina(symbol=ak_symbol, adjust="qfq")
                if len(history) < 20:  # 至少20个交易日数据
                    print(f"跳过{name}({symbol})：数据不足{len(history)}天")
                    continue
                
                # 计算夏普比率
                sharpe = calculate_sharpe_ratio(history)
                
                result_data.append({
                    "symbol": symbol,
                    "name": name,
                    "price": price,
                    "change": change,
                    "turnover": turnover,
                    "sharpe": round(sharpe, 4)
                })
            except Exception as e:
                print(f"获取{name}({symbol})详细数据失败：{str(e)}")
                continue
        
        if not result_data:
            raise ValueError("详细数据获取失败，候选池为空")
        
        # 返回标准化JSON（供Node.js解析）
        return {
            "data": result_data,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "count": len(result_data)
        }
    
    except Exception as e:
        # 错误信息标准化
        return {"error": str(e), "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

if __name__ == "__main__":
    # 执行并输出JSON
    output = fetch_etf_data()
    print(json.dumps(output, ensure_ascii=False, indent=2))
