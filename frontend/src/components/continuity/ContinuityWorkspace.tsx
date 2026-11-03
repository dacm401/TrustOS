"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  fetchDecisions,
  fetchSessions,
  gatewayChat,
  gatewayExtract,
  type DecisionNode,
} from "@/lib/api";

// 种子数据：本场真实对话（网关无数据时首屏图；也用于本地回退）
const SEED: DecisionNode[] = [
  { id: "n1", keyword: "审计=伪需求？", tm: "起点", parent: null, prompt: "我认为是伪需求。", reply: "接受。可验证审计面向第三方证明，单用户本机威胁模型不成立；Event Backbone 改叙事为连续性。", links: ["n2", "n3"], seq: 0 },
  { id: "n2", keyword: "保留可观测", tm: "分支", parent: "n1", prompt: "个人可观测/AI行为回放我认可——多轮后自己记不住。", reply: "一致：人的记忆兜底。Event Backbone 换成连续性账本解此痛。", links: ["n3"], seq: 1 },
  { id: "n3", keyword: "继续不重来", tm: "分支", parent: "n1", prompt: "从头还是捡起来？改认的沉默成本就认了。", reply: "查代码：Event Backbone 写路径干净→复用改连续性引擎；审计层认栽冻结。", links: ["n4"], seq: 2 },
  { id: "n4", keyword: "UX=主战场", tm: "分支", parent: "n3", prompt: "要有更好的UX，agent太相似。", reply: "结构性UX才是楔子；护城河=架构原生连续性。", links: ["n5"], seq: 3 },
  { id: "n5", keyword: "Hermes太浅？", tm: "分支", parent: "n4", prompt: "桌面UI+后接Hermes是不是太浅？", reply: "浅=UI后黑盒；深=主干内当worker，动作流经网关被记录。", links: ["n6"], seq: 4 },
  { id: "n6", keyword: "选A（深）", tm: "分支", parent: "n5", prompt: "我选A，但叙事不清晰。", reply: "A：保留核心，Hermes-as-worker进主干（借脑不借壳）。", links: ["n7"], seq: 5 },
  { id: "n7", keyword: "定位文档", tm: "分支", parent: "n6", prompt: "帮我做清晰描述。", reply: "写定位文档：连续性基底，引擎在其上运行、动作原生记录。", links: ["n8"], seq: 6 },
  { id: "n8", keyword: "用户视角说明", tm: "分支", parent: "n7", prompt: "按用户体验出说明，看竞争力。", reply: "写user-facing；竞争力=引擎无关可携带连续性=反锁定楔子。", links: ["n9"], seq: 7 },
  { id: "n9", keyword: "决策树回放构想", tm: "分支", parent: "n8", prompt: "记忆回放：决策树/河流，按需非实时，节点=关键词+时间。", reply: "优于时间线；按需化解firehose；跨链定位最锋利。", links: ["n10"], seq: 8 },
  { id: "n10", keyword: "单层撑得起？", tm: "分支", parent: "n9", prompt: "只这一层+对接agent，谁会用？", reply: "不能standalone；二选一路1 embedded / 路2 图主轴+垂直。", links: ["n11"], seq: 9 },
  { id: "n11", keyword: "选路2", tm: "分支", parent: "n10", prompt: "我想做路2，机会在哪？", reply: "白空格+顺风+反锁定；致死：抽取质量/只瞥不遍历。", links: ["n12", "n13"], seq: 10 },
  { id: "n12", keyword: "胜机分析", tm: "分支", parent: "n11", prompt: "机会具体在哪？", reply: "incumbents不占decision-first白空格；autonomous失忆加剧；图可携带难抄。", links: ["n13"], seq: 11 },
  { id: "n13", keyword: "用数据做demo", tm: "当前", parent: "n11", prompt: "聊天记录你都看到吗？用我们的数据做demo。", reply: "可见本次对话；dogfooding；抽成决策图自证。", links: [], seq: 12 },
];

// v0 启发式（网关不可用时回退，保证 UX 可演示）
const DEC_RE = /(接受|改(叙事|名)|复用|冻结|认栽|结构性|深|保留|反锁定|白空格|致死|砍|停投|不重来|主战场|借脑|可携带)/;
const Q_RE = /[?？]|还是|怎么|能否|该不该|选[AB]/;
function heuristicExtract(msgs: { role: string; content: string }[]): DecisionNode[] {
  const out: DecisionNode[] = [];
  let pending: string | null = null;
  msgs.forEach((m, i) => {
    if (m.role === "user") {
      if (Q_RE.test(m.content)) pending = m.content.slice(0, 40);
    } else {
      const hit = DEC_RE.test(m.content);
      if (hit || pending) {
        const kw = m.content.match(DEC_RE);
        out.push({
          id: "h" + i,
          keyword: kw ? kw[0] : m.content.slice(0, 8),
          tm: "刚刚",
          prompt: pending || "(推进)",
          reply: m.content.slice(0, 60),
          parent: null,
          links: [],
          seq: i,
        });
        pending = null;
      }
    }
  });
  return out;
}

// id 必须为网关 modelRegistry 能 resolve 的真实模型 id（否则 extract-decisions 400）。
// 默认第一个指向本机 Ollama 常见模型；真机请按需改成本机已 pull 的模型 id。
const MODELS = [
  { id: "qwen2.5:7b", label: "Hermes（本地）" },
  { id: "deepseek-ai/DeepSeek-V4-Flash", label: "Claude（云端）" },
  { id: "gpt-4o-mini", label: "GPT（云端）" },
  { id: "llama3.1:8b", label: "本地模型" },
];

export function ContinuityWorkspace({ sessionId }: { sessionId?: string }) {
  const [nodes, setNodes] = useState<DecisionNode[]>(SEED);
  const [selected, setSelected] = useState<string | null>(null);
  const [model, setModel] = useState(MODELS[0].id);
  const [activeSession, setActiveSession] = useState<string>(sessionId || "seed");
  const [sessions, setSessions] = useState<{ session_id: string; count: number; last_at: string }[]>([]);
  const [thread, setThread] = useState<{ nodeId: string | null; messages: { role: string; content: string }[] }>({ nodeId: null, messages: [] });
  const [chatOpen, setChatOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const byKw = useMemo(() => new Map(nodes.map((n) => [n.keyword, n])), [nodes]);

  // 初始/切换会话加载：seed→种子图；真实 session→按 session_id 续接；并刷新历史会话列表
  useEffect(() => {
    let alive = true;
    if (activeSession === "seed") {
      setNodes(SEED);
      setSessions([]);
      return;
    }
    Promise.all([fetchDecisions(activeSession), fetchSessions()]).then(([nd, ss]) => {
      if (!alive) return;
      setNodes(nd.length ? nd : []);
      setSessions(ss);
    });
    return () => { alive = false; };
  }, [activeSession]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  function mergeDecisions(decisions: DecisionNode[], fallbackParent: string | null) {
    if (!decisions.length) return;
    setNodes((prev) => {
      const kwSet = new Set(prev.map((n) => n.keyword));
      const idSet = new Set(prev.map((n) => n.id));
      const added: DecisionNode[] = [];
      decisions.forEach((d, i) => {
        if (!d.keyword || kwSet.has(d.keyword)) return;
        const id = "x" + Date.now() + "_" + i;
        const parentId = d.parent && byId.has(d.parent) ? d.parent : fallbackParent;
        const node: DecisionNode = {
          id,
          keyword: d.keyword,
          tm: d.tm || "刚刚",
          prompt: d.prompt || "",
          reply: d.reply || "",
          parent: parentId,
          links: (d.links || []).filter((k) => byId.has(k)),
          seq: d.seq ?? 0,
        };
        kwSet.add(d.keyword);
        idSet.add(id);
        added.push(node);
      });
      if (added.length) showToast(`＋ ${added.length} 个新决策已抽进图`);
      return [...prev, ...added];
    });
  }

  function selectNode(id: string) {
    setSelected(id);
    setChatOpen(true);
    setThread((t) => (t.nodeId === id ? t : { nodeId: id, messages: [] }));
  }

  async function onSend() {
    const text = inputRef.current?.value.trim();
    if (!text) return;
    if (inputRef.current) inputRef.current.value = "";
    const msgs = [...thread.messages, { role: "user", content: text }];
    setThread({ nodeId: thread.nodeId, messages: msgs });
    const reply = await gatewayChat(model, msgs, activeSession);
    const finalMsgs = [...msgs, { role: "assistant", content: reply || `(本地模拟·未连网关) 已就「${text.slice(0, 18)}…」给出回复。` }];
    setThread({ nodeId: thread.nodeId, messages: finalMsgs });
    setExtracting(true);
    // 增量抽取：只把尚未抽取过的消息发给 LLM（首轮 extractedCount=0 即全量），
    // 抽完推进计数；keyword 去重保证跨轮幂等。降低 token / 延迟。
    const newMsgs = finalMsgs.slice(extractedCount);
    let dec = await gatewayExtract(model, newMsgs, activeSession);
    if (!dec.length) dec = heuristicExtract(newMsgs);
    setExtracting(false);
    setExtractedCount(finalMsgs.length);
    mergeDecisions(dec, selected);
  }

  function onSessionChange(v: string) {
    if (v === "seed") {
      setActiveSession("seed"); setNodes(SEED); setSelected(null); setThread({ nodeId: null, messages: [] }); setChatOpen(false); setExtractedCount(0);
      showToast("已续接：本场对话种子图");
    } else if (v === "new") {
      const ns = "s-" + Date.now().toString(36);
      setActiveSession(ns); setNodes([]); setSelected(null); setThread({ nodeId: null, messages: [] }); setChatOpen(true); setExtractedCount(0);
      showToast("新会话（连续性从空图开始）");
    } else {
      setActiveSession(v); setSelected(null); setThread({ nodeId: null, messages: [] }); setChatOpen(false); setExtractedCount(0);
      showToast("已续接历史会话：" + v.slice(0, 12));
    }
  }

  function refresh() {
    if (activeSession === "seed") {
      setNodes(SEED);
      showToast("已刷新（种子图）");
      return;
    }
    Promise.all([fetchDecisions(activeSession), fetchSessions()]).then(([nd, ss]) => {
      setNodes(nd.length ? nd : []);
      setSessions(ss);
      showToast("已刷新图（" + nd.length + " 节点）");
    });
  }

  // 递归渲染树
  function renderTree(parentId: string | null): JSX.Element[] {
    return nodes
      .filter((n) => (n.parent ?? null) === parentId)
      .map((n) => (
        <li key={n.id} style={{ position: "relative", padding: "7px 0 7px 20px", listStyle: "none" }}>
          {parentId !== null && (
            <>
              <span style={{ position: "absolute", left: 0, top: -7, bottom: "50%", width: 2, background: "linear-gradient(180deg,var(--accent-blue),var(--text-accent))", opacity: 0.5 }} />
              <span style={{ position: "absolute", left: 0, top: "50%", width: 18, height: 2, background: "linear-gradient(180deg,var(--accent-blue),var(--text-accent))", opacity: 0.5 }} />
            </>
          )}
          <div
            onClick={() => selectNode(n.id)}
            className="cursor-pointer trustos-node-in"
            style={{
              display: "inline-flex", flexDirection: "column", gap: 2, padding: "9px 13px",
              border: "1px solid var(--border-subtle)", borderRadius: 11,
              backgroundColor: selected === n.id ? "var(--bg-overlay)" : "var(--bg-surface)",
              boxShadow: selected === n.id ? "0 0 0 1px var(--text-accent)" : "none",
              maxWidth: 300,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>{n.keyword}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{n.tm}</span>
          </div>
          {nodes.some((c) => (c.parent ?? null) === n.id) && (
            <ul style={{ marginLeft: 24, padding: 0 }}>{renderTree(n.id)}</ul>
          )}
        </li>
      ));
  }

  const selectedNode = selected ? byId.get(selected) : null;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--bg-base)" }}>
      <style>{`
        @keyframes trustosNodeIn { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: none; } }
        .trustos-node-in { animation: trustosNodeIn 0.4s ease both; }
      `}</style>
      {/* 顶栏：无缝切脑 + 续接 */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>🌊 连续性工作台</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>决策图是主轴 · 聊天是节点的一条边 · 脑随便换，连续性是你的</div>
        </div>
        <div className="flex-1" />
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>大脑
          <select value={model} onChange={(e) => { setModel(e.target.value); showToast(`已切换大脑：${e.target.value}（决策图与连续性不变）`); }}
            style={{ marginLeft: 6, background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "5px 9px" }}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>会话
          <select value={activeSession} onChange={(e) => onSessionChange(e.target.value)}
            style={{ marginLeft: 6, background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "5px 9px" }}>
            <option value="seed">本场对话（种子）</option>
            <option value="new">＋ 新建会话</option>
            {sessions.filter((s) => s.session_id !== "seed" && s.session_id !== "new").map((s) => (
              <option key={s.session_id} value={s.session_id}>续接：{s.session_id.slice(0, 12)}…（{s.count}）</option>
            ))}
          </select>
        </label>
        <button onClick={refresh}
          style={{ marginLeft: 8, background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          ↻ 刷新
        </button>
      </div>

      {/* 主区：左图(主轴) 右聊(边) */}
      <div className="flex flex-1 overflow-hidden">
        <div className="overflow-auto p-5 border-r" style={{ width: "56%", borderColor: "var(--border-subtle)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 14 }}>
            决策图 · <b style={{ color: "var(--text-accent)" }}>主轴</b>（点节点 → 从它继续对话）
          </div>
          {nodes.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>暂无决策节点 — 开始聊天后会自动抽取。</div>
          ) : (
            <ul style={{ margin: 0, padding: 0 }}>{renderTree(null)}</ul>
          )}
        </div>

        <div className="flex flex-col flex-1" style={{ backgroundColor: "var(--bg-surface)" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)", fontSize: 13 }}>
            <div>对话边</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {selectedNode ? <>从决策 <b style={{ color: "var(--text-accent)" }}>{selectedNode.keyword}</b> 继续 — {selectedNode.reply}</> : "未选择节点 — 选左侧一个决策，或新建会话后直接开聊。"}
            </div>
          </div>

          <div ref={chatBodyRef} className="flex-1 overflow-auto p-4 flex flex-col gap-3">
            {!chatOpen && <div className="m-auto text-center" style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8 }}>← 选择一个节点，从这里继续<br />或点「新建会话」直接开始<br /><br />聊完会自动把新决策抽进左侧图。</div>}
            {chatOpen && thread.messages.length === 0 && <div className="m-auto text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>从「{selectedNode?.keyword || "新会话"}」继续。<br />聊完会自动把新决策抽进左侧图。</div>}
            {thread.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "self-end" : "self-start"} style={{
                maxWidth: "86%", padding: "9px 13px", borderRadius: 12, fontSize: 14, lineHeight: 1.55,
                backgroundColor: m.role === "user" ? "var(--accent-blue)" : "var(--bg-elevated)",
                color: m.role === "user" ? "white" : "var(--text-primary)",
                border: m.role === "user" ? "none" : "1px solid var(--border-subtle)",
              }}>{m.content}</div>
            ))}
            {extracting && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>正在抽取新决策节点…</div>}
          </div>

          <div className="flex gap-2 p-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
            <textarea ref={inputRef} placeholder="继续这个决策…" disabled={!chatOpen}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              style={{ flex: 1, resize: "none", height: 42, background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 9, padding: "10px 12px", fontSize: 14 }} />
            <button onClick={onSend} disabled={!chatOpen}
              style={{ background: "var(--accent-blue)", color: "white", border: "none", borderRadius: 9, padding: "0 18px", fontWeight: 600, cursor: chatOpen ? "pointer" : "not-allowed", opacity: chatOpen ? 1 : 0.5 }}>
              发送
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: "var(--bg-elevated)", border: "1px solid var(--text-accent)", color: "var(--text-accent)", padding: "8px 16px", borderRadius: 20, fontSize: 13, zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
