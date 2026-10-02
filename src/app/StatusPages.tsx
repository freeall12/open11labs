import { Link, useLocation } from "react-router-dom";

/* ==========================================================================
   Status pages.

   Two distinct failures, deliberately not the same screen:
     - OutOfScope: the URL is a known upstream path that SCOPE.md excludes.
       It names the reason so a reader knows it was a decision, not a bug.
     - NotFound: nothing is known about the path at all.
   Neither renders any account UI, and neither falls back to the home page
   content — that would be the "many URLs quietly render HomePage" failure
   mode R1-AC01 calls out.
   ========================================================================== */

function StatusLayout({
  code,
  title,
  children,
}: {
  code: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-5 pb-16 pt-[calc(50px+9dvh)]">
      <p className="text-sm text-secondary">{code}</p>
      <h1 className="mt-1 text-balance font-waldenburg text-3xl font-normal text-foreground">
        {title}
      </h1>
      {children ? <div className="mt-4 max-w-prose">{children}</div> : null}
    </div>
  );
}

export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <StatusLayout code="404" title="找不到这个页面">
      <p className="text-sm text-secondary">
        本地版本没有注册 <code className="font-mono text-xs">{pathname}</code>。
      </p>
      <p className="mt-2 text-sm text-secondary">
        部分上游入口尚未补采证据，因此按规范不猜测其 URL。
      </p>
      <Link
        to="/app/home"
        className="focus-ring mt-4 inline-flex items-center text-sm font-medium text-foreground hover:underline"
      >
        返回主页
      </Link>
    </StatusLayout>
  );
}

export function OutOfScopePage() {
  const { pathname } = useLocation();
  const state = (useLocation().state ?? {}) as { reason?: string };

  return (
    <StatusLayout code="已按范围裁剪" title="该页面不包含在本地版本中">
      <p className="text-sm text-secondary">
        <code className="font-mono text-xs">{pathname}</code> 属于原站的
        {state.reason || "范围外内容"}，按
        <code className="font-mono text-xs"> specs/SCOPE.md </code>
        已从本地版本移除，并且不会在任何位置提供入口。
      </p>
      <Link
        to="/app/home"
        className="focus-ring mt-4 inline-flex items-center text-sm font-medium text-foreground hover:underline"
      >
        返回主页
      </Link>
    </StatusLayout>
  );
}
