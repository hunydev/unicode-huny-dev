import React, { useMemo } from "react";
import rawData from "../unicode_16.json";

// JSON 레코드 타입
interface UnicodeBlockRaw {
  sg: string; // Script Group
  mb: string | null; // Main Block (없을 수 있음)
  pb?: string; // Presentation Block (선택)
  sb?: string; // Supplement Block (선택)
  title: string; // 예: "0530-058F" 또는 "12F90–12FFF" (en dash 포함 가능)
  href: string; // unicode.org PDF 링크
  start: string; // HEX 문자열
  end: string;   // HEX 문자열
}

// 전처리된 블록 타입
interface UnicodeBlock extends UnicodeBlockRaw {
  startN: number;
  endN: number;
}

// 숫자 포맷
const formatHex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, "0");
const withComma = (n: number) => n.toLocaleString();
const safeChar = (cp: number) => {
  try { return String.fromCodePoint(cp); } catch { return ""; }
};

// 표시 가능성 판단(경량 휴리스틱)
function isSurrogate(cp: number) { return cp >= 0xd800 && cp <= 0xdfff; }
function isNoncharacter(cp: number) {
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true; // 전용 비문자
  const low = cp & 0xffff; // 각 플레인의 마지막 두 코드포인트
  if (low === 0xfffe || low === 0xffff) return true;
  return false;
}
function isControl(cp: number) { return (cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f); }
function isVariationSelector(cp: number) {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}
function isZeroWidthLike(cp: number) {
  // ZWSP/ZWNBSP/ZWJ/ZWNJ 등 가시성 낮은 포맷 문자 범위 일부
  return (
    cp === 0x200b || cp === 0x2060 || cp === 0x200c || cp === 0x200d ||
    (cp >= 0x200e && cp <= 0x200f) || (cp >= 0x2066 && cp <= 0x2069)
  );
}
function isDisplayable(cp: number) {
  if (cp < 0 || cp > 0x10ffff) return false;
  if (isSurrogate(cp)) return false;
  if (isNoncharacter(cp)) return false;
  if (isControl(cp)) return false;
  if (isVariationSelector(cp)) return false;
  if (isZeroWidthLike(cp)) return false;
  return true; // 나머지는 표시 시도(폰트 미존재는 브라우저 폴백에 위임)
}
function findFirstDisplayable(start: number, end: number): number | null {
  for (let cp = start; cp <= end; cp++) {
    if (isDisplayable(cp)) return cp;
    // 안전장치: 너무 큰 블록에서 과탐색 방지(필요 시 범위 제한 가능)
  }
  return null;
}
function findLastDisplayable(start: number, end: number): number | null {
  for (let cp = end; cp >= start; cp--) {
    if (isDisplayable(cp)) return cp;
  }
  return null;
}

// JSON을 숫자 범위로 전처리(모듈 레벨에서 1회)
const BLOCKS: UnicodeBlock[] = (rawData as UnicodeBlockRaw[]).map((d) => ({
  ...d,
  startN: parseInt(d.start, 16),
  endN: parseInt(d.end, 16),
}));

// 후보 중 최적 레코드 선택 기준
// 1) mb 존재 우선  2) sg가 Miscellaneous가 아닌 것 우선  3) 범위가 더 좁은 것 우선
function pickBest(cands: UnicodeBlock[]): UnicodeBlock | null {
  if (!cands.length) return null;
  const scored = [...cands].map((c) => ({
    c,
    score:
      (c.mb ? 2 : 0) + // 메인 블록 가중치
      ((c.pb ? 1 : 0) + (c.sb ? 1 : 0)) - // 보조 가중치
      (c.sg === "Miscellaneous" ? 0.5 : 0), // 기타 그룹은 약간 감점
    span: c.endN - c.startN,
  }));
  scored.sort((a, b) => b.score - a.score || a.span - b.span);
  return scored[0].c;
}

export default function UnicodeInfoCard({ codePoint }: { codePoint: number }) {
  const match = useMemo(() => {
    const list = BLOCKS.filter((b) => codePoint >= b.startN && codePoint <= b.endN);
    return pickBest(list);
  }, [codePoint]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6 shadow-lg shadow-black/20">
      <div className="flex items-end justify-between gap-4 mb-3">
        <h2 className="text-lg sm:text-xl font-semibold">Unicode Character Set</h2>
        <div className="text-xs text-slate-400">U+{formatHex(codePoint)}</div>
      </div>

      {!match ? (
        <p className="text-sm text-slate-400">해당 코드포인트의 블록 정보를 찾지 못했습니다.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <InfoRow label="Script Group" value={match.sg} />
          <InfoRow label="Main Block" value={match.mb ?? "-"} />
          <InfoRow label="Presentation Block" value={match.pb ?? "-"} />
          <InfoRow label="Supplement Block" value={match.sb ?? "-"} />
          <InfoRow label="Block Title" value={match.title} />

          <div className="flex items-center gap-2">
            <span className="w-36 shrink-0 text-xs uppercase tracking-widest text-slate-400">Range</span>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="font-mono">U+{match.start}</span>
              <span className="text-slate-500">→</span>
              <span className="font-mono">U+{match.end}</span>
              <span className="text-slate-500 hidden sm:inline">|</span>
              {(() => {
                const first = findFirstDisplayable(match.startN, match.endN);
                const last  = findLastDisplayable(match.startN, match.endN);
                const firstCh = first != null ? safeChar(first) : "";
                const lastCh  = last != null ? safeChar(last) : "";
                return (
                  <>
                    <span className="rounded bg-slate-800/60 border border-slate-700 px-1.5 py-0.5 text-base min-w-[1.5rem] inline-flex items-center justify-center">
                      {firstCh || "–"}
                    </span>
                    <span className="text-slate-500">→</span>
                    <span className="rounded bg-slate-800/60 border border-slate-700 px-1.5 py-0.5 text-base min-w-[1.5rem] inline-flex items-center justify-center">
                      {lastCh || "–"}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>

          <InfoRow label="Characters" value={`${withComma(match.endN - match.startN + 1)} chars`} />

          <div className="flex items-center gap-2 md:col-span-2">
            <span className="w-36 shrink-0 text-xs uppercase tracking-widest text-slate-400">Chart (unicode.org)</span>
            <a
              href={match.href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 underline underline-offset-4"
            >
              {match.href}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M11 3a1 1 0 100 2h2.586L8.293 10.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-36 shrink-0 text-xs uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-slate-100/90">{value}</span>
    </div>
  );
}
