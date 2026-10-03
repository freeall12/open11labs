import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  projects as projectsApi,
  providers as providersApi,
  type AssetRecord,
  type JobRecord,
  type ProjectRecord,
  type ProviderRecord,
  type ProviderSpec,
} from "@/lib/api";
import { Modal } from "@/features/shared/Modal";
import { Dots, Menu } from "@/features/editors/Menu";
import { relativeTime } from "@/features/editors/FlowsPage";

/* ==========================================================================
   聊天.

   参考 063–065：居中的「你想创建什么?」、一颗参考球 + 引用 + 模型 + 发送、
   下面的聊天记录列表和「建议」卡片。参考里的橙色球是产品标识，这里用中性圆形
   标记，不复制商标。

   聊天跑在用户自己的 LLM Provider 上 —— 本地模型不花钱、文本不出机器，但对话
   仍然是一次真实调用，所以每一轮都有费用确认和可取消的真实任务。

   边界（docs/architecture/security.md 与 R6-AC02）：
     - 模型只拿到对话文本。读不到文件、拿不到密钥、不能替你发布任何东西。
     - 会话是本地工程，刷新和重启都不丢。
     - 引用素材只作为本地引用记录：当前聊天任务不把素材内容发给模型，界面上
       写明这一点，而不是假装模型看过附件。
   ========================================================================== */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Attached {
  id: string;
  name: string;
  mediaType: string;
}

const SUGGESTIONS = [
  {
    title: "产品发布旁白配音",
    body: "为产品发布撰写一段旁白，并标注停顿与语速。",
    prompt: "为一款新品发布写一段 30 秒旁白，标注停顿和语速提示。",
  },
  {
    title: "播客片头音乐",
    body: "描述节目气质，交给音乐页生成片头。",
    prompt: "给我的播客写一段片头文案，气质安静、专业，30 秒以内。",
  },
  {
    title: "博客文章配图",
    body: "列出文章需要的插图清单与构图描述。",
    prompt: "为这篇博客列出需要的插图清单，每张给出构图描述。",
  },
];

export function ChatPageBody() {
  const [saved, setSaved] = useState<ProviderRecord[]>([]);
  const [providerId, setProviderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ackCost, setAckCost] = useState(false);
  const [models, setModels] = useState<{ id: string; source: string }[]>([]);
  const [model, setModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [history, setHistory] = useState<ProjectRecord[]>([]);
  const [refs, setRefs] = useState<Attached[]>([]);
  const [refMenu, setRefMenu] = useState(false);
  const [refQuery, setRefQuery] = useState("");
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [transcripts, setTranscripts] = useState(false);
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [renameText, setRenameText] = useState("");
  const [maxTokens, setMaxTokens] = useState("1024");
  /**
   * 能不能对话由服务端目录的 `chat` 标志决定，不在客户端写死平台 id：
   * 新增适配器时这个页面不用跟着改，也不会把一个没有补全端点的平台
   * （ElevenLabs）当成可用。null 表示目录没读到，此时不提供任何 Provider。
   */
  const [chatPlatforms, setChatPlatforms] = useState<Set<string> | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** 每轮一个 intent；重试时递增，否则会复用旧任务、拿不到新的一次调用。 */
  const attempt = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [p, a, catalog] = await Promise.all([
        providersApi.list(),
        assetsApi.list().catch(() => ({ assets: [] as AssetRecord[] })),
        providersApi.catalog().catch((err: unknown) => {
          setCatalogError(err instanceof ApiError ? err.message : "无法读取 Provider 能力目录");
          return [] as ProviderSpec[];
        }),
      ]);
      setSaved(p);
      setAssets(a.assets);
      setChatPlatforms(new Set(catalog.filter((c) => c.chat).map((c) => c.id)));
      setHistory((await projectsApi.list()).filter((x) => x.kind === "chat"));
    } catch {
      setSaved([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // 模型 id 只能来自该 Provider 自己的列表。服务端没公布的名字绝不预填。
  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setModel("");
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    setModelListError(null);
    (async () => {
      try {
        const out = await providersApi.models(providerId);
        if (cancelled) return;
        setModels(out.models);
        setModel(out.models[0]?.id ?? "");
      } catch (err) {
        if (cancelled) return;
        setModels([]);
        setModel("");
        setModelListError(
          err instanceof ApiError ? err.message : "无法读取模型列表，请手动填写模型名",
        );
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  // 只提供服务端目录标了 chat 的平台。没有补全端点的平台（例如 ElevenLabs）
  // 不会出现在这里，页面上会说明原因，而不是等到发送时才报错。
  const providers = useMemo(
    () => (chatPlatforms ? saved.filter((p) => chatPlatforms.has(p.type)) : []),
    [saved, chatPlatforms],
  );
  const selected = providers.find((p) => p.id === providerId) ?? null;

  useEffect(() => {
    if (providers.length > 0 && !providers.some((p) => p.id === providerId)) {
      setProviderId(providers[0].id);
    }
  }, [providers, providerId]);

  const conversation = useMemo(
    () => [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      ...(input.trim() ? [{ role: "user", content: input.trim() }] : []),
    ],
    [turns, input],
  );

  /** 唯一说得出原因的地方：没有可对话的平台时，名字写清是哪个平台、为什么。 */
  const noChatReason = (() => {
    if (loading || providers.length > 0) return null;
    if (saved.length === 0) return "尚未配置任何 Provider。";
    const names = [...new Set(saved.map((p) => p.displayName))].join("、");
    return `已配置的 ${names} 没有对话补全端点，这是平台的正常状态，不是故障。要在这里对话，需要一个带 chat 能力的 LLM（OpenAI、Anthropic、Google 或自托管的 OpenAI 兼容网关）。`;
  })();

  const blocked: string | null = (() => {
    if (loading) return "正在读取本地 Provider…";
    if (catalogError) return `Provider 能力目录读取失败：${catalogError}`;
    if (providers.length === 0) return noChatReason;
    if (!selected) return "尚未配置可对话的 Provider";
    if (selected.validationState !== "available") {
      return `Provider 状态为「${selected.validationState}」，请先在本地设置中验证`;
    }
    if (loadingModels) return "正在读取模型列表…";
    if (!model.trim()) return "请选择或填写模型名";
    if (!input.trim()) return "请输入内容";
    return null;
  })();

  /** 适配器把 maxTokens 透传给各家 API；留空则用各适配器自己的默认值。 */
  const maxTokensValue = Number.isInteger(Number(maxTokens)) && Number(maxTokens) > 0
    ? Number(maxTokens)
    : undefined;

  async function persist(nextTurns: Turn[]) {
    const body = { turns: nextTurns };
    try {
      const p = project
        ? await projectsApi.save(project.id, { ...project.content, ...body })
        : await projectsApi.create({
            kind: "chat",
            name: `对话 ${new Date().toLocaleString("zh-CN")}`,
            content: body,
          });
      setProject(p);
      setHistory((h) => [p, ...h.filter((x) => x.id !== p.id)]);
    } catch (err) {
      setNote(
        `对话已显示在页面上，但没能存进本地工程：${
          err instanceof ApiError ? err.message : "未知错误"
        }`,
      );
    }
  }

  async function send() {
    if (!selected || !input.trim() || !model.trim() || busy) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content: input.trim() }];
    attempt.current += 1;
    const intentId = `chat:${selected.id}:${model}:${nextTurns.length}:${attempt.current}`;
    setTurns(nextTurns);
    setInput("");
    setRefs([]);
    setBusy(true);
    setNote(null);
    try {
      const created = await jobsApi.create({
        intentId,
        type: "chat",
        providerId: selected.id,
        credentialRef: selected.id,
        modelId: model.trim(),
        input: { messages: conversation, temperature: 0.7, maxTokens: maxTokensValue },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这一轮之前已经提交过，复用了同一个任务，不会重复计费。");
        return;
      }

      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) {
        const reply = await assetsApi.readText(out.asset.id);
        const withReply: Turn[] = [...nextTurns, { role: "assistant", content: reply }];
        setTurns(withReply);
        await persist(withReply);
        return;
      }
      const reason = out.reason ?? out.job.error?.safeMessage ?? "生成未完成";
      setNote(reason);
      await persist(nextTurns);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "发送失败");
      await persist(nextTurns);
    } finally {
      setBusy(false);
    }
  }

  /** 重试：新一轮 intent，重新调用 Provider。不会偷偷复用旧任务。 */
  async function retry() {
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    if (!lastUser || busy) return;
    const kept = turns.slice(0, turns.indexOf(lastUser));
    attempt.current += 1;
    setTurns(kept);
    setBusy(true);
    setNote(null);
    try {
      const created = await jobsApi.create({
        intentId: `chat:${selected?.id}:${model}:${kept.length + 1}:${attempt.current}`,
        type: "chat",
        providerId: selected!.id,
        credentialRef: selected!.id,
        modelId: model.trim(),
        input: {
          messages: [...kept, lastUser].map((t): Turn => ({ role: t.role, content: t.content })),
          temperature: 0.7,
          maxTokens: maxTokensValue,
        },
      });
      setJob(created.job);
      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) {
        const reply = await assetsApi.readText(out.asset.id);
        const withReply = [...kept, lastUser, { role: "assistant" as const, content: reply }];
        setTurns(withReply);
        await persist(withReply);
      } else {
        setNote(out.reason ?? "重试未完成。");
        setTurns([...kept, lastUser]);
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "重试失败");
      setTurns([...kept, lastUser]);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      const out = await jobsApi.cancel(job.id);
      setNote(`已请求取消：${out.scope.stops}。不会发生：${out.scope.doesNot.join("、")}。`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "取消失败");
    }
  }

  /** 采用到工程：把这一轮问答存成一个可继续编辑的本地 Studio 项目。 */
  async function adopt() {
    const last = [...turns].reverse().find((t) => t.role === "assistant");
    if (!last) return;
    const created = await projectsApi.create({
      kind: "studio",
      name: `采用自对话 ${new Date().toLocaleString("zh-CN")}`,
      content: {
        kind: "audio",
        beats: [{ id: "b1", name: "草稿", kind: "tts", text: last.content }],
      },
    });
    setNote(`已存成本地项目「${created.name}」，可以打开继续编排。`);
  }

  async function attach(file: File) {
    try {
      const res = await assetsApi.upload(file);
      setAssets((a) => [...a, res.asset]);
      setRefs((r) => [...r, { id: res.asset.id, name: res.asset.displayName, mediaType: res.asset.mediaType }]);
      setNote(`${file.name} 已上传到本机素材库。`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "上传失败");
    }
  }

  const refMatches = assets.filter(
    (a) => !refQuery.trim() || a.displayName.toLowerCase().includes(refQuery.trim().toLowerCase()),
  );

  return (
    <div className="stack gap-8">
      <section className="stack gap-5 pt-6">
        <h1 className="text-center font-waldenburg text-3xl font-normal text-foreground">
          你想创建什么?
        </h1>

        {/*
          已配置的平台都没有 chat 能力是正常状态，不是故障：ElevenLabs 只有语音
          接口，没有对话补全端点。所以这里用 info 而不是报错。
        */}
        {noChatReason && saved.length > 0 && !catalogError && (
          <Notice tone="info">
            {noChatReason}
            <Link to="/local/settings/providers" className="ml-1 underline">
              去添加
            </Link>
          </Notice>
        )}

        {catalogError && !loading && (
          <Notice tone="warn">
            Provider 能力目录读取失败：{catalogError}
            <Link to="/local/settings/providers" className="ml-1 underline">
              去本地设置
            </Link>
          </Notice>
        )}

        {selected?.selfHosted && (
          <Notice tone="info">使用你自托管的模型，文本不会离开本机，也没有按次费用。</Notice>
        )}

        <form
          className="relative mx-auto flex w-full max-w-[720px] items-center gap-2 rounded-full border border-gray-alpha-150 bg-background px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {/* 参考里这里是产品标识球；本地产物不复制商标，用中性圆形标记。 */}
          <span
            aria-hidden="true"
            className="h-6 w-6 shrink-0 rounded-full bg-linear-to-br from-gray-300 to-gray-500"
          />
          <button
            type="button"
            aria-label="添加引用"
            aria-expanded={refMenu}
            onClick={() => setRefMenu((v) => !v)}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-gray-alpha-50"
          >
            ＋
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="创建一则带旁白的产品广告…"
            aria-label="描述你的创作需求"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          {/* 064 在输入框与听写按钮之间有一枚模型芯片。这里显示本机真实选中的
              对话模型；没有可用模型时如实写「未配置模型」，不编一个名字。 */}
          <span className="max-w-32 shrink-0 truncate rounded-full bg-gray-alpha-100 px-2 py-1 text-xs text-secondary">
            {selected ? selected.displayName : "未配置模型"}
          </span>
          <button
            type="button"
            aria-label="从转录库插入"
            onClick={() => setTranscripts(true)}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-gray-alpha-50"
          >
            🎙
          </button>
          <button
            type="submit"
            disabled={!!blocked || busy || !ackCost}
            aria-label="发送"
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:bg-gray-300"
          >
            ↑
          </button>

          {refMenu && (
            <div
              className="absolute z-40 mt-2 w-[300px] overflow-hidden rounded-2xl border border-gray-alpha-150 bg-background shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-gray-alpha-100 p-2">
                <input
                  value={refQuery}
                  onChange={(e) => setRefQuery(e.target.value)}
                  placeholder="搜索参考资料…"
                  aria-label="搜索参考资料"
                  className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-2.5 text-sm outline-none placeholder:text-subtle"
                />
              </div>
              <p className="px-3 py-1.5 text-[11px] text-subtle">文件</p>
              <label className="focus-ring flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-alpha-50">
                <span aria-hidden="true">⭳</span> 上传文件
                <input
                  type="file"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void attach(f);
                  }}
                />
              </label>
              <p className="px-3 py-1.5 text-[11px] text-subtle">浏览素材</p>
              <div className="max-h-40 overflow-y-auto">
                {refMatches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-secondary">本机素材库还是空的。</p>
                ) : (
                  refMatches.slice(0, 20).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setRefs((r) => [
                          ...r,
                          { id: a.id, name: a.displayName, mediaType: a.mediaType },
                        ]);
                        setRefMenu(false);
                      }}
                      className="focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-alpha-50"
                    >
                      <span className="min-w-0 flex-1 truncate">{a.displayName}</span>
                      <span className="shrink-0 text-[11px] text-subtle">{a.mediaType}</span>
                    </button>
                  ))
                )}
              </div>
              <p className="border-t border-gray-alpha-100 px-3 py-1.5 text-[11px] text-subtle">
                品牌套件
              </p>
              <Link
                to="/app/files/brand-kits"
                onClick={() => setRefMenu(false)}
                className="focus-ring flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-alpha-50"
              >
                <span aria-hidden="true">＋</span> 打开品牌套件
              </Link>
            </div>
          )}
        </form>

        {refs.length > 0 && (
          <div className="mx-auto flex w-full max-w-[720px] flex-wrap gap-1.5">
            {refs.map((r) => (
              <span
                key={r.id}
                className="flex items-center gap-1.5 rounded-full border border-gray-alpha-150 px-2.5 py-1 text-xs text-secondary"
              >
                {r.name}
                <button
                  type="button"
                  aria-label={`移除引用 ${r.name}`}
                  onClick={() => setRefs((list) => list.filter((x) => x.id !== r.id))}
                  className="focus-ring rounded px-1 hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
            <p className="w-full text-[11px] text-subtle">
              引用只作为本地记录保存在这次会话里：当前聊天任务只发送文字，不会把素材内容发给模型。
            </p>
          </div>
        )}

        {selected && (
          <div className="mx-auto flex w-full max-w-[720px] flex-wrap items-end gap-3">
            {providers.length > 1 && (
              <label className="stack gap-1.5 text-sm sm:max-w-xs">
                <span className="text-secondary">Provider</span>
                <select
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                  className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}（{p.type}）
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="stack gap-1.5 text-sm sm:max-w-xs">
              <span className="text-secondary">模型</span>
              {models.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 font-mono text-xs outline-none"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={loadingModels}
                  placeholder={loadingModels ? "读取中…" : "手动填写模型名"}
                  className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 font-mono text-xs outline-none placeholder:text-subtle disabled:opacity-50"
                />
              )}
              <span className="text-xs text-subtle">
                {models.length > 0
                  ? `模型列表来自该 Provider 自身的 /v1/models（${models.length} 个）。`
                  : modelListError
                    ? `${modelListError}。这里不会替你猜一个模型名。`
                    : "该 Provider 未提供模型列表，请按本地服务文档填写。"}
              </span>
            </label>

            <label className="stack gap-1.5 text-sm">
              <span className="text-secondary">单轮上限（token）</span>
              <input
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                inputMode="numeric"
                placeholder="默认"
                className="focus-ring h-9 w-32 rounded-lg border border-gray-alpha-150 bg-background px-2 font-mono text-xs outline-none placeholder:text-subtle"
              />
              <span className="text-xs text-subtle">
                留空则由各适配器用自己的默认值；Anthropic 的接口必须给这个值。
              </span>
            </label>
          </div>
        )}

        {selected && (
          <label className="mx-auto flex w-full max-w-[720px] items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ackCost}
              onChange={(e) => setAckCost(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-secondary">
              我了解每一轮都会调用 {selected.displayName}。
              {selected.selfHosted
                ? "自托管模型无按次费用，但会消耗本机算力。"
                : "第三方服务可能收费，金额未知。"}
            </span>
          </label>
        )}

        {note && <Notice tone="error">{note}</Notice>}
        {blocked && !busy && <p className="text-center text-xs text-secondary">{blocked}</p>}

        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2">
          {busy && (
            <button
              type="button"
              onClick={() => void cancel()}
              className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
            >
              取消本轮
            </button>
          )}
          {!busy && turns.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => void retry()}
                className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
              >
                重试最后一轮
              </button>
              <button
                type="button"
                onClick={() => void adopt()}
                className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
              >
                采用到工程
              </button>
            </>
          )}
          {job && job.status !== "succeeded" && (
            <span className="text-xs text-secondary">
              最近一次任务：{job.status}
              {job.error ? ` — ${job.error.safeMessage}` : ""}
            </span>
          )}
        </div>
      </section>

      {turns.length > 0 && (
        <section aria-label="对话记录" className="stack gap-4">
          <ul className="stack gap-4">
            {turns.map((t, i) => (
              <li key={i} className={t.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    t.role === "user" ? "bg-foreground text-background" : "bg-gray-alpha-50 text-foreground"
                  }`}
                >
                  {t.content}
                </span>
              </li>
            ))}
            {busy && <li className="text-center text-xs text-secondary">模型生成中…</li>}
          </ul>
          <div ref={endRef} />
        </section>
      )}

      {turns.length === 0 && (
        <section className="stack gap-3">
          <div className="mx-auto w-full max-w-[720px]">
            <h2 className="text-sm font-medium text-foreground">聊天记录</h2>
            {loading ? (
              <div className="mt-2 h-10 animate-pulse rounded-xl bg-gray-alpha-50" />
            ) : history.length === 0 ? (
              <p className="mt-2 text-sm text-secondary">还没有历史会话。</p>
            ) : (
              <ul className="mt-2 stack gap-1">
                {history.slice(0, 6).map((h) => (
                  <li key={h.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-gray-alpha-50">
                    <Link to={`/app/creative-agent/chats/${h.id}`} className="focus-ring min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{h.name}</p>
                      <p className="text-xs text-subtle">{relativeTime(h.updatedAt)}</p>
                    </Link>
                    <Menu
                      triggerLabel={`${h.name} 选项`}
                      align="right"
                      width="min-w-40"
                      trigger={<Dots />}
                      triggerClassName="focus-ring rounded p-1.5 text-secondary"
                      entries={[
                        {
                          label: "重命名",
                          onSelect: () => {
                            setRenaming(h);
                            setRenameText(h.name);
                          },
                        },
                        {
                          label: "删除",
                          onSelect: () => {
                            void projectsApi.remove(h.id).then(() => load());
                          },
                          danger: true,
                          separated: true,
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mx-auto w-full max-w-[720px]">
            <h2 className="text-sm font-medium text-foreground">建议</h2>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => setInput(s.prompt)}
                    className="focus-ring h-full w-full rounded-2xl border border-gray-alpha-150 px-4 py-3 text-left transition-colors hover:bg-gray-alpha-50"
                  >
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    <p className="mt-1 text-xs text-secondary">{s.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {transcripts && (
        <Modal open onClose={() => setTranscripts(false)} title="从转录库插入" width="max-w-lg">
          {assets.filter((a) => a.mediaType.startsWith("text/")).length === 0 ? (
            <p className="text-sm text-secondary">
              素材库里还没有文本转录。先到「语音转文本」页转一份，再回到这里插入。
            </p>
          ) : (
            <ul className="stack gap-1">
              {assets
                .filter((a) => a.mediaType.startsWith("text/"))
                .slice(0, 20)
                .map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const text = await assetsApi.readText(a.id);
                          setInput((v) => `${v}${v ? " " : ""}${text.slice(0, 4000)}`);
                          setTranscripts(false);
                        } catch (err) {
                          setNote(err instanceof ApiError ? err.message : "读取失败");
                        }
                      }}
                      className="focus-ring w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-alpha-50"
                    >
                      {a.displayName}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Modal>
      )}

      {renaming && (
        <Modal
          open
          onClose={() => setRenaming(null)}
          title="重命名会话"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!renameText.trim()}
                onClick={() => {
                  const target = renaming;
                  const next = renameText.trim();
                  setRenaming(null);
                  void projectsApi
                    .save(target.id, target.content, next)
                    .then(() => load())
                    .catch((err: unknown) =>
                      setNote(err instanceof ApiError ? err.message : "重命名失败"),
                    );
                }}
                className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
              >
                保存
              </button>
            </>
          }
        >
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            aria-label="会话名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      <p className="text-center text-xs text-subtle">
        对话保存在本机工程里，刷新不丢。模型只拿到对话文本，读不到你的文件、密钥，也不能替你发布任何内容。
      </p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "warn" | "info";
  children: React.ReactNode;
}) {
  const cls = {
    error: "bg-red-50 text-red-700",
    warn: "bg-amber-50 text-amber-800",
    info: "bg-gray-alpha-50 text-secondary",
  }[tone];
  return <div className={`mx-auto w-full max-w-[720px] rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
