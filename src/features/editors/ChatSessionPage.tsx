import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, projects as projectsApi, type ProjectRecord } from "@/lib/api";
import { downloadText } from "@/features/voice/transcript";
import { Modal } from "@/features/shared/Modal";
import { relativeTime } from "@/features/editors/FlowsPage";

/* ==========================================================================
   Chat session.

   `/app/creative-agent/chats/:id` upstream is an existing conversation. Here
   a session is a **local project** of kind `chat`, so a conversation survives
   a refresh and a restart of the server.

   Scope: the upstream references panel pulls in shared assets and cloud
   templates, and sharing a session is an account action. Both are excluded;
   what remains is reading a local transcript of the conversation and taking
   it somewhere else (export, or continue in the chat page).
   ========================================================================== */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function ChatSessionPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await projectsApi.list();
      const found = all.find((p) => p.id === id) ?? null;
      if (!found) {
        setError("找不到这个会话，可能已被删除。");
        setProject(null);
        return;
      }
      setProject(found);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-secondary">读取会话…</p>;

  if (error || !project) {
    return (
      <div className="stack gap-4">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? "会话不存在"}
        </p>
        <Link to="/app/creative-agent" className="focus-ring w-fit text-sm underline">
          回到聊天
        </Link>
      </div>
    );
  }

  const turns: Turn[] = Array.isArray(project.content.turns)
    ? (project.content.turns as Turn[])
    : [];

  async function rename() {
    if (!project || !nameDraft.trim()) return;
    try {
      const saved = await projectsApi.save(project.id, project.content, nameDraft.trim());
      setProject(saved);
      setRenameOpen(false);
      setNote("已重命名。");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "重命名失败");
    }
  }

  async function remove() {
    if (!project) return;
    await projectsApi.remove(project.id);
    window.location.assign("/app/creative-agent");
  }

  /** 采用到工程：把这一轮问答存成可继续编辑的本地 Studio 项目。 */
  async function adopt() {
    const last = [...turns].reverse().find((t) => t.role === "assistant");
    if (!last) return;
    const created = await projectsApi.create({
      kind: "studio",
      name: `采用自 ${project!.name}`,
      content: {
        kind: "audio",
        beats: [{ id: "b1", name: "草稿", kind: "tts", text: last.content }],
      },
    });
    setNote(`已存成本地项目「${created.name}」。`);
  }

  function exportMarkdown() {
    const body = turns
      .map((t) => `**${t.role === "user" ? "我" : "助手"}**\n\n${t.content}`)
      .join("\n\n---\n\n");
    downloadText(`${project!.name}.md`, `# ${project!.name}\n\n${body}\n`, "text/markdown");
  }

  return (
    <div className="stack gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="stack gap-1">
          <p className="text-sm text-secondary">
            本地会话 · 修订 {project.revision} · {turns.length} 轮 ·{" "}
            {relativeTime(project.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportMarkdown}
            disabled={turns.length === 0}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm enabled:hover:bg-gray-alpha-50 disabled:opacity-40"
          >
            导出 Markdown
          </button>
          <button
            type="button"
            onClick={() => void adopt()}
            disabled={turns.length === 0}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm enabled:hover:bg-gray-alpha-50 disabled:opacity-40"
          >
            采用到工程
          </button>
          <button
            type="button"
            onClick={() => {
              setNameDraft(project.name);
              setRenameOpen(true);
            }}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
          >
            重命名
          </button>
          <Link
            to="/app/creative-agent"
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
          >
            继续对话
          </Link>
          <button
            type="button"
            onClick={() => void remove()}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm text-red-700 hover:bg-gray-alpha-50"
          >
            删除会话
          </button>
        </div>
      </div>

      {note && <p className="rounded-lg bg-gray-alpha-50 px-3 py-2 text-sm text-secondary">{note}</p>}

      {renameOpen && (
        <Modal
          open
          onClose={() => setRenameOpen(false)}
          title="重命名会话"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void rename()}
                disabled={!nameDraft.trim()}
                className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
              >
                保存
              </button>
            </>
          }
        >
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label="会话名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      {turns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
          这个会话还没有内容。
        </p>
      ) : (
        <ol className="stack gap-4">
          {turns.map((t, i) => (
            <li
              key={i}
              className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[min(46rem,80%)] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  t.role === "user"
                    ? "bg-foreground text-background"
                    : "bg-gray-alpha-50 text-foreground"
                }`}
              >
                {t.content}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs text-subtle">
        会话保存在本机。引用共享素材、云端模板与分享会话按范围裁剪移除。
      </p>
    </div>
  );
}
