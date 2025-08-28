import React, { useMemo, useRef, useState, useEffect } from "react";
import UnicodeInfoCard from "./UnicodeInfoCard";

/**
 * Unicode Visualizer (UTF‑8/16/32)
 * - 상단: 좌측 문자(contentEditable, 한 글자 유지, IME 조합 안전) / 우측 유니코드(U+ 고정, 뒤 16진수만 편집)
 * - 입력: Enter/Space/Tab는 실제 문자를 추가하지 않되, 빈 입력칸에서 누르면 해당 코드포인트(U+000A/U+0020/U+0009)를 패널에 표시
 * - 하단: UTF-8 / UTF-16 / UTF-32 바이트 & 비트 시각화
 *   • prefix 비트 = red • payload 비트 = green • 미사용 비트(32비트 채움) = gray
 * - 표시는 Big‑Endian 기준(비트 라인 정렬 전용) + 각 인코딩 BOM 표기
 * - 반응형: 모바일=바이트 세로열 · 넓은 화면=32비트 와이드 1줄(8비트 그룹)
 */

/**
 * 🔧 Hoisted helpers (초기 상태에서 사용되는 함수는 선언문으로 미리 정의)
 */
function codePointToHex(cp: number): string {
  return (cp >>> 0).toString(16).toUpperCase();
}

export default function App() {
  const [char, setChar] = useState("🍔");
  const [cpHex, setCpHex] = useState(() => codePointToHex(char.codePointAt(0) || 0));
  const [isComposing, setIsComposing] = useState(false);
  const [pendingCp, setPendingCp] = useState<number | null>(null); // 공백/개행/탭 등 특수키를 코드포인트로만 표기

  const charRef = useRef<HTMLDivElement | null>(null);
  const codeWrapRef = useRef<HTMLDivElement | null>(null);
  const hexRef = useRef<HTMLSpanElement | null>(null); // U+ 뒤 HEX만 편집

  const codePoint = useMemo(() => {
    const cp = parseUnicodeHexToCodePoint(cpHex);
    return cp ?? (char.codePointAt(0) ?? 0);
  }, [cpHex, char]);

  const normalizedChar = useMemo(() => {
    // 입력 필드가 비워진 경우 화면에 NUL(\u0000)을 표시하지 않도록 빈 문자열 유지
    if (cpHex === "" || char === "") return "";
    try { return String.fromCodePoint(codePoint); } catch { return ""; }
  }, [codePoint, cpHex, char]);

  const normalizedHex = useMemo(() => codePointToHex(codePoint), [codePoint]);

  // 인코딩 결과
  const utf8 = useMemo(() => encodeUTF8(codePoint), [codePoint]);
  const utf16 = useMemo(() => encodeUTF16(codePoint), [codePoint]);
  const utf32 = useMemo(() => encodeUTF32(codePoint), [codePoint]);

  /** ---------- 문자 입력(IME 안전, 1글자 유지) ---------- */
  const enforceSingleGrapheme = (el: HTMLElement) => {
    let text = (el.textContent || "").replace(/\n/g, "");

    // 빈 칸에서 공백/개행 한 글자만 있는 경우 → 그대로 코드포인트로 반영
    if (text.length === 1 && (text === " " || text === "\n" || text === "\t")) {
      setChar(text);
      setCpHex(codePointToHex(text.codePointAt(0) || 0));
      placeCaretAtEnd(el);
      return;
    }

    // 트림 후 마지막 그래핑 클러스터 1개만 유지
    text = text.trim();
    const last = lastGrapheme(text);
    if (text !== last) el.textContent = last;
    setChar(last);
    if (last === "") {
      // 문자를 모두 지웠다면 코드포인트 표시도 비움
      setCpHex("");
    } else {
      setCpHex(codePointToHex(last.codePointAt(0) || 0));
    }
    placeCaretAtEnd(el);
  };

  const onCharBeforeInput = (e: React.FormEvent<HTMLDivElement> & any) => {
    // Enter/Space/Tab 자체는 문자 영역에 반영하지 않음(IME 조합 예외)
    const it = e.inputType;
    const data = e.data as string | undefined;
    const isEnter = it === "insertLineBreak" || it === "insertParagraph";
    const isSpace = it === "insertText" && data === " ";
    const isTab   = it === "insertText" && data === "\t";
    if (isEnter || isSpace || isTab) {
      e.preventDefault?.();
      const el = e.currentTarget as HTMLDivElement;
      const empty = (el.textContent || "").replace(/\n/g, "").trim().length === 0;
      if (empty) {
        const cp = isEnter ? 0x000A : isTab ? 0x0009 : 0x0020;
        setPendingCp(cp);
        setCpHex(codePointToHex(cp));
        setChar(""); // 표시용 문자는 비워두고 코드포인트만 업데이트
      }
    }
  };

  const onCharInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (isComposing) return;        // 한글 자모 조합 중에는 미개입
    if (pendingCp != null) return;  // 특수키 코드포인트 처리 중이면 패스
    enforceSingleGrapheme(e.currentTarget);
  };

  const onCharKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 키다운에서 Enter/Space/Tab 차단 + 빈 칸일 때 코드포인트로 전환
    if (e.key === "Enter" || e.key === " " || e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget as HTMLDivElement;
      const empty = (el.textContent || "").replace(/\n/g, "").trim().length === 0;
      if (empty) {
        const cp = e.key === "Enter" ? 0x000A : e.key === "Tab" ? 0x0009 : 0x0020;
        setPendingCp(cp);
        setCpHex(codePointToHex(cp));
        setChar("");
      }
    }
  };

  const onCharKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposing || pendingCp != null) return;
    enforceSingleGrapheme(e.currentTarget);
  };

  const onCharCompositionStart = () => setIsComposing(true);
  const onCharCompositionEnd = (e: React.CompositionEvent<HTMLDivElement>) => {
    setIsComposing(false);
    if (pendingCp != null) return;
    enforceSingleGrapheme(e.currentTarget);
  };

  // 외부 상태 변화 시 DOM 동기화
  useEffect(() => {
    if (charRef.current && charRef.current.textContent !== normalizedChar) {
      charRef.current.textContent = normalizedChar;
      placeCaretAtEnd(charRef.current);
    }
  }, [normalizedChar]);

  // pendingCp 처리 후 플래그 해제
  useEffect(() => {
    if (pendingCp != null) {
      if (charRef.current) {
        charRef.current.textContent = "";
        placeCaretAtEnd(charRef.current);
      }
      setPendingCp(null);
    }
  }, [pendingCp]);

  /** ---------- 코드포인트(HEX) 편집: U+ 접두 고정 ---------- */
  const sanitizeHex = (raw: string) => raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();

  const onHexKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  const onHexInput = (e: React.FormEvent<HTMLSpanElement>) => {
    const el = e.currentTarget as HTMLSpanElement;
    const cleaned = sanitizeHex(el.textContent || "");
    if ((el.textContent || "") !== cleaned) {
      el.textContent = cleaned;
    }
    // 코드포인트를 모두 지운 경우 문자도 비우기
    if (cleaned === "") {
      setCpHex("");
      setChar("");
      // 커서를 끝으로 유지
      requestAnimationFrame(() => placeCaretAtEnd(el));
      return;
    }

    setCpHex(cleaned);
    const cp = parseUnicodeHexToCodePoint(cleaned);
    if (cp != null) setChar(safeFromCodePoint(cp));
    // 좌→우 유지 및 끝으로 커서 고정
    requestAnimationFrame(() => placeCaretAtEnd(el));
  };

  // 외부 변경 시 코드포인트 DOM 동기화: 실제 입력 상태(cpHex)를 기준으로 표시
  useEffect(() => {
    if (hexRef.current && (hexRef.current.textContent || "") !== cpHex) {
      hexRef.current.textContent = cpHex;
      requestAnimationFrame(() => placeCaretAtEnd(hexRef.current!));
    }
  }, [cpHex]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="px-6 py-5 border-b border-slate-800 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-slate-950/70">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            <a href="/" className="flex items-center gap-3">
              <img src="/logo.svg" alt="Unicode Visualizer" className="h-8 w-auto" />
              <span className="sr-only">Unicode Visualizer</span>
            </a>
          </h1>
          <div className="text-xs sm:text-sm text-slate-400">
            Big‑Endian · <span className="text-red-400">prefix</span> / <span className="text-emerald-400">payload</span> / <span className="text-slate-400">unused</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 grid gap-6">
        {/* 입력 영역 */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 문자 입력 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6 shadow-lg shadow-black/20">
            <div className="text-sm uppercase tracking-widest text-slate-400 mb-3">문자</div>
            <div
              ref={charRef}
              contentEditable
              suppressContentEditableWarning
              onBeforeInput={onCharBeforeInput}
              onInput={onCharInput}
              onKeyDown={onCharKeyDown}
              onKeyUp={onCharKeyUp}
              onCompositionStart={onCharCompositionStart}
              onCompositionEnd={onCharCompositionEnd}
              className="select-text focus:outline-none rounded-xl bg-slate-900/70 border border-slate-800 px-4 py-6 text-5xl sm:text-6xl lg:text-7xl font-medium leading-none text-center caret-white"
              spellCheck={false}
              onFocus={(e) => placeCaretAtEnd(e.currentTarget)}
            >
              {normalizedChar}
            </div>
            <p className="mt-3 text-xs text-slate-400">한글 IME 조합/Enter/Space 대응. 항상 1글자 유지, 빈 칸에서 특수키 시 코드포인트 패널만 업데이트.</p>
          </div>

          {/* 유니코드 입력 (U+ 접두 고정) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6 shadow-lg shadow-black/20">
            <div className="text-sm uppercase tracking-widest text-slate-400 mb-3">유니코드 코드포인트</div>
            <div
              ref={codeWrapRef}
              className="select-text rounded-xl bg-slate-900/70 border border-slate-800 px-4 py-6 text-3xl sm:text-4xl lg:text-5xl font-mono leading-none text-center"
              dir="ltr"
              onClick={(e) => {
                // 래퍼 아무 곳을 클릭해도 HEX 편집 스팬으로 포커스 이동
                if (e.target !== hexRef.current) {
                  hexRef.current?.focus();
                  requestAnimationFrame(() => placeCaretAtEnd(hexRef.current!));
                }
              }}
            >
              <span className="text-slate-400" contentEditable={false}>U+</span>
              <span
                ref={hexRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onKeyDown={onHexKeyDown}
                onInput={onHexInput}
                className="outline-none caret-white"
                dir="ltr"
              >
                {cpHex}
              </span>
            </div>
            <p className="mt-3 text-xs text-slate-400">편집 가능 영역은 <code className="font-mono">U+</code> 뒤 16진수입니다. Enter는 비활성화.</p>
          </div>
        </section>

        {/* Unicode 블록 정보 */}
        <section>
          <UnicodeInfoCard codePoint={codePoint} />
        </section>

        {/* 결과 패널 */}
        <section className="grid grid-cols-1 gap-4">
          <EncodingPanel title="UTF‑8" result={utf8} codePoint={codePoint} />
          <EncodingPanel title="UTF‑16" result={utf16} codePoint={codePoint} />
          <EncodingPanel title="UTF‑32" result={utf32} codePoint={codePoint} />
        </section>
      </main>

      <footer className="border-t border-slate-800 mt-8">
        <div className="max-w-6xl mx-auto px-6 py-6 text-sm text-slate-400 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-400">
            © {new Date().getFullYear()} HunyDev · Unicode Visualizer
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="사이트 링크">
            <a href="https://huny.dev" className="hover:text-slate-200 transition-colors" target="_blank" rel="noopener noreferrer">huny.dev</a>
            <a href="https://blog.huny.dev" className="hover:text-slate-200 transition-colors" target="_blank" rel="noopener noreferrer">Blog</a>
            <a href="https://apps.huny.dev" className="hover:text-slate-200 transition-colors" target="_blank" rel="noopener noreferrer">Apps</a>
            <a href="https://docs.huny.dev" className="hover:text-slate-200 transition-colors" target="_blank" rel="noopener noreferrer">Docs</a>
            <a href="https://github.com/hunydev" className="hover:text-slate-200 transition-colors" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://discord.gg/pvKNgUkr" className="hover:text-slate-200 transition-colors" target="_blank" rel="noopener noreferrer">Discord</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** ---------- 표시 컴포넌트 ---------- */

type BitKind = "prefix" | "payload" | "unused";

type BitCell = { bit: string; kind: BitKind };

type EncodingResult = {
  name: string;
  bytes: number[]; // BE 바이트
  bits: BitCell[][]; // 각 바이트(8비트)의 분류
  hexes: string[];  // 2자리 HEX
  note?: string;
};

function EncodingPanel({ title, result, codePoint }: { title: string; result: EncodingResult; codePoint: number }) {
  const bomList = useMemo(() => getBOMFor(title), [title]);
  const wide32 = useMemo(() => toWide32(result.bits), [result.bits]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6 shadow-lg shadow-black/20">
      <div className="flex items-end justify-between gap-4 mb-3">
        <h2 className="text-lg sm:text-xl font-semibold">{title}</h2>
        <div className="text-xs text-slate-400">U+{codePoint.toString(16).toUpperCase().padStart(4, "0")}</div>
      </div>

      {/* 바이트(HEX) */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {result.hexes.map((h, i) => (
          <div key={i} className="px-2 py-1 rounded-lg bg-slate-800/70 border border-slate-700 font-mono text-sm">
            {h}
          </div>
        ))}
      </div>

      {/* BOM 정보 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-slate-400 mr-1">BOM:</span>
        {bomList.map((b, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs">
            <span className="px-1.5 py-0.5 rounded-md bg-slate-800/70 border border-slate-700">{b.label}</span>
            <span className="px-1.5 py-0.5 rounded-md bg-slate-900/70 border border-slate-800 font-mono tracking-wider">{b.hexes.join(" ")}</span>
          </span>
        ))}
        {title === "UTF‑8" && <span className="text-[10px] text-slate-500 ml-2">(선택적)</span>}
      </div>

      {/* 비트: 모바일(세로 바이트 그리드) */}
      <div className="flex flex-col gap-2 md:hidden">
        {result.bits.map((byteBits, bi) => (
          <div key={bi} className="flex gap-1 flex-wrap">
            {byteBits.map((b, i) => (<Bit b={b} key={i} />))}
          </div>
        ))}
      </div>

      {/* 비트: 넓은 화면(32비트 와이드, 8비트 그룹) */}
      <div className="hidden md:flex md:flex-row md:flex-wrap md:gap-0">
        {wide32.map((group, gi) => (
          <div key={gi} className="flex gap-1 mr-3 last:mr-0 mb-0.5">
            {group.map((cell, ci) => (<Bit b={cell} key={ci} />))}
          </div>
        ))}
      </div>

      {result.note && <p className="mt-3 text-xs text-slate-400">{result.note}</p>}

      {/* 범례 */}
      <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-red-500/60 inline-block" /> prefix</span>
        <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-emerald-500/60 inline-block" /> payload</span>
        <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-slate-600 inline-block" /> unused</span>
      </div>
    </div>
  );
}

function Bit({ b }: { b: BitCell }) {
  const base = "w-5 h-7 inline-flex items-center justify-center rounded-md border text-sm font-mono ";
  const color = b.kind === "prefix"
    ? "bg-red-500/15 border-red-400/40 text-red-300"
    : b.kind === "payload"
    ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
    : "bg-slate-800/60 border-slate-700/60 text-slate-400"; // unused
  return <span className={base + color} title={b.kind}>{b.bit}</span>;
}

/** ---------- 유틸 & 인코딩 ---------- */

function lastGrapheme(s: string): string {
  if (!s) return "";
  const arr = Array.from(s); // 코드포인트 단위
  return arr.length ? arr[arr.length - 1] : "";
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function parseUnicodeHexToCodePoint(inputHex: string): number | null {
  if (!inputHex) return null;
  const s = inputHex.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!s) return null;
  const cp = parseInt(s, 16);
  if (Number.isNaN(cp) || cp < 0 || cp > 0x10ffff) return null;
  return cp;
}

function safeFromCodePoint(cp: number): string { try { return String.fromCodePoint(cp); } catch { return ""; } }

function bitsOfByte(n: number): string[] { return n.toString(2).padStart(8, "0").split(""); }

function classify(bits: string[], prefixLen: number): BitCell[] {
  return bits.map((b, i) => ({ bit: b, kind: i < prefixLen ? "prefix" : "payload" }));
}

function unusedCells(n: number): BitCell[] {
  return Array.from({ length: n }, () => ({ bit: "·", kind: "unused" as const }));
}

// 32비트 와이드 라인으로 변환(좌측에 미사용 비트 채움). 입력은 바이트 단위 BitCell[][] (BE 순서)
function toWide32(byteRows: BitCell[][]): BitCell[][] {
  const flat = byteRows.flat();
  const used = flat.length; // 사용 중인 비트 수
  const missing = Math.max(0, 32 - used);
  const filled = [...unusedCells(missing), ...flat];
  // 8비트 단위 4그룹으로 분할
  return [filled.slice(0, 8), filled.slice(8, 16), filled.slice(16, 24), filled.slice(24, 32)];
}

function encodeUTF8(cp: number): EncodingResult {
  let bytes: number[] = [];
  let bits: BitCell[][] = [];
  if (cp <= 0x7f) {
    bytes = [cp];
    bits = [classify(bitsOfByte(bytes[0]), 1)]; // 0xxxxxxx
  } else if (cp <= 0x7ff) {
    const b1 = 0b11000000 | ((cp >> 6) & 0b00011111);
    const b2 = 0b10000000 | (cp & 0b00111111);
    bytes = [b1, b2];
    bits = [classify(bitsOfByte(b1), 3), classify(bitsOfByte(b2), 2)]; // 110 / 10
  } else if (cp <= 0xffff) {
    const b1 = 0b11100000 | ((cp >> 12) & 0b00001111);
    const b2 = 0b10000000 | ((cp >> 6) & 0b00111111);
    const b3 = 0b10000000 | (cp & 0b00111111);
    bytes = [b1, b2, b3];
    bits = [classify(bitsOfByte(b1), 4), classify(bitsOfByte(b2), 2), classify(bitsOfByte(b3), 2)]; // 1110 / 10 / 10
  } else {
    const b1 = 0b11110000 | ((cp >> 18) & 0b00000111);
    const b2 = 0b10000000 | ((cp >> 12) & 0b00111111);
    const b3 = 0b10000000 | ((cp >> 6) & 0b00111111);
    const b4 = 0b10000000 | (cp & 0b00111111);
    bytes = [b1, b2, b3, b4];
    bits = [classify(bitsOfByte(b1), 5), classify(bitsOfByte(b2), 2), classify(bitsOfByte(b3), 2), classify(bitsOfByte(b4), 2)]; // 11110 / 10 / 10 / 10
  }
  return { name: "UTF-8", bytes, bits, hexes: bytes.map(b => b.toString(16).toUpperCase().padStart(2, "0")), note: "1–4바이트 가변. 선두=형식, 연속=10" };
}

function encodeUTF16(cp: number): EncodingResult {
  let bytes: number[] = [];
  let bits: BitCell[][] = [];
  let note = "";
  if (cp <= 0xffff) {
    if (cp >= 0xd800 && cp <= 0xdfff) {
      // 단일 서러게이트: 시각화만, payload 처리
      const hi = (cp >> 8) & 0xff, lo = cp & 0xff;
      bytes = [hi, lo];
      bits = [[...classify(bitsOfByte(hi), 0)], [...classify(bitsOfByte(lo), 0)]];
      note = "서러게이트 단독(U+D800–U+DFFF)은 유효 코드포인트 아님";
    } else {
      const hi = (cp >> 8) & 0xff, lo = cp & 0xff;
      bytes = [hi, lo];
      bits = [[...classify(bitsOfByte(hi), 0)], [...classify(bitsOfByte(lo), 0)]];
      note = "BMP 문자는 2바이트(BE)";
    }
  } else {
    const v = cp - 0x10000; // 20비트
    const high = 0xd800 | ((v >> 10) & 0x3ff); // 110110xxxxxxxxxx
    const low  = 0xdc00 | (v & 0x3ff);        // 110111xxxxxxxxxx
    const bytesBE = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
    bytes = bytesBE;
    const highBits = numberToBits16(high);
    const lowBits  = numberToBits16(low);
    const highCells: BitCell[] = highBits.map((b, i) => ({ bit: b, kind: (i < 6 ? "prefix" : "payload") as BitKind }));
    const lowCells: BitCell[]  = lowBits.map((b, i)  => ({ bit: b, kind: (i < 6 ? "prefix" : "payload") as BitKind }));
    bits = [highCells.slice(0,8), highCells.slice(8), lowCells.slice(0,8), lowCells.slice(8)];
    note = "보조 평면은 서러게이트 쌍(110110/110111)";
  }
  return { name: "UTF-16", bytes, bits, hexes: bytes.map(b => b.toString(16).toUpperCase().padStart(2, "0")), note };
}

function encodeUTF32(cp: number): EncodingResult {
  const b1 = (cp >>> 24) & 0xff, b2 = (cp >>> 16) & 0xff, b3 = (cp >>> 8) & 0xff, b4 = cp & 0xff;
  const bytes = [b1, b2, b3, b4];
  const bits  = bytes.map(b => classify(bitsOfByte(b), 0));
  return { name: "UTF-32", bytes, bits, hexes: bytes.map(b => b.toString(16).toUpperCase().padStart(2, "0")), note: "4바이트 고정" };
}

function numberToBits16(n: number): string[] { return n.toString(2).padStart(16, "0").split(""); }

/** ---------- BOM 도우미 ---------- */

type BomInfo = { label: string; hexes: string[] };

function getBOMFor(encodingName: string): BomInfo[] {
  switch (encodingName) {
    case "UTF‑8":  return [{ label: "UTF-8",    hexes: ["EF", "BB", "BF"] }];
    case "UTF‑16": return [{ label: "UTF-16BE", hexes: ["FE", "FF"] }, { label: "UTF-16LE", hexes: ["FF", "FE"] }];
    case "UTF‑32": return [{ label: "UTF-32BE", hexes: ["00", "00", "FE", "FF"] }, { label: "UTF-32LE", hexes: ["FF", "FE", "00", "00"] }];
    default: return [];
  }
}
