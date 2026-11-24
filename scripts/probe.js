import { officialHistory } from "../src/source.js";
import { getFundInfo, searchFund } from "../src/api.js";
const code = "110011";
for (const [name, fn] of [
  ["公开基金搜索", () => searchFund(code)],
  ["基金档案", () => getFundInfo(code)],
  ["历史单位净值", () => officialHistory(code, "2025-01-02", "2025-01-10")],
]) {
  try {
    const result = await fn();
    if (Array.isArray(result) ? !result.length : !result) throw Error();
    console.log(
      name,
      "可用",
      Array.isArray(result) ? result.length : result.netValueDate,
    );
  } catch {
    console.error(name, "不可用");
    process.exitCode = 1;
  }
}
