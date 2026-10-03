import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  projects as projectsApi,
  providers as providersApi,
  voices as voicesApi,
  type AssetRecord,
  type JobRecord,
  type ProjectRecord,
  type ProviderRecord,
  type VoiceRecord,
} from "@/lib/api";
import { Modal } from "@/features/shared/Modal";
import { Chevron, Dots, Menu, type MenuEntry } from "@/features/editors/Menu";

/* ==========================================================================
   Flows 画布.

   参考证据 052–061。真正定义这块画布的是 058（画布）、059（添加节点菜单）、
   060（文件菜单）；交互记录另注明 051–061 没有执行节点、没有改连线，所以下面
   只把实测到的行为当作「已验证」。

   实心实现：节点拖动、端口到端口连线（按类型校验）、按依赖顺序运行子图、
   真实任务提交（文本转语音 / 图像生成 / 视频生成 / 音效）、取消、撤销重做、
   本地保存与修订冲突提示、模板复制、重命名、删除。

   明确不做：分享与头像（SCOPE.md 移除云协作）。口型同步、图像编辑/放大/去背景在
   契约里没有任务类型，菜单里是禁用并给出原因，不是占位。

   比例 / 分辨率 / 生成音频：runner 与适配器确实把 job.input.aspectRatio /
   resolution / sound 转发给上游，且只在页面真的设了值时才转发。但从未用真实
   密钥调用过，上游是否采纳这三个字段仍属未验证 —— 控件旁如实标注，不宣称它
   一定改变输出。
   ========================================================================== */

type PortKind = "text" | "image" | "video" | "audio";
type NodeKind = "generate" | "text" | "image" | "upload";
type Modality = "image" | "video";
type Graph = { nodes: FlowNode[]; edges: Edge[] };
type RunMode = "all" | "downstream" | "single";

/* 058 只记录了控件当前选中的那一个值，没有记录下拉里的完整选项。按项目红线
   （不编造时长/能力），这里只列实测到的值，不按常见档位补齐。 */
const RATIOS = ["16:9"];
const RESOLUTIONS = ["1080p"];
const DURATIONS = [10];

/** 端口纵向位置：连线的端点要落在圆点上，改这里要同步改 PORT_TOP/PORT_STEP。 */
const PORT_TOP = 54;
const PORT_STEP = 34;
/** 素材节点的出线口贴着图片顶边，生成节点的出线口在结果区中段。 */
const OUT_TOP = 56;
const MEDIA_OUT_TOP = 20;
/** 圆点半径：按钮按「圆心对准坐标」定位，所以要从偏移里减掉它。 */
const PORT_R = 7;

const NODE_WIDTH: Record<NodeKind, number> = {
  generate: 400,
  text: 240,
  image: 240,
  upload: 240,
};

interface Port {
  id: string;
  kind: PortKind;
}

interface NodeOutput {
  assetId: string;
  url: string;
}

type RunStatus = "running" | "succeeded" | "failed" | "skipped" | "blocked";

interface RunRecord {
  status: RunStatus;
  jobId?: string;
  message?: string;
}

interface FlowNode {
  id: string;
  type: NodeKind;
  label: string;
  x: number;
  y: number;
  inputs: Port[];
  prompt: string;
  model: string;
  modality: Modality;
  ratio: string;
  resolution: string;
  duration: number;
  sound: boolean;
  voiceId: string;
  assetId: string | null;
  /** 每次「重跑」加一：任务 intent 变了，旧的幂等记录不会被当成新提交。 */
  attempt: number;
  outputs: NodeOutput[];
  comment: string;
  lastRun?: RunRecord;
}

interface Edge {
  from: { node: string; port: string };
  to: { node: string; port: string };
}

/** 连到某个节点的图片输入：结果区左缘的参考图缩略图。 */
interface NodeRef {
  url: string;
  label: string;
}

const PORT_GLYPH: Record<PortKind, string> = {
  text: "T",
  image: "▣",
  video: "▶",
  audio: "♪",
};

const DEFAULT_LABEL: Record<NodeKind, string> = {
  generate: "生成节点",
  text: "文本转语音",
  image: "参考图",
  upload: "上传媒体",
};

/* ------------------------------------------------------------ 读存量 -- */

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/** 上一版把端口存成 string[]；两种形状都读，存量工程才打得开。 */
function normalizePorts(raw: unknown, type: NodeKind): Port[] {
  const list = Array.isArray(raw) ? raw : [];
  const parsed: Port[] = list
    .map((p) => {
      if (typeof p === "string") return { id: p, kind: "text" as PortKind };
      if (p && typeof p === "object") {
        const o = p as { id?: unknown; kind?: unknown };
        if (typeof o.id !== "string") return null;
        const kind = (["text", "image", "video", "audio"] as PortKind[]).includes(o.kind as PortKind)
          ? (o.kind as PortKind)
          : "text";
        return { id: o.id, kind };
      }
      return null;
    })
    .filter((p): p is Port => p !== null);
  if (parsed.length > 0) return parsed;
  // 上一版新建的节点端口列表是空的。按类型补默认端口，图才是可运行的。
  if (type === "generate")
    return [
      { id: "in-text", kind: "text" },
      { id: "in-image", kind: "image" },
      { id: "in-video", kind: "video" },
      { id: "in-audio", kind: "audio" },
    ];
  if (type === "text") return [{ id: "in-text", kind: "text" }];
  return [];
}

function normalizeNode(raw: unknown, index: number): FlowNode {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const known = r.type as NodeKind;
  const type: NodeKind = (["generate", "text", "image", "upload"] as NodeKind[]).includes(known)
    ? known
    : // 上一版的 image 节点是参考图，video 节点带参数，就是现在的生成节点。
      r.type === "image"
      ? "image"
      : "generate";
  const run = r.lastRun as RunRecord | undefined;
  return {
    id: str(r.id, "") || `n${index + 1}`,
    type,
    label: str(r.label, "") || DEFAULT_LABEL[type],
    x: num(r.x, 120 + (index % 3) * 320),
    y: num(r.y, 120 + Math.floor(index / 3) * 240),
    inputs: normalizePorts(r.inputs, type),
    prompt: str(r.prompt, ""),
    model: str(r.model, ""),
    modality: r.modality === "image" ? "image" : "video",
    ratio: str(r.ratio, RATIOS[0]),
    resolution: str(r.resolution, RESOLUTIONS[1]),
    duration: num(r.duration, 10),
    sound: r.sound === true,
    voiceId: str(r.voiceId, ""),
    assetId: typeof r.assetId === "string" && r.assetId ? r.assetId : null,
    attempt: num(r.attempt, 0),
    outputs: Array.isArray(r.outputs)
      ? (r.outputs as NodeOutput[]).filter(
          (o) => o && typeof o.assetId === "string" && typeof o.url === "string",
        )
      : [],
    comment: str(r.comment, ""),
    lastRun: run && typeof run.status === "string" ? run : undefined,
  };
}

function normalizeEdge(raw: unknown): Edge | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as { from?: unknown; to?: unknown };
  const f = e.from as { node?: unknown; port?: unknown } | undefined;
  const t = e.to as { node?: unknown; port?: unknown } | undefined;
  if (!f || !t || typeof f.node !== "string" || typeof t.node !== "string") return null;
  return { from: { node: f.node, port: str(f.port, "out") }, to: { node: t.node, port: str(t.port, "in-text") } };
}

/** 上传媒体没选文件时返回 null：这种节点不能当连线源。 */
function outputKind(n: FlowNode, assets: AssetRecord[]): PortKind | null {
  if (n.type === "generate") return n.modality === "image" ? "image" : "video";
  if (n.type === "text") return "audio";
  const asset = assets.find((a) => a.id === n.assetId);
  if (!asset) return null;
  if (asset.mediaType.startsWith("image/")) return "image";
  if (asset.mediaType.startsWith("video/")) return "video";
  return "audio";
}

/** 出线口的纵向偏移。058 里素材节点的圆点贴着图片顶边，生成节点在结果区中段。 */
function outTop(n: FlowNode): number {
  return n.type === "image" || n.type === "upload" ? MEDIA_OUT_TOP : OUT_TOP;
}

/** 连到该节点的图片输入所带的素材。没有产物或没选文件时不显示缩略图。 */
function refsFor(
  node: FlowNode,
  nodes: FlowNode[],
  edges: Edge[],
  assets: AssetRecord[],
): NodeRef[] {
  const out: NodeRef[] = [];
  for (const e of edges) {
    if (e.to.node !== node.id) continue;
    if (node.inputs.find((p) => p.id === e.to.port)?.kind !== "image") continue;
    const src = nodes.find((n) => n.id === e.from.node);
    if (!src) continue;
    const url =
      src.outputs[src.outputs.length - 1]?.url ?? assets.find((a) => a.id === src.assetId)?.url;
    if (url) out.push({ url, label: src.label });
  }
  return out;
}

/* ================================================================= page == */

export function FlowCanvas() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(75);
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [voiceReason, setVoiceReason] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [runs, setRuns] = useState<Record<string, RunRecord>>({});
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [linking, setLinking] = useState<{ node: string; x: number; y: number } | null>(null);
  const [tool, setTool] = useState<"pointer" | "hand" | "comment">("pointer");
  const [running, setRunning] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [addMenu, setAddMenu] = useState(false);
  const [menuTab, setMenuTab] = useState<"image" | "video" | "audio" | "text">("image");
  const [menuQuery, setMenuQuery] = useState("");
  const [renamingNode, setRenamingNode] = useState<FlowNode | null>(null);
  const [renameText, setRenameText] = useState("");
  const [commentingNode, setCommentingNode] = useState<FlowNode | null>(null);
  const [commentText, setCommentText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templates, setTemplates] = useState<ProjectRecord[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [renameFlowOpen, setRenameFlowOpen] = useState(false);
  const [flowName, setFlowName] = useState("");

  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ node: string; dx: number; dy: number; before: Graph } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const past = useRef<Graph[]>([]);
  const future = useRef<Graph[]>([]);
  const editBase = useRef<Graph | null>(null);
  const [histLen, setHistLen] = useState({ past: 0, future: 0 });
  const abort = useRef(false);
  const liveJob = useRef<string | null>(null);
  // 撤销/重做要在 keydown 里用，必须读得到最新图，不能只闭包旧值。
  const graphRef = useRef<Graph>({ nodes: [], edges: [] });
  graphRef.current = { nodes, edges };
  const projectRef = useRef<ProjectRecord | null>(null);
  projectRef.current = project;
  const providerRef = useRef<ProviderRecord | null>(null);
  providerRef.current = provider;

  const available = provider?.validationState === "available";

  /* ---------------------------------------------------------- loading -- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await projectsApi.list();
        const found = all.find((p) => p.id === id) ?? null;
        if (cancelled) return;
        if (!found) {
          setNote("找不到该 Flow。");
          return;
        }
        setProject(found);
        setFlowName(found.name);
        setNodes(Array.isArray(found.content.nodes) ? found.content.nodes.map(normalizeNode) : []);
        setEdges(
          Array.isArray(found.content.edges)
            ? found.content.edges.map(normalizeEdge).filter((e): e is Edge => e !== null)
            : [],
        );

        const [p, a, v] = await Promise.all([
          providersApi.list(),
          assetsApi.list(),
          voicesApi.list().catch(() => ({ voices: [] as VoiceRecord[], reason: "读取音色失败" })),
        ]);
        if (cancelled) return;
        const usable = p.find((x) => x.validationState === "available") ?? null;
        setProvider(usable ?? p[0] ?? null);
        setAssets(a.assets);
        setVoices(v.voices);
        setVoiceReason(v.reason ?? null);
        if (v.voices[0]) {
          setNodes((ns) =>
            ns.map((n) =>
              n.type === "text" && !n.voiceId ? { ...n, voiceId: v.voices[0].voiceId } : n,
            ),
          );
        }
        if (usable) {
          const m = await providersApi.models(usable.id).catch(() => ({ models: [] }));
          if (!cancelled) setProviderModels(m.models.map((x) => x.id));
        }
      } catch (err) {
        if (!cancelled) setNote(err instanceof ApiError ? err.message : "读取失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ------------------------------------------------------------ 历史 -- */

  function syncHist() {
    setHistLen({ past: past.current.length, future: future.current.length });
  }

  function record(before: Graph) {
    past.current.push(before);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    syncHist();
  }

  /** 结构性改动（增删节点/连线）：改之前先存一份。 */
  function structural(next: Graph) {
    record(graphRef.current);
    setNodes(next.nodes);
    setEdges(next.edges);
    setDirty(true);
  }

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(graphRef.current);
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setDirty(true);
    syncHist();
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(graphRef.current);
    setNodes(next.nodes);
    setEdges(next.edges);
    setDirty(true);
    syncHist();
  }, []);

  /** 输入框类改动：聚焦时留底，失焦时若真的变了才进历史。 */
  function beginEdit() {
    editBase.current = graphRef.current;
  }
  function endEdit() {
    const before = editBase.current;
    editBase.current = null;
    if (!before) return;
    if (JSON.stringify(before) === JSON.stringify(graphRef.current)) return;
    record(before);
  }

  const save = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return;
    const g = graphRef.current;
    try {
      const saved = await projectsApi.save(p.id, { ...p.content, ...g });
      setProject(saved);
      setDirty(false);
      setNote(`已保存，修订 ${saved.revision}。`);
    } catch (err) {
      setNote(
        err instanceof ApiError && err.isConflict
          ? "修订冲突：另一处改过这张画布。先刷新再决定保留哪一版。"
          : err instanceof ApiError
            ? err.message
            : "保存失败",
      );
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, save]);

  /* --------------------------------------------------------- 拖动/连线 -- */

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = canvas.current;
      if (!el) return;
      if (drag.current) {
        const d = drag.current;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left + el.scrollLeft;
        const y = e.clientY - rect.top + el.scrollTop;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === d.node ? { ...n, x: Math.max(0, x - d.dx), y: Math.max(0, y - d.dy) } : n,
          ),
        );
        return;
      }
      if (pan.current) {
        el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
        el.scrollTop = pan.current.top - (e.clientY - pan.current.y);
        return;
      }
      if (linking) {
        const rect = el.getBoundingClientRect();
        setLinking({
          node: linking.node,
          x: e.clientX - rect.left + el.scrollLeft,
          y: e.clientY - rect.top + el.scrollTop,
        });
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      if (d) {
        // 拖动只在抬手时记一次历史，否则每帧都进撤销栈。
        if (JSON.stringify(d.before.nodes) !== JSON.stringify(graphRef.current.nodes)) {
          record(d.before);
          setDirty(true);
        }
      }
      pan.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [linking]);

  function startDrag(e: React.PointerEvent, node: FlowNode) {
    const el = canvas.current;
    if (tool !== "pointer" || !el) return;
    const rect = el.getBoundingClientRect();
    drag.current = {
      node: node.id,
      dx: e.clientX - rect.left + el.scrollLeft - node.x,
      dy: e.clientY - rect.top + el.scrollTop - node.y,
      before: graphRef.current,
    };
    setSelected(node.id);
  }

  function startPan(e: React.PointerEvent) {
    const el = canvas.current;
    if (tool !== "hand" || !el) return;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  }

  function startLink(e: React.PointerEvent, nodeId: string) {
    e.stopPropagation();
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setLinking({
      node: nodeId,
      x: e.clientX - rect.left + el.scrollLeft,
      y: e.clientY - rect.top + el.scrollTop,
    });
  }

  function finishLink(targetNode: string, targetPort: string) {
    const from = linking;
    setLinking(null);
    if (!from || from.node === targetNode) return;
    if (
      edges.some(
        (e) => e.from.node === from.node && e.to.node === targetNode && e.to.port === targetPort,
      )
    ) {
      return;
    }
    const source = nodes.find((n) => n.id === from.node);
    const target = nodes.find((n) => n.id === targetNode);
    if (source && target) {
      const out = outputKind(source, assets);
      const port = target.inputs.find((p) => p.id === targetPort);
      if (out === null) {
        setNote(`「${source.label}」还没有素材，输出类型未知，连线未建立。`);
        return;
      }
      if (port && out !== port.kind) {
        setNote(
          `类型不匹配：${source.label} 输出${PORT_GLYPH[out]}，${target.label} 这个端口要${PORT_GLYPH[port.kind]}。`,
        );
        return;
      }
    }
    structural({
      nodes,
      edges: [...edges, { from: { node: from.node, port: "out" }, to: { node: targetNode, port: targetPort } }],
    });
  }

  function patchNode(nodeId: string, patch: Partial<FlowNode>) {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
    setDirty(true);
  }

  function removeNode(nodeId: string) {
    structural({
      nodes: nodes.filter((n) => n.id !== nodeId),
      edges: edges.filter((e) => e.from.node !== nodeId && e.to.node !== nodeId),
    });
    if (selected === nodeId) setSelected(null);
  }

  function addNode(kind: NodeKind, label: string, modality: Modality) {
    const el = canvas.current;
    const node = normalizeNode({ type: kind, label, modality }, 0);
    node.id = `n${Date.now().toString(36)}`;
    node.x = el ? el.scrollLeft + 60 : 60;
    node.y = el ? el.scrollTop + 40 : 40;
    structural({ nodes: [...nodes, node], edges });
    setSelected(node.id);
    setAddMenu(false);
  }

  async function uploadInto(node: FlowNode, file: File) {
    try {
      const res = await assetsApi.upload(file);
      setAssets((a) => [...a, res.asset]);
      patchNode(node.id, { assetId: res.asset.id });
      setNote(`${file.name} 已上传到本机素材库并接入该节点。`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "上传失败");
    }
  }

  /* ------------------------------------------------------------ 文件 -- */

  async function duplicateFlow() {
    const p = projectRef.current;
    if (!p) return;
    const copy = await projectsApi.create({
      kind: "flow",
      name: `${p.name}（副本）`,
      content: { ...p.content, nodes, edges },
    });
    navigate(`/app/flows/${copy.id}`);
  }

  async function renameFlow() {
    const p = projectRef.current;
    if (!p || !flowName.trim()) return;
    try {
      const saved = await projectsApi.save(
        p.id,
        { ...p.content, nodes, edges },
        flowName.trim(),
      );
      setProject(saved);
      setRenameFlowOpen(false);
      setNote("已重命名。");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "重命名失败");
    }
  }

  async function saveTemplate() {
    const p = projectRef.current;
    if (!p) return;
    const t = await projectsApi.create({
      kind: "flow-template",
      name: `${p.name} 模板`,
      content: { nodes, edges },
    });
    setTemplates((ts) => [t, ...ts]);
    setNote("已存为本地模板：只在这台机器上复制用，不上传。");
  }

  async function deleteFlow() {
    const p = projectRef.current;
    if (!p) return;
    await projectsApi.remove(p.id);
    navigate("/app/flows");
  }

  /* ------------------------------------------------------------- 运行 -- */

  function subgraph(target: string | null, mode: RunMode): string[] {
    if (mode === "all" || !target) return nodes.map((n) => n.id);
    if (mode === "single") return [target];
    const set = new Set<string>([target]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) {
        if (set.has(e.from.node) && !set.has(e.to.node)) {
          set.add(e.to.node);
          grew = true;
        }
      }
    }
    return nodes.filter((n) => set.has(n.id)).map((n) => n.id);
  }

  function topoOrder(ids: string[]): { order: string[]; cycle: string[] } {
    const inSet = new Set(ids);
    const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
    for (const e of edges) {
      if (inSet.has(e.from.node) && inSet.has(e.to.node)) {
        indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
      }
    }
    const queue = ids.filter((i) => (indeg.get(i) ?? 0) === 0);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift() as string;
      order.push(id);
      for (const e of edges) {
        if (e.from.node !== id || !inSet.has(e.to.node)) continue;
        const next = (indeg.get(e.to.node) ?? 0) - 1;
        indeg.set(e.to.node, next);
        if (next === 0) queue.push(e.to.node);
      }
    }
    const done = new Set(order);
    return { order, cycle: ids.filter((i) => !done.has(i)) };
  }

  /** 提交前检查：环、悬空端口、类型不匹配、缺提示词/音色。 */
  function preflight(ids: string[]): { problems: string[]; blocked: Map<string, string> } {
    const problems: string[] = [];
    const blocked = new Map<string, string>();
    const inSet = new Set(ids);
    const { cycle } = topoOrder(ids);
    if (cycle.length) {
      problems.push(`存在环：${cycle.map(labelOf).join(" → ")}`);
    }
    for (const e of edges) {
      if (!inSet.has(e.from.node) || !inSet.has(e.to.node)) continue;
      const from = nodes.find((n) => n.id === e.from.node);
      const to = nodes.find((n) => n.id === e.to.node);
      if (!from || !to) {
        problems.push("有一条连线指向不存在的节点");
        continue;
      }
      const out = outputKind(from, assets);
      const port = to.inputs.find((p) => p.id === e.to.port);
      if (!port) {
        problems.push(`「${to.label}」上没有名为 ${e.to.port} 的端口`);
      } else if (out === null) {
        problems.push(`「${from.label}」没有素材，输出类型未知`);
      } else if (out !== port.kind) {
        problems.push(
          `类型不匹配：${from.label} → ${to.label}（${PORT_GLYPH[out]} 到 ${PORT_GLYPH[port.kind]}）`,
        );
      }
    }
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id);
      if (!n || (n.type !== "generate" && n.type !== "text")) continue;
      const hasTextInput = edges.some((e) => {
        if (e.to.node !== id) return false;
        return n.inputs.find((p) => p.id === e.to.port)?.kind === "text";
      });
      if (!hasTextInput && !n.prompt.trim()) blocked.set(id, "缺少提示词");
      if (n.type === "text" && !n.voiceId) blocked.set(id, "还没有选择音色");
    }
    return { problems, blocked };

    function labelOf(id: string) {
      return nodes.find((n) => n.id === id)?.label ?? id;
    }
  }

  async function pollAsset(
    jobId: string,
    attempt: number,
  ): Promise<{ asset: AssetRecord | null; job: JobRecord | null }> {
    // 异步任务：Provider 先回远端 id，之后轮询。轮询是只读的，不会重复计费。
    for (let i = attempt; i < 40; i++) {
      if (abort.current) return { asset: null, job: null };
      const out = await jobsApi.poll(jobId);
      if (out.asset) return { asset: out.asset, job: out.job };
      if (!out.stillRunning) return { asset: null, job: out.job };
      await new Promise((r) => setTimeout(r, 2000 + i * 250));
    }
    return { asset: null, job: null };
  }

  function mark(id: string, record: RunRecord) {
    setRuns((s) => ({ ...s, [id]: record }));
    patchNode(id, { lastRun: record });
  }

  async function runOne(n: FlowNode, rerun: boolean): Promise<boolean> {
    const p = projectRef.current;
    const prov = providerRef.current;
    if (!p || !prov) return false;

    // intent 里带 attempt：同一节点同一 attempt 的重复提交会复用任务，不会二次计费。
    const intentId = `flow:${p.id}:${n.id}:${rerun ? n.attempt : 0}`;
    mark(n.id, { status: "running" });

    if (n.type === "text") {
      const created = await jobsApi.create({
        intentId,
        type: "text_to_speech",
        providerId: prov.id,
        modelId: n.model || undefined,
        credentialRef: prov.id,
        input: {
          text: n.prompt,
          voiceId: n.voiceId,
          outputFormat: "mp3_44100_128",
          acknowledgeUnknownCost: true,
        },
      });
      if (!created.created) {
        mark(n.id, {
          status: "skipped",
          jobId: created.job.id,
          message: "已有相同提交，复用了原任务",
        });
        return true;
      }
      liveJob.current = created.job.id;
      const out = await jobsApi.run(created.job.id);
      const asset = out.asset ?? (await pollAsset(created.job.id, 0)).asset;
      if (!asset) {
        mark(n.id, { status: "failed", jobId: created.job.id, message: out.reason ?? "运行未完成" });
        return false;
      }
      patchNode(n.id, {
        outputs: [...n.outputs, { assetId: asset.id, url: asset.url }],
        attempt: n.attempt + 1,
      });
      mark(n.id, { status: "succeeded", jobId: created.job.id, message: "已生成" });
      return true;
    }

    // 生成节点：图像 / 视频
    const source = edges
      .filter((e) => e.to.node === n.id)
      .map((e) => nodes.find((x) => x.id === e.from.node))
      .find((src) => src && outputKind(src, assets) === "image");
    const referenceUrl = source?.outputs[0]?.url ?? null;
    if (referenceUrl && !/^https?:\/\//.test(referenceUrl)) {
      mark(n.id, {
        status: "blocked",
        message: "上游参考图是本机地址，Provider 读不到；需要可访问的地址。",
      });
      return false;
    }

    const created = await jobsApi.create({
      intentId,
      type: n.modality === "image" ? "image_generation" : "video_generation",
      providerId: prov.id,
      modelId: n.model || undefined,
      credentialRef: prov.id,
      input: {
        prompt: n.prompt,
        durationSeconds: n.duration,
        imageUrl: referenceUrl,
        // runner/lib/runner.mjs 的 image/video 分支把这三个键原样转发给适配器，
        // 适配器只在真的设了值时才写进 payload。
        aspectRatio: n.ratio,
        resolution: n.resolution,
        sound: n.sound,
        acknowledgeUnknownCost: true,
      },
    });
    if (!created.created) {
      mark(n.id, {
        status: "skipped",
        jobId: created.job.id,
        message: "已有相同提交，复用了原任务",
      });
      return true;
    }
    liveJob.current = created.job.id;
    const out = await jobsApi.run(created.job.id);
    const polled = out.asset ? { asset: out.asset, job: out.job } : await pollAsset(created.job.id, 0);
    if (!polled.asset) {
      mark(n.id, {
        status: "failed",
        jobId: created.job.id,
        message: polled.job?.error?.safeMessage ?? out.reason ?? "运行未完成",
      });
      return false;
    }
    const outputs = [...n.outputs, { assetId: polled.asset.id, url: polled.asset.url }];
    patchNode(n.id, { outputs, attempt: n.attempt + 1 });
    mark(n.id, { status: "succeeded", jobId: created.job.id, message: "已生成" });
    return true;
  }

  async function runChain(target: string | null, mode: RunMode, rerun: boolean) {
    const p = projectRef.current;
    if (!p) return;
    if (!available) {
      setNote("没有可用的 Provider：先在本地设置里配置并验证一个。");
      return;
    }
    const ids = subgraph(target, mode);
    if (ids.length === 0) {
      setNote("这张画布上没有可运行的节点。");
      return;
    }
    const { problems, blocked } = preflight(ids);
    if (problems.length) {
      setNote(`提交前检查未通过：${problems.join("；")}`);
      return;
    }
    const { order } = topoOrder(ids);
    abort.current = false;
    setRunning(true);
    setNote(null);
    const failed = new Set<string>();
    try {
      for (const id of order) {
        const n = nodes.find((x) => x.id === id);
        // 素材节点本身没有可执行的任务。
        if (!n || n.type === "image" || n.type === "upload") continue;
        if (abort.current) {
          setNote("已停止。已完成的结果保留，未提交的节点没有产生费用。");
          break;
        }
        if (failed.has(id)) {
          mark(id, { status: "blocked", message: "上游失败，未执行" });
          continue;
        }
        if (blocked.has(id)) {
          mark(id, { status: "blocked", message: blocked.get(id) });
          continue;
        }
        if (n.outputs.length > 0 && !rerun) {
          mark(id, { status: "skipped", message: "已有结果；重跑需要明确选择" });
          continue;
        }
        try {
          if (!(await runOne(n, rerun))) failed.add(id);
        } catch (err) {
          mark(id, {
            status: "failed",
            message: err instanceof ApiError ? err.message : "运行失败",
          });
          failed.add(id);
        }
      }
    } finally {
      setRunning(false);
      liveJob.current = null;
    }
  }

  async function cancelRun() {
    const jobId = liveJob.current;
    if (!jobId) return;
    try {
      const out = await jobsApi.cancel(jobId);
      abort.current = true;
      setNote(`已请求取消：${out.scope.stops}。不会发生：${out.scope.doesNot.join("、")}。`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "取消失败");
    }
  }

  /* ----------------------------------------------------------- 渲染 -- */

  if (!project) {
    return (
      <div className="stack gap-4 p-6">
        <p className="text-sm text-secondary">{note ?? "读取 Flow…"}</p>
        <Link to="/app/flows" className="focus-ring w-fit text-sm underline">
          返回 Flow 列表
        </Link>
      </div>
    );
  }

  const fileMenu: MenuEntry[] = [
    { label: "返回首页", onSelect: () => navigate("/app/home") },
    {
      label: "新建 Flow",
      onSelect: () => {
        void projectsApi
          .create({ kind: "flow", name: "未命名 Flow", content: { nodes: [], edges: [] } })
          .then((np) => navigate(`/app/flows/${np.id}`));
      },
    },
    { label: "重命名", onSelect: () => setRenameFlowOpen(true), separated: true },
    { label: "复制", onSelect: () => void duplicateFlow() },
    { label: "复制本地链接", onSelect: () => void navigator.clipboard?.writeText(location.href) },
    { label: "撤销", shortcut: "⌘Z", onSelect: undo, disabled: histLen.past === 0, separated: true },
    { label: "重做", shortcut: "⌘⇧Z", onSelect: redo, disabled: histLen.future === 0 },
    { label: "创建模板", onSelect: () => void saveTemplate(), separated: true },
    {
      label: "查看模板",
      onSelect: () => {
        void projectsApi
          .list()
          .then((all) => setTemplates(all.filter((p) => p.kind === "flow-template")))
          .catch(() => setTemplates([]));
        setTemplatesOpen(true);
      },
    },
    { label: "版本历史", onSelect: () => setHistoryOpen(true) },
    { label: "删除 Flow", onSelect: () => void deleteFlow(), danger: true, separated: true },
  ];

  return (
    // Sits *inside* the shell, not over it. The shell's top bar is z-30 and the
    // sidebar z-40, so a full-bleed `inset-0` panel put this header underneath
    // them and the two controls overlapped. Offsetting to the shell's own
    // geometry keeps exactly one header row and one rail on screen.
    <div className="fixed inset-x-0 bottom-0 top-[50px] z-20 flex flex-col bg-background lg:left-64">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-alpha-150 px-4">
        <Menu
          entries={fileMenu}
          triggerLabel="Flow 文件菜单"
          width="min-w-56"
          trigger={
            <span className="flex h-9 items-center gap-1.5 rounded-[10px] border border-gray-alpha-150 px-3 text-sm">
              Flows
              <Chevron />
            </span>
          }
          triggerClassName="focus-ring rounded-[10px] enabled:hover:bg-gray-alpha-50"
        />
        <span className="h-5 w-px bg-gray-alpha-200" />
        {/* 058 里 Flow 名和「Flows」按钮一样是带边框的方块，不是裸文字。 */}
        <p className="flex h-9 min-w-0 max-w-[22rem] items-center truncate rounded-[10px] border border-gray-alpha-150 px-3 text-sm">
          {project.name}
        </p>
        <span className="flex-1" />

        <button
          type="button"
          onClick={() => void saveTemplate()}
          className="focus-ring h-9 rounded-[10px] border border-gray-alpha-150 px-3 text-sm enabled:hover:bg-gray-alpha-50"
        >
          创建模板
        </button>

        <div className="flex items-center overflow-hidden rounded-[10px] border border-gray-alpha-150">
          <label className="flex h-9 items-center px-2 text-sm">
            <span className="sr-only">缩放</span>
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="focus-ring bg-transparent text-sm outline-none"
            >
              {[50, 75, 100, 150].map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>
          </label>
          <IconBtn label="撤销" onClick={undo} disabled={histLen.past === 0}>
            ↺
          </IconBtn>
          <IconBtn label="重做" onClick={redo} disabled={histLen.future === 0}>
            ↻
          </IconBtn>
        </div>

        {running && (
          <button
            type="button"
            onClick={() => void cancelRun()}
            className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
          >
            停止
          </button>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty}
          className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm enabled:hover:bg-gray-alpha-50 disabled:opacity-40"
        >
          {dirty ? "保存" : "已保存"}
        </button>
      </header>

      <div
        ref={canvas}
        className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle,#00000018_1px,transparent_1px)] [background-size:24px_24px]"
        onPointerDown={startPan}
        onClick={() => {
          if (tool === "pointer") setSelected(null);
          setAddMenu(false);
        }}
      >
        <div
          className="relative"
          style={{
            width: 2400,
            height: 1600,
            transform: `scale(${zoom / 100})`,
            transformOrigin: "0 0",
          }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {edges.map((e, i) => {
              const from = nodes.find((n) => n.id === e.from.node);
              const to = nodes.find((n) => n.id === e.to.node);
              if (!from || !to) return null;
              const x1 = from.x + NODE_WIDTH[from.type];
              const y1 = from.y + outTop(from);
              const portIndex = Math.max(0, to.inputs.findIndex((p) => p.id === e.to.port));
              const x2 = to.x;
              const y2 = to.y + PORT_TOP + portIndex * PORT_STEP;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="rgb(147 197 253)"
                  strokeWidth="2"
                />
              );
            })}
            {linking &&
              (() => {
                const from = nodes.find((n) => n.id === linking.node);
                if (!from) return null;
                const x1 = from.x + NODE_WIDTH[from.type];
                const y1 = from.y + outTop(from);
                const mid = (x1 + linking.x) / 2;
                return (
                  <path
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${linking.y}, ${linking.x} ${linking.y}`}
                    fill="none"
                    stroke="rgb(147 197 253)"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                );
              })()}
          </svg>

          {nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              selected={selected === n.id}
              run={runs[n.id] ?? n.lastRun}
              assets={assets}
              voices={voices}
              voiceReason={voiceReason}
              models={providerModels}
              canGenerate={!!available}
              refs={refsFor(n, nodes, edges, assets)}
              onPointerDown={(e) => startDrag(e, n)}
              onSelect={() => {
                if (tool === "comment") {
                  setCommentingNode(n);
                  setCommentText(n.comment);
                  return;
                }
                setSelected(n.id);
              }}
              onPatch={(patch) => patchNode(n.id, patch)}
              onEditStart={beginEdit}
              onEditEnd={endEdit}
              onStartLink={(e) => startLink(e, n.id)}
              onFinishLink={(port) => finishLink(n.id, port)}
              onRun={(mode, rerun) => void runChain(n.id, mode, rerun)}
              onUpload={(f) => void uploadInto(n, f)}
              onRemove={() => removeNode(n.id)}
              onRename={() => {
                setRenamingNode(n);
                setRenameText(n.label);
              }}
              onComment={() => {
                setCommentingNode(n);
                setCommentText(n.comment);
              }}
            />
          ))}
        </div>

        {/* 提示与费用口径浮在画布左上/右上角。参考没有这条独立底栏，所以不再占一行；
            放底部会和居中的工具簇撞在一起。 */}
        <p className="pointer-events-none absolute top-3 left-4 max-w-[min(34rem,52%)] text-xs text-subtle">
          {note ??
            (available
              ? `从节点右侧圆点拖到目标节点左侧圆点即可连线。共 ${nodes.length} 个节点、${edges.length} 条连线。`
              : "没有可用 Provider：节点可以搭建，但不能运行。先在本地设置里配置并验证一个。")}
        </p>
        {available && (
          <p className="pointer-events-none absolute top-3 right-4 max-w-[min(24rem,40%)] text-right text-xs text-subtle">
            运行会调用 {provider?.displayName}，费用由该 Provider 计算；本地预算不是它的余额。
          </p>
        )}

        {/* 工具簇与指令条在参考里是底部居中的一组，左簇右条，所以并排排一次。
            指令条固定 480px，两块加起来才落在视口正中（参考 424→1090）。 */}
        <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-5">
        {/* 浮动工具簇：选择 / 平移 / 批注 / 添加节点 */}
        <div className="relative flex items-center gap-1 rounded-full border border-gray-alpha-150 bg-background p-1 shadow-natural-xs">
          <IconBtn label="选择" onClick={() => setTool("pointer")} active={tool === "pointer"}>
            ▷
          </IconBtn>
          <IconBtn label="移动" onClick={() => setTool("hand")} active={tool === "hand"}>
            ✋
          </IconBtn>
          <IconBtn label="评论" onClick={() => setTool("comment")} active={tool === "comment"}>
            💬
          </IconBtn>
          <button
            type="button"
            aria-label="添加节点"
            aria-expanded={addMenu}
            onClick={(e) => {
              e.stopPropagation();
              setAddMenu((v) => !v);
            }}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background"
          >
            ＋
          </button>

          {addMenu && (
            <AddNodeMenu
              tab={menuTab}
              query={menuQuery}
              canGenerate={!!available}
              onTab={setMenuTab}
              onQuery={setMenuQuery}
              onAdd={addNode}
              onClose={() => setAddMenu(false)}
            />
          )}
        </div>

        {/* 指令条：把一句话追加到选中节点的提示词，追加结果在节点里可见 */}
        <form
          className="flex w-[min(480px,60vw)] items-center gap-2 rounded-full border border-gray-alpha-150 bg-background py-2.5 pr-2 pl-3 shadow-natural-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (!instruction.trim()) return;
            const target = nodes.find((n) => n.id === selected);
            if (!target || (target.type !== "generate" && target.type !== "text")) {
              setNote("先选中一个生成节点或文本节点，指令才会追加到它的提示词。");
              return;
            }
            patchNode(target.id, {
              prompt: `${target.prompt}${target.prompt ? "\n" : ""}${instruction.trim()}`,
            });
            setInstruction("");
            setNote(
              `已把指令追加到「${target.label}」的提示词。生成仍需你点运行，会再次调用 Provider。`,
            );
          }}
        >
          <span aria-hidden="true" className="shrink-0 text-sm text-subtle">
            ⟳
          </span>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="把图片换成日落…"
            aria-label="画布指令"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={() =>
              setNote(
                selected
                  ? "引用会作为参考图连到选中节点：先从左侧工具簇添加一个素材节点，再连线过去。"
                  : "先选中一个节点，才能给它接引用。",
              )
            }
            aria-label="添加引用"
            title="把本机素材作为参考图接进选中节点"
            className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-secondary enabled:hover:bg-gray-alpha-50"
          >
            📎
          </button>
          <button
            type="submit"
            disabled={!instruction.trim()}
            aria-label="追加指令"
            className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:bg-gray-300"
          >
            ↑
          </button>
        </form>
        </div>
      </div>

      {renamingNode && (
        <Modal
          open
          onClose={() => setRenamingNode(null)}
          title="重命名节点"
          footer={
            <>
              <ModalBtn onClick={() => setRenamingNode(null)}>取消</ModalBtn>
              <ModalBtn
                primary
                disabled={!renameText.trim()}
                onClick={() => {
                  patchNode(renamingNode.id, { label: renameText.trim() });
                  setRenamingNode(null);
                }}
              >
                保存
              </ModalBtn>
            </>
          }
        >
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            aria-label="节点名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      {commentingNode && (
        <Modal
          open
          onClose={() => setCommentingNode(null)}
          title={`批注 · ${commentingNode.label}`}
          footer={
            <>
              <ModalBtn onClick={() => setCommentingNode(null)}>取消</ModalBtn>
              <ModalBtn
                primary
                onClick={() => {
                  patchNode(commentingNode.id, { comment: commentText });
                  setCommentingNode(null);
                }}
              >
                保存批注
              </ModalBtn>
            </>
          }
        >
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            rows={4}
            placeholder="写给自己看的备注，保存在这张 Flow 的本地工程里。"
            className="focus-ring w-full resize-y rounded-lg border border-gray-alpha-150 bg-background p-3 text-sm outline-none placeholder:text-subtle"
          />
        </Modal>
      )}

      {renameFlowOpen && (
        <Modal
          open
          onClose={() => setRenameFlowOpen(false)}
          title="重命名 Flow"
          footer={
            <>
              <ModalBtn onClick={() => setRenameFlowOpen(false)}>取消</ModalBtn>
              <ModalBtn primary disabled={!flowName.trim()} onClick={() => void renameFlow()}>
                保存
              </ModalBtn>
            </>
          }
        >
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            aria-label="Flow 名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      {historyOpen && (
        <Modal open onClose={() => setHistoryOpen(false)} title="版本历史">
          <p className="text-sm text-secondary">
            当前修订 {project.revision}，最后保存 {project.updatedAt.slice(0, 16).replace("T", " ")}。
            本地工程存储只保留当前这一版，没有服务端版本历史接口，所以这里没有更早的条目可列。
          </p>
        </Modal>
      )}

      {templatesOpen && (
        <Modal open onClose={() => setTemplatesOpen(false)} title="本地模板" width="max-w-lg">
          {templates.length === 0 ? (
            <p className="text-sm text-secondary">
              还没有 Flow 模板。「创建模板」会把当前画布的节点和连线复制成一份本地模板，
              只在同一台机器上用来复制出新 Flow，不会上传。
            </p>
          ) : (
            <ul className="stack gap-2">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-alpha-150 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void projectsApi
                        .create({ kind: "flow", name: `${t.name}（副本）`, content: t.content })
                        .then((np) => navigate(`/app/flows/${np.id}`));
                    }}
                    className="focus-ring rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
                  >
                    复制为新 Flow
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- card -- */

function NodeCard({
  node,
  selected,
  run,
  assets,
  voices,
  voiceReason,
  models,
  canGenerate,
  refs,
  onPointerDown,
  onSelect,
  onPatch,
  onEditStart,
  onEditEnd,
  onStartLink,
  onFinishLink,
  onRun,
  onUpload,
  onRemove,
  onRename,
  onComment,
}: {
  node: FlowNode;
  selected: boolean;
  run?: RunRecord;
  assets: AssetRecord[];
  voices: VoiceRecord[];
  voiceReason: string | null;
  models: string[];
  canGenerate: boolean;
  /** 连进本节点的图片素材，在结果区左缘显示成缩略图（058 的两枚参考图）。 */
  refs: NodeRef[];
  onPointerDown: (e: React.PointerEvent) => void;
  onSelect: () => void;
  onPatch: (patch: Partial<FlowNode>) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onStartLink: (e: React.PointerEvent) => void;
  onFinishLink: (port: string) => void;
  onRun: (mode: RunMode, rerun: boolean) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onRename: () => void;
  onComment: () => void;
}) {
  const asset = assets.find((a) => a.id === node.assetId);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="absolute"
      style={{ left: node.x, top: node.y, width: NODE_WIDTH[node.type] }}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* 058 的节点名与类型是浮在节点上方的一行无边框文字，不在卡片里面。 */}
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <p className="min-w-0 truncate text-xs text-secondary">→ {node.label}</p>
        {node.type === "generate" && (
          <span className="shrink-0 truncate text-[11px] text-subtle">
            {node.model || "默认模型"}
          </span>
        )}
      </div>

      <div
        className={`relative cursor-grab rounded-xl active:cursor-grabbing ${
          selected ? "ring-2 ring-foreground" : ""
        }`}
      >
        {node.type === "generate" ? (
          <GenerateBody
            node={node}
            run={run}
            models={models}
            canGenerate={canGenerate}
            refs={refs}
            onPatch={onPatch}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
            onRun={onRun}
            onRemove={onRemove}
            onRename={onRename}
            onComment={onComment}
          />
        ) : node.type === "text" ? (
          <div className="stack gap-2 rounded-xl border border-gray-alpha-150 bg-background p-3">
            <textarea
              value={node.prompt}
              onChange={(e) => onPatch({ prompt: e.target.value })}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onPointerDown={stop}
              rows={3}
              aria-label={`${node.label} 文本`}
              placeholder="要转成语音的文本…"
              className="focus-ring w-full resize-y rounded-lg border border-gray-alpha-150 bg-background p-2 text-xs outline-none placeholder:text-subtle"
            />
            <select
              value={node.voiceId}
              onChange={(e) => onPatch({ voiceId: e.target.value })}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onPointerDown={stop}
              aria-label={`${node.label} 音色`}
              className="focus-ring w-full rounded-lg border border-gray-alpha-150 bg-background px-1.5 py-1 text-xs outline-none"
            >
              <option value="">选择音色</option>
              {voices.map((v) => (
                <option key={v.voiceId} value={v.voiceId}>
                  {v.name}
                </option>
              ))}
            </select>
            {voices.length === 0 && (
              <p className="text-[11px] text-subtle">
                {voiceReason ?? "没有可用音色：节点可以先搭好，但不能运行。"}
              </p>
            )}
            <Toolbar
              label={node.label}
              hasOutput={node.outputs.length > 0}
              onRun={onRun}
              onRemove={onRemove}
              onRename={onRename}
              onComment={onComment}
              run={run}
            />
          </div>
        ) : (
          <div className="stack gap-2">
            {asset ? (
              <div className="relative h-40 overflow-hidden rounded-xl bg-gray-alpha-50">
                <img
                  src={asset.url}
                  alt={asset.displayName}
                  draggable={false}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRun("downstream", false);
                  }}
                  className="focus-ring absolute right-2 bottom-2 rounded bg-gray-950/80 px-2 py-1 text-xs text-white"
                >
                  从这里运行
                </button>
              </div>
            ) : (
              <label className="focus-ring flex h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-alpha-200 text-xs text-subtle hover:bg-gray-alpha-50">
                {node.type === "upload" ? "上传媒体" : "选择一张本机图片"}
                <input
                  type="file"
                  className="sr-only"
                  accept={node.type === "upload" ? undefined : "image/*"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(f);
                  }}
                />
              </label>
            )}
            {/* 素材节点的操作行是图片下方独立的一个小药丸，不和图片共用一张卡。 */}
            {asset && (
              <div className="flex w-fit items-center gap-1.5 rounded-[10px] border border-gray-alpha-150 bg-background px-2 py-1.5">
                <label className="focus-ring cursor-pointer rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50">
                  替换
                  <input
                    type="file"
                    className="sr-only"
                    accept={node.type === "upload" ? undefined : "image/*"}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(f);
                    }}
                  />
                </label>
                <a
                  href={asset.url}
                  download={asset.displayName}
                  className="focus-ring rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
                >
                  下载
                </a>
                <button
                  type="button"
                  onClick={onRemove}
                  aria-label={`删除 ${node.label}`}
                  className="focus-ring rounded px-1.5 py-1 text-xs text-secondary hover:bg-gray-alpha-50"
                >
                  🗑
                </button>
                <NodeMenu onRename={onRename} onComment={onComment} onRemove={onRemove} label={node.label} />
              </div>
            )}
            {node.comment && (
              <p className="rounded-lg bg-gray-alpha-50 px-2 py-1 text-[11px] text-secondary">
                {node.comment}
              </p>
            )}
          </div>
        )}

        {/* 输入端口按类型分开：不匹配的连线在建立那一刻就会被拒绝。
            圆心对准 PORT_TOP + i*PORT_STEP：容器上移半径，行间距 = 步长 - 直径。 */}
        <div
          className="absolute -left-3 flex flex-col"
          style={{ top: PORT_TOP - PORT_R, gap: PORT_STEP - PORT_R * 2 }}
        >
          {node.inputs.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={`${p.kind} 端口`}
              onClick={(e) => {
                e.stopPropagation();
                onFinishLink(p.id);
              }}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-blue-400 bg-background text-[8px] leading-none text-blue-600"
            >
              {PORT_GLYPH[p.kind]}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-label={`从 ${node.label} 连出`}
          onPointerDown={onStartLink}
          style={{ top: outTop(node) - PORT_R }}
          className="absolute -right-3 h-3.5 w-3.5 rounded-full border-2 border-blue-400 bg-blue-200"
        />
      </div>
    </div>
  );
}

function GenerateBody({
  node,
  run,
  models,
  canGenerate,
  refs,
  onPatch,
  onEditStart,
  onEditEnd,
  onRun,
  onRemove,
  onRename,
  onComment,
}: {
  node: FlowNode;
  run?: RunRecord;
  models: string[];
  canGenerate: boolean;
  refs: NodeRef[];
  onPatch: (patch: Partial<FlowNode>) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onRun: (mode: RunMode, rerun: boolean) => void;
  onRemove: () => void;
  onRename: () => void;
  onComment: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const last = node.outputs[node.outputs.length - 1];
  const runMenu: MenuEntry[] = [
    { label: "运行此节点及下游", onSelect: () => onRun("downstream", false), disabled: !canGenerate },
    { label: "仅运行此节点", onSelect: () => onRun("single", false), disabled: !canGenerate },
    {
      label: "重跑此节点",
      onSelect: () => onRun("single", true),
      disabled: !canGenerate,
      reason: node.outputs.length ? "会再次调用 Provider，可能重复计费" : undefined,
      separated: true,
    },
  ];

  return (
    <div className="stack gap-2">
      {/* 058 的结果区是一块实心浅灰，不是虚线框；参考图缩略图贴在它的左缘。 */}
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-gray-alpha-50 text-xs text-subtle">
        {refs.length > 0 && (
          <div className="absolute top-1/2 left-2 flex -translate-y-1/2 flex-col gap-1.5">
            {refs.map((r) => (
              <img
                key={r.url}
                src={r.url}
                alt={r.label}
                title={r.label}
                className="h-8 w-8 rounded border border-gray-alpha-150 object-cover"
              />
            ))}
          </div>
        )}
        {last ? (
          <video
            src={last.url}
            controls
            preload="none"
            onPointerDown={stop}
            className="h-full w-full object-contain"
          />
        ) : (
          "生成内容将显示在此处"
        )}
      </div>

      <div className="relative">
        <textarea
          value={node.prompt}
          onChange={(e) => onPatch({ prompt: e.target.value })}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onPointerDown={stop}
          rows={4}
          aria-label={`${node.label} 提示词`}
          placeholder="描述你想要的画面…"
          className="focus-ring w-full resize-y rounded-xl border border-gray-alpha-150 bg-background p-2 text-xs outline-none placeholder:text-subtle"
        />
        <Menu
          entries={runMenu}
          triggerLabel="运行菜单"
          align="right"
          width="min-w-48"
          trigger={
            <span className="flex items-center gap-1 rounded bg-foreground px-2 py-0.5 text-[11px] text-background">
              运行
              <Chevron />
            </span>
          }
          triggerClassName="focus-ring absolute right-2 bottom-2 rounded"
        />
      </div>

      {/* 058 的控件行是居中的一个小药丸：模型带下拉箭头，后三个参数不带。 */}
      <div className="mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-[10px] border border-gray-alpha-150 bg-background px-2.5 py-1.5">
        <select
          value={node.model}
          onChange={(e) => onPatch({ model: e.target.value })}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onPointerDown={stop}
          aria-label={`${node.label} 模型`}
          className="focus-ring max-w-32 rounded bg-transparent text-xs outline-none"
        >
          <option value="">默认模型</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={node.ratio}
          onChange={(e) => onPatch({ ratio: e.target.value })}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onPointerDown={stop}
          aria-label={`${node.label} 纵横比`}
          className="focus-ring appearance-none rounded bg-transparent text-xs outline-none"
        >
          {RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={node.resolution}
          onChange={(e) => onPatch({ resolution: e.target.value })}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onPointerDown={stop}
          aria-label={`${node.label} 分辨率`}
          className="focus-ring appearance-none rounded bg-transparent text-xs outline-none"
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={node.duration}
          onChange={(e) => onPatch({ duration: Number(e.target.value) })}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onPointerDown={stop}
          aria-label={`${node.label} 时长`}
          className="focus-ring appearance-none rounded bg-transparent text-xs outline-none"
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
        <button
          type="button"
          onPointerDown={stop}
          onClick={() => onPatch({ sound: !node.sound })}
          aria-pressed={node.sound}
          aria-label={`生成音频：${node.sound ? "开启" : "关闭"}`}
          title="生成音频：随本次请求一起发送 generate_audio。上游是否采纳未经真实调用验证。"
          className={`focus-ring rounded px-0.5 text-xs ${
            node.sound ? "text-foreground" : "text-subtle"
          }`}
        >
          {node.sound ? "🔊" : "🔈"}
        </button>
        {last ? (
          <a
            href={last.url}
            download
            onPointerDown={stop}
            aria-label="下载结果"
            className="focus-ring rounded px-0.5 text-xs text-secondary"
          >
            ⭳
          </a>
        ) : (
          <span
            aria-label="下载结果：还没有产物"
            title="还没有产物可下载"
            className="rounded px-0.5 text-xs text-subtle opacity-40"
          >
            ⭳
          </span>
        )}
        <button
          type="button"
          onPointerDown={stop}
          onClick={onRemove}
          aria-label={`删除 ${node.label}`}
          className="focus-ring rounded px-0.5 text-xs text-secondary"
        >
          🗑
        </button>
        <NodeMenu
          onRename={onRename}
          onComment={onComment}
          onRemove={onRemove}
          label={node.label}
        />
      </div>

      {/* 请求字段已按 runner 的键名转发，但从未用真实密钥跑过一次，
          上游是否采纳仍属未验证 —— 控件可用，不宣称一定改变输出。 */}
      <p className="text-[11px] text-subtle">
        比例 / 分辨率 / 生成音频会随请求发送，上游是否采纳未经验证。
      </p>
      <RunNote run={run} />
    </div>
  );
}

function NodeMenu({
  onRename,
  onComment,
  onRemove,
  label,
  className = "",
}: {
  onRename: () => void;
  onComment: () => void;
  onRemove: () => void;
  label: string;
  className?: string;
}) {
  return (
    <Menu
      entries={[
        { label: "重命名", onSelect: onRename },
        { label: "批注", onSelect: onComment },
        { label: "删除节点", onSelect: onRemove, danger: true, separated: true },
      ]}
      triggerLabel={`${label} 更多选项`}
      align="right"
      width="min-w-40"
      trigger={<Dots />}
      triggerClassName={`focus-ring rounded p-1 text-secondary hover:bg-gray-alpha-50 ${className}`}
    />
  );
}

function Toolbar({
  onRun,
  onRemove,
  onRename,
  onComment,
  run,
  label,
  hasOutput,
}: {
  onRun: (mode: RunMode, rerun: boolean) => void;
  onRemove: () => void;
  onRename: () => void;
  onComment: () => void;
  run?: RunRecord;
  label: string;
  hasOutput: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Menu
          entries={[
            { label: "运行此节点及下游", onSelect: () => onRun("downstream", false) },
            { label: "仅运行此节点", onSelect: () => onRun("single", false) },
            {
              label: "重跑此节点",
              onSelect: () => onRun("single", true),
              reason: hasOutput ? "会再次调用 Provider，可能重复计费" : undefined,
              separated: true,
            },
          ]}
          triggerLabel="运行菜单"
          align="right"
          width="min-w-48"
          trigger={
            <span className="rounded-[10px] bg-foreground px-2.5 py-1 text-xs text-background">
              {run?.status === "running" ? "运行中…" : "运行"}
              <Chevron />
            </span>
          }
          triggerClassName="focus-ring rounded-[10px]"
        />
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`删除 ${label}`}
          className="focus-ring rounded px-1.5 py-1 text-xs text-secondary hover:bg-gray-alpha-50"
        >
          🗑
        </button>
        <NodeMenu onRename={onRename} onComment={onComment} onRemove={onRemove} label={label} />
      </div>
      <RunNote run={run} />
    </>
  );
}

function RunNote({ run }: { run?: RunRecord }) {
  if (!run?.message) return null;
  return (
    <p
      className={`text-[11px] ${
        run.status === "failed" || run.status === "blocked" ? "text-amber-700" : "text-subtle"
      }`}
    >
      {run.status} · {run.message}
    </p>
  );
}

/* ---------------------------------------------------------- add a node -- */

/**
 * 059 记录了添加节点菜单。四个页签里只有「图像」的内容被截到，另外三个页签
 * 的条目没有证据，这里显示未记录，而不是照上游目录编一份。
 */
const MENU_ITEMS: Record<
  "image" | "video" | "audio" | "text",
  {
    section: string;
    items: {
      label: string;
      kind: NodeKind;
      modality?: Modality;
      blocked?: string;
    }[];
  }[]
> = {
  image: [
    {
      section: "最常用",
      items: [
        { label: "图像生成", kind: "generate", modality: "image" },
        { label: "视频生成", kind: "generate", modality: "video" },
        { label: "文本转语音", kind: "text" },
        { label: "口型同步", kind: "generate", blocked: "本地契约里没有口型同步任务类型" },
        { label: "上传媒体", kind: "upload" },
      ],
    },
    {
      section: "图像",
      items: [
        { label: "编辑图片", kind: "image", blocked: "本地没有图像编辑管线" },
        { label: "图片放大", kind: "image", blocked: "本地没有超分辨率管线" },
        { label: "移除背景", kind: "image", blocked: "本地没有背景分割能力" },
      ],
    },
  ],
  video: [],
  audio: [],
  text: [],
};

function AddNodeMenu({
  tab,
  query,
  canGenerate,
  onTab,
  onQuery,
  onAdd,
  onClose,
}: {
  tab: "image" | "video" | "audio" | "text";
  query: string;
  canGenerate: boolean;
  onTab: (t: "image" | "video" | "audio" | "text") => void;
  onQuery: (q: string) => void;
  onAdd: (kind: NodeKind, label: string, modality: Modality) => void;
  onClose: () => void;
}) {
  const q = query.trim().toLowerCase();
  const groups = MENU_ITEMS[tab]
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div
      role="menu"
      aria-label="添加节点"
      onClick={(e) => e.stopPropagation()}
      className="absolute bottom-[calc(100%+10px)] left-1/2 z-40 w-[320px] -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-alpha-150 bg-background shadow-xl"
    >
      <div className="border-b border-gray-alpha-100 p-2">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索节点、模型…"
          aria-label="搜索节点"
          className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-2.5 text-sm outline-none placeholder:text-subtle"
        />
      </div>
      <div className="flex gap-1 border-b border-gray-alpha-100 p-2">
        {(["image", "video", "audio", "text"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            aria-pressed={tab === t}
            className={`focus-ring rounded-[10px] px-2.5 py-1 text-xs ${
              tab === t ? "bg-gray-alpha-100 font-medium" : "text-secondary"
            }`}
          >
            {t === "image" ? "图像" : t === "video" ? "视频" : t === "audio" ? "音频" : "文本"}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="px-3 py-4 text-xs text-secondary">
          {q
            ? "没有匹配的节点。"
            : "该页签的条目在本次证据里没有被记录（研究只截到「图像」页签）。这里不按上游目录猜。"}
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto p-1">
          {groups.map((g) => (
            <div key={g.section} className="mb-1">
              <p className="px-2 py-1 text-[11px] text-subtle">{g.section}</p>
              {g.items.map((it) => {
                const blocked =
                  it.blocked ??
                  (it.kind === "generate" && !canGenerate ? "没有可用 Provider" : undefined);
                return (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    disabled={!!blocked}
                    onClick={() => onAdd(it.kind, it.label, it.modality ?? "video")}
                    className="focus-ring flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-gray-alpha-50"
                  >
                    <span>{it.label}</span>
                    {blocked && <span className="text-[11px] text-subtle">{blocked}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-alpha-100 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring w-full rounded-[10px] border border-gray-alpha-200 py-1.5 text-xs hover:bg-gray-alpha-50"
        >
          关闭
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 小组件 -- */

function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      className={`focus-ring flex h-9 w-9 items-center justify-center text-sm disabled:opacity-30 ${
        active ? "bg-gray-alpha-100" : "enabled:hover:bg-gray-alpha-50"
      }`}
    >
      {children}
    </button>
  );
}

function ModalBtn({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
          : "focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
      }
    >
      {children}
    </button>
  );
}
