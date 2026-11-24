import { fetchText } from "./api.js";
import { code as fundCode, date, D, requireValue } from "./model.js";

export async function officialHistory(code, start, end, request = fetchText) {
  fundCode.parse(code);
  date.parse(start);
  date.parse(end);
  requireValue(start <= end, "日期范围无效");
  const rows = [],
    seen = new Set();
  let total;
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      fundCode: code,
      startDate: start,
      endDate: end,
      pageIndex: String(page),
      pageSize: "20",
    });
    const payload = JSON.parse(
      await request("https://api.fund.eastmoney.com/f10/lsjz?" + params, {
        headers: { Referer: "https://fundf10.eastmoney.com/" },
      }),
    );
    const list = payload.Data?.LSJZList;
    if (
      payload.ErrCode !== 0 ||
      !Array.isArray(list) ||
      !Number.isInteger(payload.TotalCount) ||
      payload.TotalCount < 0 ||
      !Number.isFinite(+payload.PageIndex) ||
      +payload.PageIndex !== page
    )
      throw Error("SOURCE_FORMAT");
    if (total !== undefined && total !== payload.TotalCount)
      throw Error("SOURCE_CHANGED");
    total = payload.TotalCount;
    for (const r of list) {
      if (
        !date.safeParse(r.FSRQ).success ||
        r.FSRQ < start ||
        r.FSRQ > end ||
        seen.has(r.FSRQ) ||
        !/^\d+(\.\d+)?$/.test(r.DWJZ) ||
        !D(r.DWJZ).gt(0) ||
        String(r.NAVTYPE) !== "1"
      )
        throw Error("SOURCE_UNSUPPORTED_NAV");
      rows.push({
        code,
        day: r.FSRQ,
        nav: String(r.DWJZ),
        action: r.FHFCZ || r.FHSP || null,
      });
      seen.add(r.FSRQ);
    }
    if (rows.length === total) return rows;
    if (!list.length || rows.length > total) throw Error("SOURCE_INCOMPLETE");
  }
  throw Error("SOURCE_RANGE_LIMIT");
}
